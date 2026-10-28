#!/usr/bin/env node
import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Nexis, NexisError } from '@intelation/nexis';
import { createServer } from './server.js';

async function main() {
	// stdout carries the protocol, so anything human-readable goes to stderr.
	const nexis = new Nexis({ baseUrl: process.env.NEXIS_BASE_URL, country: process.env.NEXIS_COUNTRY });
	// package.json ships in every release, one level above dist/.
	const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
	const allowDecrypt = process.env.NEXIS_ALLOW_DECRYPT === 'true';
	await createServer(nexis, { version, allowDecrypt }).connect(new StdioServerTransport());
}

main().catch((error: NexisError) => {
	console.error(`nexis-mcp: ${error.message}`);
	if (error.description) console.error(error.description);
	process.exit(1);
});
