# @intelation/nexis-mcp

MCP server that lets Claude, Cursor, VS Code and other AI assistants find and remove personal data (PII) from text. Regulation-aware (UK GDPR, GDPR, HIPAA, Privacy Act), powered by [Intelation Nexis](https://nexis.intelation.com).

Full guide: [intelation.com/integrations/javascript](https://www.intelation.com/integrations/javascript).

## Setup

Get a free API key at https://nexis.intelation.com, then add the server to your MCP client.

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
| `decrypt_text` | Restore values encrypted by `anonymize_text` |
| `list_countries` | Countries and regulations in your plan |

## Environment

| Variable | |
|---|---|
| `NEXIS_API_KEY` | Required |
| `NEXIS_COUNTRY` | Default `regulation\|country\|sub-region\|language`; otherwise the first country in your plan |
| `NEXIS_ENCRYPTION_KEY` | Fernet key for the encryption method and `decrypt_text` |
| `NEXIS_BASE_URL` | Only for a dedicated or on-premises instance |

The encryption key is read only from the environment and is never a tool argument, so it never passes through the model.

MIT © Intelation
