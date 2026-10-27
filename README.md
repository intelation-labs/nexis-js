<img src="assets/logo.svg" alt="Intelation" width="64">

# Intelation Nexis for JavaScript

Keep personal data (PII) out of your LLMs, logs and vendors. Find and remove names, emails, phone numbers, NHS and SSN numbers from text – regulation-aware (UK GDPR, GDPR, HIPAA, Privacy Act), powered by [Intelation Nexis](https://nexis.intelation.com).

![Redacting and tokenizing a patient record from the terminal](assets/cli-demo.gif)

| Package | Use it to | npm |
|---|---|---|
| [`@intelation/nexis`](nexis) | Clean text in your own code or from the terminal. Zero dependencies. | [![npm](https://img.shields.io/npm/v/@intelation/nexis)](https://www.npmjs.com/package/@intelation/nexis) |
| [`@intelation/nexis-mcp`](nexis-mcp) | Let Claude, Cursor or VS Code remove PII on request. | [![npm](https://img.shields.io/npm/v/@intelation/nexis-mcp)](https://www.npmjs.com/package/@intelation/nexis-mcp) |
| [`@intelation/nexis-ai`](nexis-ai) | Strip PII from every prompt in a Vercel AI SDK app, in one line. | [![npm](https://img.shields.io/npm/v/@intelation/nexis-ai)](https://www.npmjs.com/package/@intelation/nexis-ai) |

Get a free API key at https://nexis.intelation.com. Full guide: [intelation.com/integrations/javascript](https://www.intelation.com/integrations/javascript).

## Quick start

**SDK and CLI**

```bash
npx @intelation/nexis redact "Email john.smith@example.com, NHS 943 476 5919"
# -> Email [REDACTED], NHS [REDACTED]
```

**MCP server** (Claude Code)

```bash
claude mcp add nexis --env NEXIS_API_KEY=your-key -- npx -y @intelation/nexis-mcp
```

**AI SDK middleware**

```ts
const model = withNexis(openai('gpt-4o'), new Nexis());
// Every prompt sent through `model` has its PII removed first.
```

See each package's README for the full options.

## What it can do

- **Redact, replace, mask or hash** personal data
- **Pseudonymize** with realistic fake values, or **tokenize** with `ENTITY_001` placeholders
- **Encrypt** reversibly, and decrypt later with your own key
- **Detect** PII without changing the text

## Also available

- [n8n-nodes-nexis](https://www.npmjs.com/package/n8n-nodes-nexis): the same engine as an n8n node.

## Development

```bash
npm install
npm run build
npm test
```

MIT © Intelation
