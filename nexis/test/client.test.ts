import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Nexis, NexisError, isFernetKey, parseCountry } from '../src/index.js';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

const KEY = 'A'.repeat(43) + '=';
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('validation', () => {
	it('checks Fernet keys', () => {
		assert.equal(isFernetKey(KEY), true);
		assert.equal(isFernetKey('short'), false);
	});
	it('parses country IDs', () => {
		assert.deepEqual(parseCountry('UK GDPR|United Kingdom||'), {
			regulation: 'UK GDPR',
			country: 'United Kingdom',
			subRegion: '',
			language: 'en',
		});
		assert.throws(() => parseCountry('nonsense'), NexisError);
	});
});

describe('Nexis client', () => {
	it('requires an API key', () => {
		delete process.env.NEXIS_API_KEY;
		assert.throws(() => new Nexis(), /API key is missing/);
	});

	it('sends a redact request with auth and idempotency headers', async () => {
		let seen: { url: string; init: RequestInit } | undefined;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			seen = { url, init };
			return json(200, { anonymised_text: '[REDACTED]' });
		}) as typeof fetch;
		const nexis = new Nexis({ apiKey: 'k', country: 'UK GDPR|United Kingdom||en' });
		const res = await nexis.redact('John Smith');
		assert.equal(res.anonymized_text, '[REDACTED]');
		assert.equal(seen?.url, 'https://api.nexis.intelation.com/api/text/');
		const headers = seen?.init.headers as Record<string, string>;
		assert.equal(headers.Authorization, 'Bearer k');
		assert.match(headers['Idempotency-Key'], /^nexis-js-/);
		const body = JSON.parse(String(seen?.init.body));
		assert.equal(body.anonymisation_method, 'redact');
		assert.equal(body.regulation, 'UK GDPR');
	});

	it('uses the first plan country when none is given', async () => {
		const calls: string[] = [];
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			calls.push(url);
			if (url.endsWith('/api/account/')) {
				return json(200, { subscribed_countries: [{ regulation: 'HIPAA', country: 'United States', sub_region: null, language_code: 'en' }] });
			}
			return json(200, { echo: JSON.parse(String(init.body)) });
		}) as typeof fetch;
		const res = await new Nexis({ apiKey: 'k' }).detect('hi');
		assert.equal(res.echo.regulation, 'HIPAA');
		assert.equal(calls.length, 2);
	});

	it('retries under a new key when the earlier idempotent request failed', async () => {
		const keys: string[] = [];
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
			return keys.length === 1 ? json(409, { error_code: 'IDEMPOTENCY_PREVIOUS_FAILURE' }) : json(200, { anonymised_text: 'ok' });
		}) as typeof fetch;
		const res = await new Nexis({ apiKey: 'k', country: 'A|B||en' }).redact('x');
		assert.equal(res.anonymized_text, 'ok');
		assert.equal(keys[1], `${keys[0]}-1`);
	});

	it('turns API errors into friendly ones', async () => {
		globalThis.fetch = (async () => json(402, { detail: 'Daily quota exceeded. Limit: 100 per day. Upgrade your plan to continue.' })) as typeof fetch;
		await assert.rejects(new Nexis({ apiKey: 'k', country: 'A|B||en' }).redact('x'), /Daily Nexis API call limit reached/);
	});

	it('rejects bad encryption keys and empty text before calling the API', async () => {
		globalThis.fetch = (async () => {
			throw new Error('should not be called');
		}) as typeof fetch;
		const nexis = new Nexis({ apiKey: 'k', country: 'A|B||en' });
		await assert.rejects(nexis.encryption('x', { encryptionKey: 'bad' }), /not a valid Fernet key/);
		await assert.rejects(nexis.redact('  '), /Text is empty/);
	});

	it('reports values left encrypted after decrypt', async () => {
		globalThis.fetch = (async () => json(200, { decrypted_text: 'a <<ENC:x:ENC>>' })) as typeof fetch;
		await assert.rejects(
			new Nexis({ apiKey: 'k' }).decrypt('a <<ENC:x:ENC>>', { encryptionKey: KEY }),
			/Could not decrypt/,
		);
	});
});
