# Changelog

## 0.2.1

### @intelation/nexis-mcp
- Listed on the official MCP Registry as `io.github.intelation-labs/nexis-mcp` (new `mcpName` in `package.json`).
- New `npm run pack:mcpb` builds an MCPB bundle for Smithery and one-click Claude Desktop installs.
- "Add to Cursor" button in the README.

## 0.2.0

### @intelation/nexis
- New `anonymizeJson()`: cleans the string values of a JSON object or array through the Nexis JSON endpoint.
- New `allowPartial` option on `decrypt()`: returns the text even when some values stay encrypted, with `decrypted_count` and `failed_count`.
- API validation errors now list the fields at fault (never the values sent).
- A country object with a blank `language` now uses `"en"`, like the text format.
- CLI: an unknown command is reported before a missing API key; new `--version` / `-v`.

### @intelation/nexis-mcp
- **Change of behaviour:** `decrypt_text` is off by default. Set `NEXIS_ALLOW_DECRYPT=true` to turn it on. When on, the assistant sees the decrypted personal data.
- The server reports its real package version.
- The package can be imported as a library: `import { createServer } from '@intelation/nexis-mcp'` (with types). Importing no longer starts a server; the `nexis-mcp` command is unchanged.

### @intelation/nexis-ai
- Now cleans tool-call arguments, JSON and error-JSON tool results, text items in content tool results, and reasoning text. Files and images are still not scanned.
- `restore` now works with `streamText` as well as `generateText`.
- `restore` shows every value it can decrypt, even when one placeholder was altered by the model.
- `concurrency` below 1, or not a whole number, now throws instead of sending text uncleaned.
- Needs `@intelation/nexis` 0.2.0.
