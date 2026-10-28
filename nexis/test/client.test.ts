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
	it('treats a blank language in a country object as "en"', () => {
		assert.deepEqual(parseCountry({ regulation: ' GDPR ', country: 'Germany', language: undefined }), {
			regulation: 'GDPR',
			country: 'Germany',
			subRegion: '',
			language: 'en',
		});
		assert.equal(parseCountry({ regulation: 'GDPR', country: 'Germany', language: '  ' }).language, 'en');
		assert.throws(() => parseCountry({ regulation: 'GDPR', country: ' ' }), /Country ID is not valid/);
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

	it('returns a partial decrypt with counts when allowPartial is set', async () => {
		globalThis.fetch = (async () => json(200, { decrypted_text: 'John and <<ENC:y:ENC>>' })) as typeof fetch;
		const nexis = new Nexis({ apiKey: 'k' });
		const input = '<<ENC:x:ENC>> and <<ENC:y:ENC>>';
		await assert.rejects(nexis.decrypt(input, { encryptionKey: KEY }), /1 of 2 encrypted values/);
		const res = await nexis.decrypt(input, { encryptionKey: KEY, allowPartial: true });
		assert.equal(res.decrypted_text, 'John and <<ENC:y:ENC>>');
		assert.equal(res.decrypted_count, 1);
		assert.equal(res.failed_count, 1);
		await assert.rejects(nexis.decrypt('plain', { encryptionKey: KEY, allowPartial: true }), /No encrypted values/);
		await assert.rejects(nexis.decrypt(input, { encryptionKey: 'bad', allowPartial: true }), /not a valid Fernet key/);
	});

	it('shows FastAPI validation details without the request values', async () => {
		globalThis.fetch = (async () =>
			json(422, {
				detail: [
					{ loc: ['body', 'text'], msg: 'Field required', type: 'missing', input: 'John Smith' },
					{ loc: ['body', 'country'], msg: 'Too short', type: 'x', input: 'secret' },
					{ loc: ['body', 'a'], msg: 'A', type: 'x' },
					{ loc: ['body', 'b'], msg: 'B', type: 'x' },
					{ loc: ['body', 'c'], msg: 'C', type: 'x' },
				],
			})) as typeof fetch;
		const error = await new Nexis({ apiKey: 'k', country: 'A|B||en' }).redact('x').catch((e: NexisError) => e);
		assert.equal(error.message, 'text: Field required; country: Too short; a: A; and 2 more');
		assert.equal(error.status, 422);
		assert.doesNotMatch(error.message, /John Smith|secret/);

		globalThis.fetch = (async () => json(400, { detail: 'Bad thing' })) as typeof fetch;
		await assert.rejects(new Nexis({ apiKey: 'k', country: 'A|B||en' }).redact('x'), /^NexisError: Bad thing$/);
	});
});

describe('anonymizeJson', () => {
	const nexis = () => new Nexis({ apiKey: 'k', country: 'UK GDPR|United Kingdom||en' });

	it('uploads the data as a file with the options, always naming the method', async () => {
		let seen: { url: string; init: RequestInit } | undefined;
		globalThis.fetch = (async (url: string, init: RequestInit) => {
			seen = { url, init };
			return json(200, { anonymised_data: { name: '[REDACTED]' } });
		}) as typeof fetch;
		const res = await nexis().anonymizeJson({ name: 'John Smith' }, { excludedEntities: ['URL'] });
		assert.deepEqual(res.anonymized_data, { name: '[REDACTED]' });
		assert.equal(seen?.url, 'https://api.nexis.intelation.com/api/structured/json/');
		const headers = seen?.init.headers as Record<string, string>;
		assert.match(headers['Idempotency-Key'], /^nexis-js-/);
		assert.equal(headers['Content-Type'], undefined);
		const form = seen?.init.body as FormData;
		assert.deepEqual(JSON.parse(await (form.get('file') as Blob).text()), { name: 'John Smith' });
		const options = JSON.parse(String(form.get('options')));
		assert.equal(options.anonymisation_method, 'redact');
		assert.equal(options.regulation, 'UK GDPR');
		assert.deepEqual(options.excluded_entities, ['URL']);
	});

	it('rejects what the JSON endpoint does not support before calling the API', async () => {
		globalThis.fetch = (async () => {
			throw new Error('should not be called');
		}) as typeof fetch;
		await assert.rejects(nexis().anonymizeJson({ a: 1 }, { method: 'hash' as never }), /does not support the hash method/);
		await assert.rejects(nexis().anonymizeJson({ a: 1 }, { selectedEntities: ['PERSON'] } as never), /selectedEntities/);
		await assert.rejects(nexis().anonymizeJson('text' as never), /object or array/);
	});
});
