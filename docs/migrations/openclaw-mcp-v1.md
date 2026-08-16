# OpenClaw MCP v1 — Frozen Compatibility Contract

**Change:** `nelupdf-full-audit`
**Work unit:** WU-1B1
**Status:** Frozen. Path/LLM security changes are future versioned migrations, never silent edits.

## What is frozen

The MCP facade (`src/mcp-facade.js`) exposes the three legacy tools through the
existing HTTP server at `/mcp`. WU-1B1 freezes that surface as contract v1 so an
OpenClaw consumer cannot be broken by an accidental rename, removal, or schema
change. The executable gate is the contract test in `test/openclaw-compat.test.js`
backed by the fixture `test/fixtures/openclaw-tools-v1.json`.

| Tool | Required input | Exact bounds |
| --- | --- | --- |
| `extract_pdf_from_path` | `path` | path 1..4096; maxPages 1..200; maxChars 1..200000 |
| `extract_pdf_from_base64` | `data` | data minLength 1; name 1..256; maxPages 1..200; maxChars 1..200000 |
| `extract_pdf_with_llm` | `path` | path 1..4096; prompt 1..16000; maxTokens 256..16000 |

The fixture records only names and `inputSchema`; descriptions and SDK `execution`
metadata are not part of the frozen contract.

## Session and result contract

- MCP transport is Streamable HTTP over `/mcp`. `initialize` binds an
  `mcp-session-id` that later calls reuse; a laia-shaped client speaks protocol
  `2024-11-05` and reuses that session.
- `extract_pdf_from_base64` returns the deterministic local result: `source`
  (`plain-text` for non-tabular), `confidence: "deterministic"`, `parser`, a
  64-hex `sha256`, and the untrusted-data `trustBoundary` marker. This meaning is
  stable; it is not silently replaced by model-derived output.
- Live internal wiring is `docker-compose2.yml` `pdf-tool` + `laia-imap-sidecar`,
  both healthy, with the sidecar reaching `pdf-tool:3000/mcp`.

## Versioned migration policy

Path-tool workspace authority and LLM/prompt security changes are **future
versioned migrations**. Any change to a frozen tool name or schema, or a change
to path authority or LLM prompt handling, MUST:

1. bump the contract fixture to a new `contractVersion` in a new fixture file
   (do not overwrite `openclaw-tools-v1.json`);
2. update the contract test to pin both v1 and the new version;
3. record consumer evidence (or an explicit typed migration result) before the
   old behavior changes.

Silently editing `src/mcp-facade.js` or `src/server.js` so the v1 fixture drifts
is forbidden and is caught by the WU-1B1 contract test.

## Historical directory

`/home/jmon/openclaw/services/pdf-tool-sidecar` is **historical and must not be
used as deployment evidence or a deploy source**. The live service is
`pdf-tool` in `/home/jmon/openclaw/docker-compose2.yml`.
