import { createHash } from 'node:crypto';
import { Nexis, NexisError } from '@intelation/nexis';
import type { AnonymizeOptions, Method } from '@intelation/nexis';
import { wrapLanguageModel } from 'ai';

export interface NexisAiOptions {
	/** How PII is replaced in prompts. Default "redact". Use "encryption" together with `restore`. */
	method?: Method;
	/** Further options passed to every anonymize call: country, allowList, denyList, selectedEntities... */
	anonymize?: Omit<AnonymizeOptions, 'method'>;
	/**
	 * Decrypt the model's reply so the user sees the original values. Needs method "encryption" and
	 * NEXIS_ENCRYPTION_KEY (or anonymize.encryptionKey). Applies to generate calls, not streams.
	 */
	restore?: boolean;
	/**
	 * What to do when Nexis cannot be reached or rejects the text. "throw" (default) stops the call so no
	 * unprotected text is sent; "pass-through" sends the original text.
	 */
	onError?: 'throw' | 'pass-through';
	/** Remember results so history re-sent on every turn is not processed again. Default true. */
	cache?: boolean;
	/** Parallel Nexis requests per call. Default 5. */
	concurrency?: number;
}

// Structural types: the prompt shape is the same in AI SDK v5, v6 and v7, so no provider package is needed.
interface Part {
	type: string;
	text?: string;
	output?: { type: string; value?: unknown };
	[key: string]: unknown;
}
interface Message {
	role: string;
	content: string | Part[];
	[key: string]: unknown;
}
interface Params {
	prompt: Message[];
	[key: string]: unknown;
}
interface GenerateResult {
	content: Part[];
	[key: string]: unknown;
}

const ENCRYPTED_VALUE = /<<ENC:[^:]+:ENC>>/;
const CACHE_LIMIT = 1000;

export interface NexisMiddleware {
	specificationVersion: 'v2' | 'v3' | 'v4';
	transformParams: (options: { params: Params }) => Promise<Params>;
	wrapGenerate: (options: { doGenerate: () => PromiseLike<GenerateResult> }) => Promise<GenerateResult>;
}

/**
 * Middleware for the AI SDK's wrapLanguageModel. Removes PII from the system prompt, user and assistant
 * messages and tool results before the model sees them.
 */
export function nexisMiddleware(
	nexis: Nexis,
	options: NexisAiOptions = {},
	specificationVersion: NexisMiddleware['specificationVersion'] = 'v4',
): NexisMiddleware {
	const method = options.method ?? 'redact';
	if (options.restore && method !== 'encryption') {
		throw new NexisError('restore needs the encryption method', {
			description: 'Set { method: "encryption", restore: true }. Other methods cannot be reversed.',
		});
	}
	const useCache = options.cache !== false;
	const cache = new Map<string, string>();

	async function scrub(text: string): Promise<string> {
		if (!text.trim()) return text;
		// Keyed by hash so the cache never holds the original text.
		const key = createHash('sha256').update(text).digest('hex');
		const hit = useCache ? cache.get(key) : undefined;
		if (hit !== undefined) return hit;
		try {
			const res = await nexis.anonymize(text, { ...options.anonymize, method });
			if (typeof res.anonymized_text !== 'string') {
				throw new NexisError('Nexis returned no anonymized text');
			}
			if (useCache) {
				if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
				cache.set(key, res.anonymized_text);
			}
			return res.anonymized_text;
		} catch (error) {
			if (options.onError === 'pass-through') return text;
			throw error;
		}
	}

	/** Runs the jobs with at most `concurrency` in flight. */
	async function pool(jobs: Array<() => Promise<void>>) {
		const queue = [...jobs];
		const worker = async () => {
			for (let job = queue.shift(); job; job = queue.shift()) await job();
		};
		await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 5, jobs.length) }, worker));
	}

	return {
		specificationVersion,

		async transformParams({ params }) {
			const jobs: Array<() => Promise<void>> = [];
			const prompt = params.prompt.map((message): Message => {
				if (typeof message.content === 'string') {
					const copy = { ...message };
					jobs.push(async () => void (copy.content = await scrub(message.content as string)));
					return copy;
				}
				const content = message.content.map((part): Part => {
					const copy = { ...part };
					if (part.type === 'text' && typeof part.text === 'string') {
						jobs.push(async () => void (copy.text = await scrub(part.text as string)));
					} else if (
						part.type === 'tool-result' &&
						(part.output?.type === 'text' || part.output?.type === 'error-text') &&
						typeof part.output.value === 'string'
					) {
						const output = { ...part.output };
						copy.output = output;
						jobs.push(async () => void (output.value = await scrub(part.output?.value as string)));
					}
					return copy;
				});
				return { ...message, content };
			});
			await pool(jobs);
			return { ...params, prompt };
		},

		async wrapGenerate({ doGenerate }) {
			const result = await doGenerate();
			if (!options.restore) return result;
			const content = await Promise.all(
				result.content.map(async (part) => {
					if (part.type !== 'text' || !part.text || !ENCRYPTED_VALUE.test(part.text)) return part;
					try {
						const res = await nexis.decrypt(part.text, { encryptionKey: options.anonymize?.encryptionKey });
						return { ...part, text: String(res.decrypted_text) };
					} catch {
						// The model may have altered a token; show its reply as it is rather than failing the call.
						return part;
					}
				}),
			);
			return { ...result, content };
		},
	};
}

/**
 * Wraps an AI SDK language model so every prompt is cleaned of PII first.
 *
 * ```ts
 * const model = withNexis(openai('gpt-4o'), new Nexis());
 * ```
 */
export function withNexis<M extends Parameters<typeof wrapLanguageModel>[0]['model']>(
	model: M,
	nexis: Nexis,
	options: NexisAiOptions = {},
): M {
	// Older models report v2 or v3; the middleware version follows the model.
	const version = (model as { specificationVersion?: string }).specificationVersion;
	const spec = version === 'v2' || version === 'v3' ? version : 'v4';
	return wrapLanguageModel({
		model,
		middleware: nexisMiddleware(nexis, options, spec) as never,
	}) as unknown as M;
}

export { Nexis, NexisError } from '@intelation/nexis';
