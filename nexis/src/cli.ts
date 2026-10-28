#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Nexis } from './client.js';
import type { AnonymizeOptions } from './client.js';
import { NexisError } from './errors.js';

const METHODS: AnonymizeOptions['method'][] = [
	'redact',
	'mask',
	'hash',
	'replace',
	'pseudonymization',
	'tokenization',
	'encryption',
];
const COMMANDS = [...METHODS, 'detect', 'decrypt', 'countries'];

const HELP = `nexis – find and remove personal data (PII) from text

Usage:
  nexis <command> [text] [--country "regulation|country|sub-region|language"] [--json]
  nexis --version

Commands:
  redact | mask | hash | replace | pseudonymization | tokenization | encryption   anonymize text
  detect                                                                         list the PII found
  decrypt                                                                        restore encrypted text
  countries                                                                      countries in your plan

Text is read from stdin when not given as an argument.
Environment: NEXIS_API_KEY (required), NEXIS_ENCRYPTION_KEY (encryption/decrypt)
Free API key: https://nexis.intelation.com
`;

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return '';
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

async function main() {
	const args = process.argv.slice(2);
	const command = args.shift();
	if (!command || command === '-h' || command === '--help') return console.log(HELP);
	if (command === '-v' || command === '--version') {
		// The CLI runs from dist/esm/, two levels below package.json.
		return console.log(createRequire(import.meta.url)('../../package.json').version);
	}
	// Checked before the API key and stdin, so a typo is reported as a typo.
	if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
		throw new NexisError(`Unknown command "${command}"`, { description: 'Run nexis --help' });
	}

	let country: string | undefined;
	let json = false;
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--country') country = args[++i];
		else if (args[i] === '--json') json = true;
		else rest.push(args[i]);
	}
	const nexis = new Nexis({ country });
	const print = (value: unknown) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

	if (command === 'countries') {
		const list = await nexis.countries();
		return print(json ? list : list.map((c) => [c.regulation, c.country, c.subRegion, c.language].join('|')).join('\n'));
	}
	const text = rest.join(' ') || (await readStdin()).trimEnd();

	if (command === 'detect') return print(await nexis.detect(text));
	if (command === 'decrypt') {
		const res = await nexis.decrypt(text);
		return print(json ? res : res.decrypted_text);
	}
	const method = METHODS.find((m) => m === command);
	const res = await nexis.anonymize(text, { method });
	return print(json ? res : (res.anonymized_text ?? res));
}

main().catch((error: Error & { description?: string }) => {
	console.error(`Error: ${error.message}`);
	if (error.description) console.error(error.description);
	process.exit(1);
});
