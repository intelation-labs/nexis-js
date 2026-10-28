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
npx @intelation/nexis --version
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

Options on every call: `country` (`"regulation|country|sub-region|language"` or object; defaults to the first country in your plan, and a blank language means `en`), `selectedEntities`, `excludedEntities`, `allowList`, `denyList`.

## JSON

`anonymizeJson` cleans every string value in an object or array and keeps the keys and other values (Basic plan and above):

```ts
const { anonymized_data } = await nexis.anonymizeJson({ customer: { name: 'Jane Doe', orders: 3 } });
// -> { customer: { name: '[REDACTED]', orders: 3 } }
```

It supports `redact`, `mask`, `replace`, `encryption` and `pseudonymization` (listed in `JSON_METHODS`), and `excludedEntities` but not `selectedEntities` or `fromEnd`. For anything else, call `anonymize` on each string.

## Decrypt

`decrypt` throws when any value stays encrypted (for example with the wrong key). Pass `allowPartial: true` to get the text back anyway, with `decrypted_count` and `failed_count`:

```ts
const res = await nexis.decrypt(text, { allowPartial: true });
if (res.failed_count) console.warn(`${res.failed_count} values could not be decrypted`);
```

## Errors

Failures throw `NexisError` with a plain-English `message`, a `description` saying what to do next, and the HTTP `status`. Validation errors list the fields at fault (e.g. `text: Field required`), never the values you sent.

## Also available

- [n8n-nodes-nexis](https://www.npmjs.com/package/n8n-nodes-nexis): the same engine as an n8n node.

MIT © Intelation
