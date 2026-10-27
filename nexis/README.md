# @intelation/nexis

Find and remove personal data (PII) from text before it reaches an LLM, a log, a vendor or a researcher. Regulation-aware (UK GDPR, GDPR, HIPAA, Privacy Act), powered by [Intelation Nexis](https://nexis.intelation.com). Zero dependencies, Node 18+.

Full guide: [intelation.com/integrations/javascript](https://www.intelation.com/integrations/javascript).

```bash
npm install @intelation/nexis
export NEXIS_API_KEY=...   # free key: https://nexis.intelation.com
```

```ts
import { Nexis } from '@intelation/nexis';

const nexis = new Nexis();
const { anonymized_text } = await nexis.redact('Email john.smith@example.com, NHS 943 476 5919');
// -> "Email [REDACTED], NHS [REDACTED]"
```

## Try it from the terminal

![Redacting and tokenizing a patient record from the terminal](https://raw.githubusercontent.com/intelation-labs/nexis-js/main/assets/cli-demo.gif)

```bash
npx @intelation/nexis redact "Call Jane Doe on 020 7946 0958"
echo "patient notes..." | npx @intelation/nexis pseudonymization --country "HIPAA|United States||en"
```

## Methods

| Call | Result |
|---|---|
| `redact` | `[REDACTED]` |
| `replace` | entity type, e.g. `<PERSON>` |
| `mask` | `****` (options: `maskingChar`, `charsToMask`, `fromEnd`) |
| `hash` | first 10 chars of SHA-256 |
| `pseudonymization` | realistic fake value of the same type |
| `tokenization` | `ENTITY_001` placeholders |
| `encryption` / `decrypt` | reversible, needs a Fernet key (`NEXIS_ENCRYPTION_KEY`) |
| `detect` | lists the PII found, text unchanged (max 5,000 chars) |

Options on every call: `country` (`"regulation|country|sub-region|language"` or object; defaults to the first country in your plan), `selectedEntities`, `excludedEntities`, `allowList`, `denyList`.

## Errors

Failures throw `NexisError` with a plain-English `message`, a `description` saying what to do next, and the HTTP `status`.

## Also available

- [n8n-nodes-nexis](https://www.npmjs.com/package/n8n-nodes-nexis): the same engine as an n8n node.

MIT © Intelation
