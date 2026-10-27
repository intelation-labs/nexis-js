import { NexisError } from './errors.js';

/** Fernet key: 32 bytes as URL-safe base64, i.e. 43 characters plus one "=" of padding. */
export const isFernetKey = (key: string): boolean => /^[A-Za-z0-9_-]{43}=$/.test(key);

/** Encrypted values in Nexis output look like <<ENC:token:ENC>>. */
const ENCRYPTED_VALUE = /<<ENC:[^:]+:ENC>>/g;
export const countEncrypted = (text: string): number => (text.match(ENCRYPTED_VALUE) ?? []).length;

export interface Country {
	regulation: string;
	country: string;
	subRegion?: string;
	language?: string;
}

export const SEP = '|';

/** Parses "regulation|country|sub-region|language" (sub-region and language can be empty). */
export function parseCountry(value: string | Country): Required<Country> {
	if (typeof value === 'object' && value) {
		return { subRegion: '', language: 'en', ...value } as Required<Country>;
	}
	const raw = String(value ?? '').trim();
	const parts = raw.split(SEP);
	const [regulation, country, subRegion, language] = parts;
	if (!regulation?.trim() || !country?.trim() || parts.length > 4) {
		throw new NexisError(`Country ID is not valid: "${raw}"`, {
			description: 'Use the format regulation|country|sub-region|language (sub-region and language can be empty).',
		});
	}
	return {
		regulation: regulation.trim(),
		country: country.trim(),
		subRegion: (subRegion ?? '').trim(),
		language: (language ?? '').trim() || 'en',
	};
}

export const toList = (value: string | string[] | undefined): string[] =>
	(Array.isArray(value) ? value : String(value ?? '').split(/[\n,]/)).map((s) => s.trim()).filter(Boolean);
