import { randomUUID } from 'node:crypto';
import { NexisError, friendlyApiError } from './errors.js';
import { countEncrypted, isFernetKey, parseCountry, toList } from './validate.js';
import type { Country } from './validate.js';

export type Method = 'redact' | 'mask' | 'hash' | 'replace' | 'pseudonymization' | 'tokenization' | 'encryption';

export interface NexisOptions {
	/** Defaults to the NEXIS_API_KEY environment variable. */
	apiKey?: string;
	/** Defaults to https://api.nexis.intelation.com. Change only for a dedicated or on-premises instance. */
	baseUrl?: string;
	/** Default country for every call, as "regulation|country|sub-region|language" or an object. Defaults to the first country in your plan. */
	country?: string | Country;
	/** Request timeout in milliseconds. Default 60000. */
	timeoutMs?: number;
}

export interface DetectOptions {
	country?: string | Country;
	/** Only process these entity types. */
	selectedEntities?: string[];
	/** Process everything except these entity types. */
	excludedEntities?: string[];
}

export interface AnonymizeOptions extends DetectOptions {
	method?: Method;
	/** Fernet key, required for the encryption method. Defaults to NEXIS_ENCRYPTION_KEY. */
	encryptionKey?: string;
	maskingChar?: string;
	charsToMask?: number;
	fromEnd?: boolean;
	/** Values that are never anonymized. */
	allowList?: string[];
	/** Values that are always anonymized. */
	denyList?: string[];
}

export interface DetectOnlyOptions extends DetectOptions {
	showExplanations?: boolean;
}

/** Raw JSON reply from the Nexis API. */
export type NexisResponse = Record<string, any>;

const DEFAULT_BASE_URL = 'https://api.nexis.intelation.com';
const DETECT_MAX_CHARS = 5000;
/** Nexis replies to a reused Idempotency-Key whose first request failed, or never finished. */
const IDEMPOTENCY_RETRY_CODES = ['IDEMPOTENCY_PREVIOUS_FAILURE', 'IDEMPOTENCY_DUPLICATE_IN_PROGRESS'];
const MAX_IDEMPOTENCY_KEYS = 5;

export class Nexis {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly defaultCountry?: string | Country;
	private firstCountry?: Required<Country>;

	constructor(options: NexisOptions = {}) {
		const apiKey = (options.apiKey ?? process.env.NEXIS_API_KEY ?? '').trim();
		if (!apiKey) {
			throw new NexisError('Nexis API key is missing', {
				description: 'Pass { apiKey } or set NEXIS_API_KEY. Get a free key: https://nexis.intelation.com',
			});
		}
		const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
		if (!/^https?:\/\//i.test(baseUrl)) throw new NexisError('Base URL must start with http:// or https://');
		this.apiKey = apiKey;
		this.baseUrl = baseUrl;
		this.timeoutMs = options.timeoutMs ?? 60_000;
		this.defaultCountry = options.country;
	}

	/** Sends an authenticated JSON request. Errors become NexisError with a friendly message. */
	private async request(
		method: 'GET' | 'POST',
		path: string,
		body?: object,
		headers: Record<string, string> = {},
	): Promise<NexisResponse> {
		let res: Response;
		try {
			res = await fetch(`${this.baseUrl}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					Accept: 'application/json',
					...(body ? { 'Content-Type': 'application/json' } : {}),
					...headers,
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (error) {
			throw new NexisError(`Could not reach Nexis: ${(error as Error).message}`, {
				description: `Check your network and base URL (${this.baseUrl}).`,
			});
		}
		const text = await res.text();
		let data: unknown = {};
		try {
			data = text ? JSON.parse(text) : {};
		} catch {
			data = { message: text.slice(0, 200) };
		}
		if (!res.ok) {
			throw friendlyApiError(res.status, data && typeof data === 'object' ? (data as Record<string, unknown>) : {});
		}
		return data as NexisResponse;
	}

	/** Account details, including the countries in your plan. */
	async account(): Promise<NexisResponse> {
		return this.request('GET', '/api/account/');
	}

	/** Countries (with their regulations) your plan can use. */
	async countries(): Promise<Required<Country>[]> {
		const account = await this.account();
		const list = (account.subscribed_countries ?? []) as Array<Record<string, string | null>>;
		if (!list.length) {
			throw new NexisError('Your Nexis plan has no countries', {
				description: 'Add a country to your plan: https://nexis.intelation.com',
			});
		}
		return list.map((r) => ({
			regulation: String(r.regulation),
			country: String(r.country),
			subRegion: r.sub_region ?? '',
			language: r.language_code ?? 'en',
		}));
	}

	/** The full entity catalog. */
	async catalog(): Promise<NexisResponse> {
		return this.request('GET', '/catalog/');
	}

	private async resolveCountry(country?: string | Country): Promise<Required<Country>> {
		const chosen = country ?? this.defaultCountry;
		if (chosen) return parseCountry(chosen);
		return (this.firstCountry ??= (await this.countries())[0]);
	}

	private async baseBody(text: string, options: DetectOptions): Promise<Record<string, unknown>> {
		if (typeof text !== 'string' || !text.trim()) throw new NexisError('Text is empty');
		const c = await this.resolveCountry(options.country);
		const body: Record<string, unknown> = {
			text,
			regulation: c.regulation,
			country: c.country,
			language: c.language,
		};
		if (c.subRegion) body.sub_region = c.subRegion;
		if (options.selectedEntities?.length) body.selected_entities = options.selectedEntities;
		if (options.excludedEntities?.length) body.excluded_entities = options.excludedEntities;
		return body;
	}

	/** Lists the PII found in the text without changing it. */
	async detect(text: string, options: DetectOnlyOptions = {}): Promise<NexisResponse> {
		// Nexis counts characters as Unicode code points, so emoji count once.
		if ([...String(text)].length > DETECT_MAX_CHARS) {
			throw new NexisError('Text is too long for detect', {
				description: `Detect accepts up to ${DETECT_MAX_CHARS.toLocaleString('en')} characters. Split the text into smaller parts.`,
			});
		}
		const body = await this.baseBody(text, options);
		if (options.showExplanations) body.show_explanations = true;
		return this.request('POST', '/api/detect/', body);
	}

	/** Anonymizes the text. Returns the full API reply. */
	async anonymize(text: string, options: AnonymizeOptions = {}): Promise<NexisResponse> {
		const method = options.method ?? 'redact';
		const body = await this.baseBody(text, options);
		body.anonymisation_method = method;

		if (method === 'encryption') {
			const key = (options.encryptionKey ?? process.env.NEXIS_ENCRYPTION_KEY ?? '').trim();
			if (!isFernetKey(key)) {
				throw new NexisError('The encryption key is not a valid Fernet key', {
					description:
						'Pass { encryptionKey } or set NEXIS_ENCRYPTION_KEY to a 44-character URL-safe base64 key ending in "=".',
				});
			}
			body.encryption_key = key;
		}
		if (method === 'mask') {
			if (options.maskingChar !== undefined && [...options.maskingChar].length !== 1) {
				throw new NexisError('maskingChar must be a single character');
			}
			if (options.maskingChar) body.masking_char = options.maskingChar;
			if (options.charsToMask) {
				body.chars_to_mask = options.charsToMask;
				if (options.fromEnd !== undefined) body.from_end = options.fromEnd;
			}
		}
		if (options.allowList?.length) body.allow_list = toList(options.allowList);
		if (options.denyList?.length) body.deny_list = toList(options.denyList);

		// One key per call: if Nexis says the earlier request under it failed or is stuck, retry under the next key.
		const key = `nexis-js-${randomUUID()}`;
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_IDEMPOTENCY_KEYS; attempt++) {
			try {
				const res = await this.request('POST', '/api/text/', body, {
					'Idempotency-Key': attempt ? `${key}-${attempt}` : key,
				});
				// The API spells it anonymised_text; expose anonymized_text too so both spellings work.
				res.anonymized_text ??= res.anonymised_text;
				return res;
			} catch (error) {
				lastError = error;
				if (!IDEMPOTENCY_RETRY_CODES.includes((error as NexisError).code ?? '')) break;
			}
		}
		throw lastError;
	}

	redact = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) => this.anonymize(text, { ...o, method: 'redact' });
	mask = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) => this.anonymize(text, { ...o, method: 'mask' });
	hash = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) => this.anonymize(text, { ...o, method: 'hash' });
	replace = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) => this.anonymize(text, { ...o, method: 'replace' });
	pseudonymization = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) =>
		this.anonymize(text, { ...o, method: 'pseudonymization' });
	tokenization = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) =>
		this.anonymize(text, { ...o, method: 'tokenization' });
	encryption = (text: string, o: Omit<AnonymizeOptions, 'method'> = {}) =>
		this.anonymize(text, { ...o, method: 'encryption' });

	/**
	 * Restores values encrypted with the encryption method. Nexis leaves a value encrypted when the key does not
	 * match and still reports success, so leftovers are reported as an error here.
	 */
	async decrypt(encryptedText: string, options: { encryptionKey?: string } = {}): Promise<NexisResponse> {
		const total = countEncrypted(encryptedText);
		if (!total) {
			throw new NexisError('No encrypted values found', {
				description:
					'Decrypt only works on text from the encryption method, where each value looks like <<ENC:...:ENC>>.',
			});
		}
		const key = (options.encryptionKey ?? process.env.NEXIS_ENCRYPTION_KEY ?? '').trim();
		if (!isFernetKey(key)) {
			throw new NexisError('The encryption key is not a valid Fernet key', {
				description: 'Pass { encryptionKey } or set NEXIS_ENCRYPTION_KEY.',
			});
		}
		const response = await this.request('POST', '/api/decrypt/', { encrypted_text: encryptedText, encryption_key: key });
		const left = countEncrypted(String(response.decrypted_text ?? ''));
		if (left) {
			throw new NexisError(
				left === total
					? 'Could not decrypt the text with this key'
					: `${left} of ${total} encrypted values could not be decrypted`,
				{ description: 'Check that the key is the same one that was used to encrypt this text.' },
			);
		}
		return response;
	}
}
