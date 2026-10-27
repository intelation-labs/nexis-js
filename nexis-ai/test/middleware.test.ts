import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Nexis, withNexis } from '../src/index.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const KEY = 'A'.repeat(43) + '=';
const nexis = () => new Nexis({ apiKey: 'k', country: 'UK GDPR|United Kingdom||en' });
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** Fake Nexis: replaces "John Smith" with the marker the test asks for. */
function fakeNexis(marker: string, seen: string[] = []) {
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		if (String(url).endsWith('/api/decrypt/')) {
			return reply(200, { decrypted_text: String(body.encrypted_text).replace(/<<ENC:[^:]+:ENC>>/g, 'John Smith') });
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

	it('rejects restore without the encryption method', () => {
		assert.throws(() => withNexis(mockModel('x'), nexis(), { restore: true }), /encryption/);
	});
});
