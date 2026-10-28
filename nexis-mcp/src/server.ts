import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Nexis, NexisError } from '@intelation/nexis';
import type { NexisResponse } from '@intelation/nexis';
import { z } from 'zod';

const country = z
	.string()
	.optional()
	.describe(
		'Country and regulation as "regulation|country|sub-region|language", e.g. "UK GDPR|United Kingdom||en". Use list_countries to see valid values. Defaults to the first country in the account plan.',
	);

const entities = {
	selectedEntities: z.array(z.string()).optional().describe('Only process these entity types (e.g. EMAIL_ADDRESS)'),
	excludedEntities: z.array(z.string()).optional().describe('Leave these entity types untouched'),
};

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const data = (value: unknown) => text(JSON.stringify(value, null, 2));

/** Tool errors go back to the model as readable text instead of failing the protocol call. */
async function run(fn: () => Promise<{ content: { type: 'text'; text: string }[] }>) {
	try {
		return await fn();
	} catch (error) {
		const e = error as NexisError;
		return { ...text(`${e.message}${e.description ? `\n${e.description}` : ''}`), isError: true };
	}
}

export interface ServerOptions {
	/** Version the server reports to clients. The nexis-mcp command passes its package version. */
	version: string;
	/**
	 * Register decrypt_text. Default false. When on, the model sees the decrypted personal data, so enable it only
	 * when the assistant is meant to read the original values.
	 */
	allowDecrypt?: boolean;
}

/**
 * Creates the Nexis MCP server. The encryption key is read only from NEXIS_ENCRYPTION_KEY and is never a tool
 * argument, so the key itself never reaches the model. With allowDecrypt on, the decrypted values do.
 */
export function createServer(nexis: Nexis, options: ServerOptions): McpServer {
	const server = new McpServer({ name: 'nexis', version: options.version });

	server.registerTool(
		'anonymize_text',
		{
			title: 'Anonymize text',
			description:
				'Find and remove personal data (PII: names, emails, phone numbers, NHS/SSN numbers, etc.) from text. Use this BEFORE sharing, storing or sending text that may contain personal data. Returns the anonymized text.',
			inputSchema: {
				text: z.string().describe('The text to anonymize'),
				method: z
					.enum(['redact', 'replace', 'mask', 'hash', 'pseudonymization', 'tokenization', 'encryption'])
					.default('redact')
					.describe(
						'redact -> [REDACTED]; replace -> <PERSON>; mask -> ****; hash -> short SHA-256; pseudonymization -> realistic fake value; tokenization -> ENTITY_001; encryption -> reversible with the key in NEXIS_ENCRYPTION_KEY (decrypt_text is only available when the server sets NEXIS_ALLOW_DECRYPT=true)',
					),
				country,
				...entities,
				allowList: z.array(z.string()).optional().describe('Values that must never be anonymized'),
				denyList: z.array(z.string()).optional().describe('Values that must always be anonymized'),
			},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		(args) =>
			run(async () => {
				const res = await nexis.anonymize(args.text, args);
				return text(String(res.anonymized_text ?? JSON.stringify(res)));
			}),
	);

	server.registerTool(
		'detect_pii',
		{
			title: 'Detect PII',
			description:
				'List the personal data (PII) found in text, with entity types and positions, without changing the text. Max 5,000 characters.',
			inputSchema: { text: z.string(), country, ...entities },
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		(args) => run(async () => data((await nexis.detect(args.text, args)) as NexisResponse)),
	);

	if (options.allowDecrypt) {
		server.registerTool(
			'decrypt_text',
			{
				title: 'Decrypt text',
				description:
					'Restore values that anonymize_text encrypted (they look like <<ENC:...:ENC>>). Uses the key in NEXIS_ENCRYPTION_KEY. Warning: the result contains the original personal data, which you (the assistant) will then see. Only decrypt when the user needs the original values.',
				inputSchema: { encryptedText: z.string() },
				annotations: { readOnlyHint: true, openWorldHint: true },
			},
			(args) =>
				run(async () => {
					const res = await nexis.decrypt(args.encryptedText);
					return text(String(res.decrypted_text ?? JSON.stringify(res)));
				}),
		);
	}

	server.registerTool(
		'list_countries',
		{
			title: 'List countries',
			description: 'List the countries and regulations available in the Nexis account plan.',
			inputSchema: {},
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		() =>
			run(async () => {
				const list = await nexis.countries();
				return text(list.map((c) => [c.regulation, c.country, c.subRegion, c.language].join('|')).join('\n'));
			}),
	);

	return server;
}
