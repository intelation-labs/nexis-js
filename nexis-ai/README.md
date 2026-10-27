# @intelation/nexis-ai

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

System prompt, user and assistant messages, and text tool results. Images and files are not scanned.

## Options

```ts
withNexis(model, nexis, {
	method: 'redact',           // redact | replace | mask | hash | pseudonymization | tokenization | encryption
	anonymize: { country: 'HIPAA|United States||en', allowList: ['support@example.com'] },
	onError: 'throw',           // 'throw' (default) blocks the call; 'pass-through' sends the original text
	cache: true,                // history re-sent each turn is not processed again
	concurrency: 5,
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

Restore applies to `generateText`, not to streams, and if the model alters a placeholder that part of the reply is shown as the model wrote it.

## Cost

Each distinct piece of text is one Nexis API call; results are cached per model instance.

## Also available

- [@intelation/nexis](https://www.npmjs.com/package/@intelation/nexis): SDK and CLI
- [@intelation/nexis-mcp](https://www.npmjs.com/package/@intelation/nexis-mcp): MCP server for Claude, Cursor and more

MIT © Intelation
