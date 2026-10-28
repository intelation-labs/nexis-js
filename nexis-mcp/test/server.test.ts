import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Nexis } from '@intelation/nexis';
import { createServer } from '../src/server.js';
import type { ServerOptions } from '../src/server.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

// Compiled to .test-build/test/, so the package root is two levels up.
const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const bin = fileURLToPath(new URL('dist/index.js', root));
const needsBuild = existsSync(bin) ? false : 'run npm run build first';

async function connect(options: Partial<ServerOptions> = {}) {
	const nexis = new Nexis({ apiKey: 'k', country: 'UK GDPR|United Kingdom||en' });
	const server = createServer(nexis, { version: '9.9.9', ...options });
	const client = new Client({ name: 'test', version: '0' });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
	return client;
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('nexis-mcp', () => {
	it('leaves decrypt_text out by default', async () => {
		const { tools } = await (await connect()).listTools();
		assert.deepEqual(tools.map((t) => t.name).sort(), ['anonymize_text', 'detect_pii', 'list_countries']);
	});

	it('lists and runs decrypt_text when allowDecrypt is on', async () => {
		process.env.NEXIS_ENCRYPTION_KEY = 'A'.repeat(43) + '=';
		globalThis.fetch = (async () => reply(200, { decrypted_text: 'Hi John' })) as typeof fetch;
		const client = await connect({ allowDecrypt: true });
		const { tools } = await client.listTools();
		assert.deepEqual(tools.map((t) => t.name).sort(), ['anonymize_text', 'decrypt_text', 'detect_pii', 'list_countries']);
		const res = await client.callTool({ name: 'decrypt_text', arguments: { encryptedText: 'Hi <<ENC:x:ENC>>' } });
		assert.equal((res.content as { text: string }[])[0].text, 'Hi John');
		delete process.env.NEXIS_ENCRYPTION_KEY;
	});

	it('reports the version it was given', async () => {
		assert.equal((await connect()).getServerVersion()?.version, '9.9.9');
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

describe('nexis-mcp package', () => {
	it('can be imported without starting a server', { skip: needsBuild }, () => {
		const env = { ...process.env };
		delete env.NEXIS_API_KEY;
		const res = spawnSync(
			process.execPath,
			['--input-type=module', '-e', "const m = await import('@intelation/nexis-mcp'); console.log(typeof m.createServer)"],
			{ env, encoding: 'utf8', input: '', timeout: 10_000 },
		);
		assert.equal(res.stderr, '');
		assert.equal(res.stdout.trim(), 'function');
		assert.equal(res.status, 0);
	});

	it('the nexis-mcp command starts and reports the package version', { skip: needsBuild }, async () => {
		const client = new Client({ name: 'test', version: '0' });
		const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
		await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin], env: { ...env, NEXIS_API_KEY: 'k' } }));
		try {
			assert.equal(client.getServerVersion()?.version, pkg.version);
		} finally {
			await client.close();
		}
	});
});
