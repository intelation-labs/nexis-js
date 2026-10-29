# @intelation/nexis-ai

[![npm](https://img.shields.io/npm/v/@intelation/nexis-ai)](https://www.npmjs.com/package/@intelation/nexis-ai) [![tests](https://github.com/intelation-labs/nexis-js/actions/workflows/test.yml/badge.svg)](https://github.com/intelation-labs/nexis-js/actions/workflows/test.yml) [![types](https://img.shields.io/npm/types/@intelation/nexis-ai)](https://www.npmjs.com/package/@intelation/nexis-ai) [![provenance](https://img.shields.io/badge/npm-provenance-2ea44f)](https://docs.npmjs.com/generating-provenance-statements) [![license](https://img.shields.io/npm/l/@intelation/nexis-ai)](https://github.com/intelation-labs/nexis-js/blob/main/nexis-ai/LICENSE.md)

Privacy middleware for the [Vercel AI SDK](https://ai-sdk.dev). One line removes personal data (PII) from every prompt before it reaches the LLM. Regulation-aware (UK GDPR, GDPR, HIPAA, Privacy Act), powered by [Intelation Nexis](https://nexis.intelation.com).

Full guide: [intelation.com/integrations/javascript](https://www.intelation.com/integrations/javascript).

```bash
npm install @intelation/nexis-ai ai
export NEXIS_API_KEY=...   # free key: https://nexis.intelation.com
```

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Nexis, withNexis } from '@intelation/nexis-ai';

const model = withNexis(openai('gpt-4o'), new Nexis());

await generateText({ model, prompt: 'Summarise the ticket from john.smith@example.com, NHS 943 476 5919' });
// The model receives: "Summarise the ticket from [REDACTED], NHS [REDACTED]"
```

Works with any provider and with `generateText`, `streamText` and `generateObject`. Supports AI SDK v5, v6 and v7.

## What is cleaned

| Prompt part | Cleaned |
|---|---|
| System prompt, user and assistant text | Yes |
| Reasoning text | Yes |
| Tool-call arguments | Yes, every string value |
| Tool results: text, JSON, error text/JSON, and text items in content results | Yes, every string value |
| Images and files (in messages or tool results) | **No.** They are sent to the model unchanged, so do not put personal data in them |

JSON (tool arguments and results) goes to the Nexis JSON endpoint (Basic plan and above), which keeps keys, numbers and other non-text values. With `hash` or `tokenization`, or with `anonymize.selectedEntities`, each string value is cleaned separately instead, at one API call per value.

## Options

```ts
withNexis(model, nexis, {
	method: 'redact',           // redact | replace | mask | hash | pseudonymization | tokenization | encryption
	anonymize: { country: 'HIPAA|United States||en', allowList: ['support@example.com'] },
	onError: 'throw',           // 'throw' (default) blocks the call; 'pass-through' sends the original text
	cache: true,                // history re-sent each turn is not processed again
	concurrency: 5,             // parallel Nexis calls, a whole number of 1 or more
});
```

**Fail-closed by default:** if Nexis cannot be reached, the call is stopped rather than sending unprotected text.

## Show the user the real values again

With reversible encryption the model works on placeholders and the user still sees the original text:

```ts
const model = withNexis(openai('gpt-4o'), new Nexis(), {
	method: 'encryption',
	restore: true,                  // needs NEXIS_ENCRYPTION_KEY
});
```

Restore works with both `generateText` and `streamText`. When streaming, the reply may pause briefly where an original value appears, while it is decrypted. If the model alters a placeholder, that value is shown as the model wrote it and the others are still restored.

## Cost

Each distinct piece of text, and each JSON tool argument or result, is one Nexis API call; results are cached per model instance.

## Also available

- [@intelation/nexis](https://www.npmjs.com/package/@intelation/nexis): SDK and CLI
- [@intelation/nexis-mcp](https://www.npmjs.com/package/@intelation/nexis-mcp): MCP server for Claude, Cursor and more

MIT © Intelation
