import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Nexis } from '@intelation/nexis';
import { createServer } from '../src/server.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

async function connect() {
	const server = createServer(new Nexis({ apiKey: 'k', country: 'UK GDPR|United Kingdom||en' }));
	const client = new Client({ name: 'test', version: '0' });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
	return client;
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('nexis-mcp', () => {
	it('lists the four tools', async () => {
		const { tools } = await (await connect()).listTools();
		assert.deepEqual(tools.map((t) => t.name).sort(), ['anonymize_text', 'decrypt_text', 'detect_pii', 'list_countries']);
	});

	it('anonymize_text returns the anonymized text', async () => {
		let body: Record<string, unknown> = {};
		globalThis.fetch = (async (_u: string, init: RequestInit) => {
			body = JSON.parse(String(init.body));
			return reply(200, { anonymised_text: 'Hi [REDACTED]' });
		}) as typeof fetch;
		const res = await (await connect()).callTool({ name: 'anonymize_text', arguments: { text: 'Hi John' } });
		assert.equal((res.content as { text: string }[])[0].text, 'Hi [REDACTED]');
		assert.equal(body.anonymisation_method, 'redact');
	});

	it('returns API errors as readable tool errors', async () => {
		globalThis.fetch = (async () => reply(401, {})) as typeof fetch;
		const res = await (await connect()).callTool({ name: 'detect_pii', arguments: { text: 'x' } });
		assert.equal(res.isError, true);
		assert.match((res.content as { text: string }[])[0].text, /API key is not active/);
	});

	it('never accepts an encryption key as a tool argument', async () => {
		const { tools } = await (await connect()).listTools();
		for (const t of tools) assert.equal(JSON.stringify(t.inputSchema).includes('encryptionKey'), false);
	});
});
