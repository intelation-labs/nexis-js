import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { generateText, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Nexis, nexisMiddleware, withNexis } from '../src/index.js';
import type { NexisAiOptions } from '../src/index.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const KEY = 'A'.repeat(43) + '=';
const nexis = () => new Nexis({ apiKey: 'k', country: 'UK GDPR|United Kingdom||en' });
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/**
 * Fake Nexis: replaces "John Smith" with the marker the test asks for, in text and in JSON. Decrypt turns codes
 * back into "John Smith", except codes containing "bad", which stay as they are.
 */
function fakeNexis(marker: string, seen: string[] = [], urls: string[] = []) {
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		const path = new URL(url).pathname;
		urls.push(path);
		if (path === '/api/structured/json/') {
			const form = init.body as FormData;
			const data = await (form.get('file') as Blob).text();
			seen.push(data);
			return reply(200, { anonymised_data: JSON.parse(data.replaceAll('John Smith', marker)) });
		}
		const body = JSON.parse(String(init.body));
		if (path === '/api/decrypt/') {
			const decrypted = String(body.encrypted_text).replace(/<<ENC:[^:]+:ENC>>/g, (c) =>
				c.includes('bad') ? c : 'John Smith',
			);
			return reply(200, { decrypted_text: decrypted });
		}
		seen.push(body.text);
		return reply(200, { anonymised_text: String(body.text).replaceAll('John Smith', marker) });
	}) as typeof fetch;
	return seen;
}

function mockModel(text: string, prompts: unknown[] = []) {
	return new MockLanguageModelV4({
		doGenerate: async (options) => {
			prompts.push(options.prompt);
			return {
				content: [{ type: 'text', text }],
				finishReason: { unified: 'stop', raw: 'stop' },
				usage: {
					inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: 1, text: 1, reasoning: 0 },
				},
				warnings: [],
			} as never;
		},
	});
}

type Item = Record<string, any>;

const transform = async (prompt: unknown[], options: NexisAiOptions = {}) =>
	(await nexisMiddleware(nexis(), options).transformParams({ params: { prompt: prompt as never } })).prompt as Item[];

const streamOf = (parts: Item[]) =>
	new ReadableStream({
		start(controller) {
			for (const part of parts) controller.enqueue(part as never);
			controller.close();
		},
	});

/** Runs parts through the middleware's wrapStream and collects what comes out. */
async function restoreStream(parts: Item[]) {
	const middleware = nexisMiddleware(nexis(), { method: 'encryption', restore: true, anonymize: { encryptionKey: KEY } });
	const result = await middleware.wrapStream!({ doStream: async () => ({ stream: streamOf(parts) }) });
	const out: Item[] = [];
	for await (const part of result.stream as unknown as AsyncIterable<Item>) out.push(part);
	return out;
}
const deltas = (id: string, ...texts: string[]) => texts.map((delta) => ({ type: 'text-delta', id, delta }));
const textOf = (parts: Item[], id = 't') =>
	parts
		.filter((p) => p.type === 'text-delta' && p.id === id)
		.map((p) => p.delta)
		.join('');

describe('withNexis', () => {
	it('removes PII from system and user messages before the model sees them', async () => {
		fakeNexis('[REDACTED]');
		const prompts: unknown[][] = [];
		const model = withNexis(mockModel('ok', prompts), nexis());
		await generateText({ model, system: 'You help John Smith', prompt: 'Email John Smith please' });
		const sent = JSON.stringify(prompts[0]);
		assert.equal(sent.includes('John Smith'), false);
		assert.equal(sent.includes('[REDACTED]'), true);
	});

	it('caches results so repeated history is not processed again', async () => {
		const seen = fakeNexis('[REDACTED]');
		const model = withNexis(mockModel('ok'), nexis());
		await generateText({ model, prompt: 'Hello John Smith' });
		await generateText({ model, prompt: 'Hello John Smith' });
		assert.equal(seen.length, 1);
	});

	it('fails closed when Nexis errors', async () => {
		globalThis.fetch = (async () => reply(401, {})) as typeof fetch;
		const prompts: unknown[] = [];
		const model = withNexis(mockModel('ok', prompts), nexis());
		await assert.rejects(generateText({ model, prompt: 'John Smith' }), /API key is not active/);
		assert.equal(prompts.length, 0);
	});

	it('can pass text through when asked to', async () => {
		globalThis.fetch = (async () => reply(500, {})) as typeof fetch;
		const prompts: unknown[] = [];
		const model = withNexis(mockModel('ok', prompts), nexis(), { onError: 'pass-through' });
		await generateText({ model, prompt: 'John Smith' });
		assert.equal(prompts.length, 1);
	});

	it('restores encrypted values in the reply', async () => {
		fakeNexis('<<ENC:abc:ENC>>');
		const model = withNexis(mockModel('Dear <<ENC:abc:ENC>>, hello'), nexis(), {
			method: 'encryption',
			restore: true,
			anonymize: { encryptionKey: KEY },
		});
		const { text } = await generateText({ model, prompt: 'Write to John Smith' });
		assert.equal(text, 'Dear John Smith, hello');
	});

	it('restores the values it can when one code is damaged', async () => {
		fakeNexis('<<ENC:abc:ENC>>');
		const model = withNexis(mockModel('Dear <<ENC:abc:ENC>> and <<ENC:bad:ENC>>'), nexis(), {
			method: 'encryption',
			restore: true,
			anonymize: { encryptionKey: KEY },
		});
		const { text } = await generateText({ model, prompt: 'Write to John Smith' });
		assert.equal(text, 'Dear John Smith and <<ENC:bad:ENC>>');
	});

	it('rejects restore without the encryption method', () => {
		assert.throws(() => withNexis(mockModel('x'), nexis(), { restore: true }), /encryption/);
	});

	it('rejects a concurrency that would clean nothing', () => {
		for (const concurrency of [0, -1, 1.5, Number.NaN]) {
			assert.throws(() => withNexis(mockModel('x'), nexis(), { concurrency }), /concurrency must be a whole number/);
		}
		assert.doesNotThrow(() => withNexis(mockModel('x'), nexis(), { concurrency: 1 }));
	});
});

describe('prompt parts', () => {
	const toolCall = { type: 'tool-call', toolCallId: '1', toolName: 'lookup', input: { name: 'John Smith', age: 40 } };
	const result = (output: unknown) => ({ type: 'tool-result', toolCallId: '1', toolName: 'lookup', output });

	it('cleans tool-call inputs and JSON tool results through the JSON endpoint', async () => {
		const urls: string[] = [];
		fakeNexis('[REDACTED]', [], urls);
		const prompt = [
			{ role: 'assistant', content: [toolCall] },
			{
				role: 'tool',
				content: [
					result({ type: 'json', value: [{ email: 'John Smith', id: 7 }] }),
					result({ type: 'error-json', value: { error: 'No John Smith' } }),
				],
			},
		];
		const before = JSON.stringify(prompt);
		const [assistant, tool] = await transform(prompt);
		assert.deepEqual(assistant.content[0].input, { name: '[REDACTED]', age: 40 });
		assert.deepEqual(tool.content[0].output.value, [{ email: '[REDACTED]', id: 7 }]);
		assert.deepEqual(tool.content[1].output.value, { error: 'No [REDACTED]' });
		assert.deepEqual(urls, Array(3).fill('/api/structured/json/'));
		assert.equal(JSON.stringify(prompt), before);
	});

	it('cleans content tool results and reasoning as text', async () => {
		const urls: string[] = [];
		fakeNexis('[REDACTED]', [], urls);
		const media = { type: 'media', data: 'x', mediaType: 'image/png' };
		const [message] = await transform([
			{
				role: 'assistant',
				content: [
					{ type: 'reasoning', text: 'Look up John Smith' },
					result({ type: 'content', value: [{ type: 'text', text: 'Found John Smith' }, media] }),
				],
			},
		]);
		assert.equal(message.content[0].text, 'Look up [REDACTED]');
		assert.equal(message.content[1].output.value[0].text, 'Found [REDACTED]');
		assert.deepEqual(message.content[1].output.value[1], media);
		assert.deepEqual(urls, ['/api/text/', '/api/text/']);
	});

	it('cleans each string value when the JSON endpoint cannot take the request', async () => {
		const cases: NexisAiOptions[] = [
			{ method: 'hash' },
			{ method: 'tokenization' },
			{ anonymize: { selectedEntities: ['PERSON'] } },
		];
		for (const options of cases) {
			const urls: string[] = [];
			fakeNexis('<X>', [], urls);
			const [message] = await transform([{ role: 'assistant', content: [toolCall] }], options);
			assert.deepEqual(message.content[0].input, { name: '<X>', age: 40 }, JSON.stringify(options));
			assert.deepEqual(urls, ['/api/text/']);
		}
		// A scalar is not JSON the endpoint accepts, so it goes as text.
		const urls: string[] = [];
		fakeNexis('<X>', [], urls);
		const [message] = await transform([{ role: 'tool', content: [result({ type: 'json', value: 'John Smith' })] }]);
		assert.equal(message.content[0].output.value, '<X>');
		assert.deepEqual(urls, ['/api/text/']);
	});

	it('blocks the call when the JSON endpoint fails', async () => {
		globalThis.fetch = (async () => reply(500, {})) as typeof fetch;
		const prompts: unknown[] = [];
		const model = withNexis(mockModel('ok', prompts), nexis());
		await assert.rejects(
			generateText({
				model,
				messages: [
					{
						role: 'assistant',
						content: [{ type: 'tool-call', toolCallId: '1', toolName: 'lookup', input: { name: 'John Smith' } }],
					},
					{
						role: 'tool',
						content: [
							{
								type: 'tool-result',
								toolCallId: '1',
								toolName: 'lookup',
								output: { type: 'json', value: { name: 'John Smith' } },
							},
						],
					},
				],
			}),
			/HTTP 500/,
		);
		assert.equal(prompts.length, 0);
	});
});

describe('restore while streaming', () => {
	it('restores codes split across events, including inside the marker', async () => {
		fakeNexis('');
		const out = await restoreStream([
			{ type: 'text-start', id: 't' },
			...deltas('t', 'Dear <', '<EN', 'C:a', 'bc:EN', 'C>>, and <<ENC:x', 'y:ENC>>!'),
			{ type: 'text-end', id: 't' },
		]);
		assert.equal(textOf(out), 'Dear John Smith, and John Smith!');
	});

	it('restores codes in separate text blocks', async () => {
		fakeNexis('');
		const out = await restoreStream([
			...deltas('a', 'Hi <<ENC:'),
			...deltas('b', 'Bye <<ENC:q:ENC>>'),
			...deltas('a', 'p:ENC>>'),
			{ type: 'text-end', id: 'a' },
			{ type: 'text-end', id: 'b' },
		]);
		assert.equal(textOf(out, 'a'), 'Hi John Smith');
		assert.equal(textOf(out, 'b'), 'Bye John Smith');
	});

	it('releases unfinished, broken and undecryptable codes unchanged', async () => {
		fakeNexis('');
		const unfinished = await restoreStream([...deltas('t', 'A <<ENC:abc'), { type: 'text-end', id: 't' }]);
		assert.equal(textOf(unfinished), 'A <<ENC:abc');

		const long = 'x'.repeat(5000);
		const broken = await restoreStream(deltas('t', 'B <<ENC:', long, ' then <<ENC:ok:ENC>>'));
		assert.equal(textOf(broken), 'B <<ENC:' + long + ' then John Smith');

		const bad = await restoreStream(deltas('t', 'C <<ENC:bad:ENC>> end'));
		assert.equal(textOf(bad), 'C <<ENC:bad:ENC>> end');

		const partial = await restoreStream([...deltas('t', 'D <<EN'), { type: 'finish' }]);
		assert.equal(textOf(partial), 'D <<EN');
		assert.equal(partial.at(-1)?.type, 'finish');
	});

	it('keeps non-text events in order', async () => {
		fakeNexis('');
		const out = await restoreStream([
			{ type: 'stream-start', warnings: [] },
			...deltas('t', 'Hi <<ENC:a:ENC>>'),
			{ type: 'tool-call', toolCallId: '1', toolName: 'x', input: '{}' },
			...deltas('t', ' there'),
			{ type: 'text-end', id: 't' },
			{ type: 'finish' },
		]);
		assert.deepEqual(
			out.map((p) => (p.type === 'text-delta' ? p.delta : p.type)),
			['stream-start', 'Hi ', 'John Smith', 'tool-call', ' there', 'text-end', 'finish'],
		);
	});

	it('restores a streamText reply end to end', async () => {
		fakeNexis('<<ENC:abc:ENC>>');
		const finish = {
			type: 'finish',
			finishReason: { unified: 'stop', raw: 'stop' },
			usage: {
				inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
				outputTokens: { total: 1, text: 1, reasoning: 0 },
			},
		};
		const parts = [{ type: 'text-start', id: 't' }, ...deltas('t', 'Dear <<ENC:a', 'bc:ENC>>'), { type: 'text-end', id: 't' }, finish];
		const model = withNexis(new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(parts) }) }), nexis(), {
			method: 'encryption',
			restore: true,
			anonymize: { encryptionKey: KEY },
		});
		const res = streamText({ model, prompt: 'Write to John Smith' });
		assert.equal(await res.text, 'Dear John Smith');
	});

	it('leaves streams alone when restore is off', () => {
		assert.equal(nexisMiddleware(nexis()).wrapStream, undefined);
	});
});
