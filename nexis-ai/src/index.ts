import { createHash } from 'node:crypto';
import { JSON_METHODS, Nexis, NexisError } from '@intelation/nexis';
import type { AnonymizeOptions, Method } from '@intelation/nexis';
import { wrapLanguageModel } from 'ai';

export interface NexisAiOptions {
	/** How PII is replaced in prompts. Default "redact". Use "encryption" together with `restore`. */
	method?: Method;
	/** Further options passed to every anonymize call: country, allowList, denyList, selectedEntities... */
	anonymize?: Omit<AnonymizeOptions, 'method'>;
	/**
	 * Decrypt the model's reply so the user sees the original values, in both generated and streamed replies.
	 * Needs method "encryption" and NEXIS_ENCRYPTION_KEY (or anonymize.encryptionKey).
	 */
	restore?: boolean;
	/**
	 * What to do when Nexis cannot be reached or rejects the text. "throw" (default) stops the call so no
	 * unprotected text is sent; "pass-through" sends the original text.
	 */
	onError?: 'throw' | 'pass-through';
	/** Remember results so history re-sent on every turn is not processed again. Default true. */
	cache?: boolean;
	/** Parallel Nexis requests per call, a whole number of 1 or more. Default 5. */
	concurrency?: number;
}

// Structural types: the prompt shape is the same in AI SDK v5, v6 and v7, so no provider package is needed.
interface Part {
	type: string;
	text?: string;
	input?: unknown;
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
interface StreamPart {
	type: string;
	id?: string;
	delta?: string;
	[key: string]: unknown;
}
interface StreamResult {
	stream: ReadableStream<StreamPart>;
	[key: string]: unknown;
}

const ENCRYPTED_VALUE = /<<ENC:[^:]+:ENC>>/;
const CODE_START = '<<ENC:';
const CODE_END = ':ENC>>';
/** A real code is a few hundred characters; held text past this is a code the model broke, so it is released. */
const MAX_CODE_LENGTH = 4096;
const CACHE_LIMIT = 1000;

type Job = () => Promise<void>;

export interface NexisMiddleware {
	specificationVersion: 'v2' | 'v3' | 'v4';
	transformParams: (options: { params: Params }) => Promise<Params>;
	wrapGenerate: (options: { doGenerate: () => PromiseLike<GenerateResult> }) => Promise<GenerateResult>;
	/** Present only with `restore`. */
	wrapStream?: (options: { doStream: () => PromiseLike<StreamResult> }) => Promise<StreamResult>;
}

/** Length of the end of `text` that could be the start of a code marker split across stream events. */
function partialMarker(text: string): number {
	for (let n = Math.min(CODE_START.length - 1, text.length); n > 0; n--) {
		if (text.endsWith(CODE_START.slice(0, n))) return n;
	}
	return 0;
}

const hasText = (value: unknown): boolean =>
	typeof value === 'string'
		? !!value.trim()
		: !!value && typeof value === 'object' && Object.values(value).some(hasText);

/**
 * Middleware for the AI SDK's wrapLanguageModel. Removes PII from the system prompt, user and assistant
 * messages, reasoning, tool-call inputs and tool results before the model sees them. Files are not scanned.
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
	const concurrency = options.concurrency ?? 5;
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new NexisError('concurrency must be a whole number of 1 or more', {
			description: 'It sets how many messages are cleaned at once. Leave it out for the default of 5.',
		});
	}
	// The JSON endpoint lacks some methods and options; values it cannot take are cleaned one string at a time.
	const anonymize = { ...options.anonymize, method };
	const jsonEndpoint =
		(JSON_METHODS as readonly string[]).includes(method) &&
		!anonymize.selectedEntities?.length &&
		!anonymize.fromEnd;
	const useCache = options.cache !== false;
	const cache = new Map<string, string>();

	/** Runs `clean` through the cache and the onError rule. Results are cached as text, keyed by hash. */
	async function cached<T>(kind: string, value: T, serialize: (v: T) => string, clean: () => Promise<string>) {
		// Keyed by hash so the cache never holds the original text.
		const key = createHash('sha256').update(kind).update('\0').update(serialize(value)).digest('hex');
		const hit = useCache ? cache.get(key) : undefined;
		if (hit !== undefined) return hit;
		try {
			const result = await clean();
			if (useCache) {
				if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
				cache.set(key, result);
			}
			return result;
		} catch (error) {
			if (options.onError === 'pass-through') return serialize(value);
			throw error;
		}
	}

	async function scrub(text: string): Promise<string> {
		if (!text.trim()) return text;
		return cached('text', text, (t) => t, async () => {
			const res = await nexis.anonymize(text, anonymize);
			if (typeof res.anonymized_text !== 'string') throw new NexisError('Nexis returned no anonymized text');
			return res.anonymized_text;
		});
	}

	async function scrubJson(value: object): Promise<unknown> {
		const json = await cached('json', value, (v) => JSON.stringify(v), async () => {
			const res = await nexis.anonymizeJson(value, anonymize as never);
			if (!res.anonymized_data || typeof res.anonymized_data !== 'object') {
				throw new NexisError('Nexis returned no anonymized data');
			}
			return JSON.stringify(res.anonymized_data);
		});
		// Parsed fresh each time, so no two prompts share one object.
		return JSON.parse(json);
	}

	/** Queues jobs that clean a JSON value and hand the cleaned copy to `set`. Keys and non-strings are kept. */
	function queueJson(value: unknown, set: (cleaned: unknown) => void, jobs: Job[]) {
		if (typeof value === 'string') return void jobs.push(async () => set(await scrub(value)));
		if (!hasText(value)) return;
		if (jsonEndpoint) return void jobs.push(async () => set(await scrubJson(value as object)));
		const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<string, unknown>;
		set(copy);
		for (const [key, item] of Object.entries(copy)) queueJson(item, (cleaned) => (copy[key] = cleaned), jobs);
	}

	/** Runs the jobs with at most `concurrency` in flight. */
	async function pool(jobs: Job[]) {
		const queue = [...jobs];
		const worker = async () => {
			for (let job = queue.shift(); job; job = queue.shift()) await job();
		};
		await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
	}

	/** Cleans one prompt part; the original is never changed. */
	function cleanPart(part: Part, jobs: Job[]): Part {
		const copy = { ...part };
		if ((part.type === 'text' || part.type === 'reasoning') && typeof part.text === 'string') {
			jobs.push(async () => void (copy.text = await scrub(part.text as string)));
		} else if (part.type === 'tool-call') {
			queueJson(part.input, (cleaned) => (copy.input = cleaned), jobs);
		} else if (part.type === 'tool-result' && part.output) {
			const output = { ...part.output };
			copy.output = output;
			const value = part.output.value;
			if ((output.type === 'text' || output.type === 'error-text') && typeof value === 'string') {
				jobs.push(async () => void (output.value = await scrub(value)));
			} else if (output.type === 'json' || output.type === 'error-json') {
				queueJson(value, (cleaned) => (output.value = cleaned), jobs);
			} else if (output.type === 'content' && Array.isArray(value)) {
				output.value = value.map((item: Part) => (item?.type === 'text' ? cleanPart(item, jobs) : item));
			}
		}
		return copy;
	}

	/** Decrypts one piece of the reply; values that cannot be decrypted are left as the model wrote them. */
	async function restore(text: string): Promise<string> {
		try {
			const res = await nexis.decrypt(text, { encryptionKey: options.anonymize?.encryptionKey, allowPartial: true });
			return String(res.decrypted_text);
		} catch {
			// The model may have altered a token; show its reply as it is rather than failing the call.
			return text;
		}
	}

	/** Restores codes as text streams in. Text is held back only from the start of a code to its end. */
	function restoreStream(): TransformStream<StreamPart, StreamPart> {
		const held = new Map<string, { text: string; part: StreamPart }>();
		const send = (controller: TransformStreamDefaultController<StreamPart>, part: StreamPart, delta: string) => {
			if (delta) controller.enqueue({ ...part, delta });
		};
		const release = (controller: TransformStreamDefaultController<StreamPart>, id?: string) => {
			for (const [key, block] of held) {
				if (id !== undefined && key !== id) continue;
				send(controller, block.part, block.text);
				held.delete(key);
			}
		};
		return new TransformStream({
			async transform(part, controller) {
				if (part.type !== 'text-delta' || typeof part.delta !== 'string') {
					// A block, or the whole reply, ending mid-code: release what is held, unchanged.
					if (part.type === 'text-end') release(controller, part.id);
					else if (part.type === 'finish' || part.type === 'error') release(controller);
					controller.enqueue(part);
					return;
				}
				const id = String(part.id);
				let text = (held.get(id)?.text ?? '') + part.delta;
				for (;;) {
					const start = text.indexOf(CODE_START);
					if (start === -1) {
						const keep = partialMarker(text);
						send(controller, part, text.slice(0, text.length - keep));
						text = text.slice(text.length - keep);
						break;
					}
					send(controller, part, text.slice(0, start));
					text = text.slice(start);
					const end = text.indexOf(CODE_END, CODE_START.length);
					if (end === -1) {
						if (text.length <= MAX_CODE_LENGTH) break;
						// No end marker in sight: the model broke this code. Release its start and carry on.
						send(controller, part, CODE_START);
						text = text.slice(CODE_START.length);
						continue;
					}
					// Awaited here so text after a code waits for it, and the reply keeps its order.
					send(controller, part, await restore(text.slice(0, end + CODE_END.length)));
					text = text.slice(end + CODE_END.length);
				}
				if (text) held.set(id, { text, part });
				else held.delete(id);
			},
			flush(controller) {
				release(controller);
			},
		});
	}

	return {
		specificationVersion,

		async transformParams({ params }) {
			const jobs: Job[] = [];
			const prompt = params.prompt.map((message): Message => {
				if (typeof message.content === 'string') {
					const copy = { ...message };
					jobs.push(async () => void (copy.content = await scrub(message.content as string)));
					return copy;
				}
				return { ...message, content: message.content.map((part) => cleanPart(part, jobs)) };
			});
			await pool(jobs);
			return { ...params, prompt };
		},

		async wrapGenerate({ doGenerate }) {
			const result = await doGenerate();
			if (!options.restore) return result;
			const content = await Promise.all(
				result.content.map(async (part) =>
					part.type === 'text' && part.text && ENCRYPTED_VALUE.test(part.text)
						? { ...part, text: await restore(part.text) }
						: part,
				),
			);
			return { ...result, content };
		},

		...(options.restore && {
			async wrapStream({ doStream }: { doStream: () => PromiseLike<StreamResult> }) {
				const result = await doStream();
				return { ...result, stream: result.stream.pipeThrough(restoreStream()) };
			},
		}),
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
