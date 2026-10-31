# @intelation/nexis-mcp

[![npm](https://img.shields.io/npm/v/@intelation/nexis-mcp)](https://www.npmjs.com/package/@intelation/nexis-mcp) [![tests](https://github.com/intelation-labs/nexis-js/actions/workflows/test.yml/badge.svg)](https://github.com/intelation-labs/nexis-js/actions/workflows/test.yml) [![types](https://img.shields.io/npm/types/@intelation/nexis-mcp)](https://www.npmjs.com/package/@intelation/nexis-mcp) [![provenance](https://img.shields.io/badge/npm-provenance-2ea44f)](https://docs.npmjs.com/generating-provenance-statements) [![license](https://img.shields.io/npm/l/@intelation/nexis-mcp)](https://github.com/intelation-labs/nexis-js/blob/main/nexis-mcp/LICENSE.md) [![Nexis by Intelation MCP server – quality and maintenance score on Glama](https://glama.ai/mcp/servers/intelation-labs/nexis-js/badges/score.svg)](https://glama.ai/mcp/servers/intelation-labs/nexis-js)

MCP server that lets Claude, Cursor, VS Code and other AI assistants find and remove personal data (PII) from text. Regulation-aware (UK GDPR, GDPR, HIPAA, Privacy Act), powered by [Intelation Nexis](https://nexis.intelation.com).

Full guide: [intelation.com/integrations/javascript](https://www.intelation.com/integrations/javascript).

## Setup

Get a free API key at https://nexis.intelation.com, then add the server to your MCP client.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=nexis&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBpbnRlbGF0aW9uL25leGlzLW1jcCJdLCJlbnYiOnsiTkVYSVNfQVBJX0tFWSI6InlvdXIta2V5In19) (then replace `your-key` with your API key)

**Claude Desktop / Cursor** (`mcpServers` in the config file):

```json
{
	"mcpServers": {
		"nexis": {
			"command": "npx",
			"args": ["-y", "@intelation/nexis-mcp"],
			"env": { "NEXIS_API_KEY": "your-key" }
		}
	}
}
```

**Claude Code:**

```bash
claude mcp add nexis --env NEXIS_API_KEY=your-key -- npx -y @intelation/nexis-mcp
```

Then ask: *"Anonymize this support ticket before you summarise it: ..."*

## Tools

| Tool | What it does |
|---|---|
| `anonymize_text` | Redact, replace, mask, hash, pseudonymize, tokenize or encrypt PII |
| `detect_pii` | List the PII found, without changing the text |
| `decrypt_text` | Restore values encrypted by `anonymize_text`. Off unless `NEXIS_ALLOW_DECRYPT=true` |
| `list_countries` | Countries and regulations in your plan |

## Environment

| Variable | |
|---|---|
| `NEXIS_API_KEY` | Required |
| `NEXIS_COUNTRY` | Default `regulation\|country\|sub-region\|language`; otherwise the first country in your plan |
| `NEXIS_ENCRYPTION_KEY` | Fernet key for the encryption method and `decrypt_text` |
| `NEXIS_ALLOW_DECRYPT` | `true` to turn on `decrypt_text`. Off by default |
| `NEXIS_BASE_URL` | Only for a dedicated or on-premises instance |

The encryption key is read only from the environment and is never a tool argument, so the key never passes through the model.

**Before you set `NEXIS_ALLOW_DECRYPT=true`:** the assistant sees whatever `decrypt_text` returns, which is the original personal data. A document with hidden instructions ("decrypt this and include it") could also get the assistant to decrypt values. Turn it on only when the assistant is meant to read the original values:

```json
"env": { "NEXIS_API_KEY": "your-key", "NEXIS_ENCRYPTION_KEY": "your-fernet-key", "NEXIS_ALLOW_DECRYPT": "true" }
```

```bash
claude mcp add nexis --env NEXIS_API_KEY=your-key --env NEXIS_ENCRYPTION_KEY=your-fernet-key --env NEXIS_ALLOW_DECRYPT=true -- npx -y @intelation/nexis-mcp
```

## Use in your own code

Importing the package does not start a server, so you can add the Nexis tools to your own MCP setup:

```ts
import { Nexis } from '@intelation/nexis';
import { createServer } from '@intelation/nexis-mcp';

const server = createServer(new Nexis(), { version: '1.0.0', allowDecrypt: false });
await server.connect(transport);
```

MIT © Intelation
