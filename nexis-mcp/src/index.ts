#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Nexis, NexisError } from '@intelation/nexis';
import { createServer } from './server.js';

async function main() {
	// stdout carries the protocol, so anything human-readable goes to stderr.
	const nexis = new Nexis({ baseUrl: process.env.NEXIS_BASE_URL, country: process.env.NEXIS_COUNTRY });
	await createServer(nexis).connect(new StdioServerTransport());
}

main().catch((error: NexisError) => {
	console.error(`nexis-mcp: ${error.message}`);
	if (error.description) console.error(error.description);
	process.exit(1);
});
