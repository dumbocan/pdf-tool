# Proposal: PDF Tool v0.2 Architecture

## Intent

Define one standalone HTTP-only PDF extraction service on top of the published v0.1 runtime: deterministic basic extraction, Spanish invoice fields, a specialized Mercadona table recognizer, and an explicit, evidence-gated MiniMax path. The v0.2 contract is minimal and additive: it keeps every published endpoint, request field, limit, and error shape, and adds only simple stateless truncation metadata and a simple source/confidence attribution. Consumers remain external HTTP clients.

## Scope

### In Scope

- Preserve the four published endpoints with their exact routes: `GET /healthz`, `GET /version`, `POST /extract`, `POST /extract-with-llm`.
- Preserve the exact request contract: `data` (base64 PDF bytes), optional `maxChars` (1–200,000), optional `maxPages` (1–200), and for the LLM route only `prompt` (≤16,000 chars), `maxTokens` (256–16,000, default 8,000), and `name` (≤256 chars).
- Preserve the published numeric limits: 16 MiB JSON body, 12 MiB decoded PDF, 200 pages, 200,000 extracted characters, 4,000 characters per page, 1 MiB serialized response, 180-second LLM upstream timeout.
- Preserve the published error contract: flat `{"error": "message"}` with statuses 400 / 401 / 404 / 413 / 502 / 503 / 504.
- Add stateless truncation metadata to `/extract` responses: `{ truncated: true, truncation: { reason, applied, allowed, requiresUserConfirmation: true } }`. The server keeps no state, no IDs, and no sessions; the consumer asks the human and retries with higher limits within the hard caps.
- Add a simple response-level source attribution: `source` ∈ `{"mercadona-tabular", "invoice-fields", "plain-text", "minimax"}` and `confidence` ∈ `{"deterministic", "model-derived"}`. No per-field provenance, no conflict/candidate schemes.
- Keep the Mercadona parser as a specialized deterministic recognizer (selected only when ≥3 tabular rows are detected), never as a universal document model.
- Keep MiniMax explicit and evidence-gated: only `POST /extract-with-llm` invokes it, it receives only extracted text (never PDF bytes), and it is not presented as verified until accepted live or authoritative evidence records the exact accepted response shape. Until then it is experimental and fails honestly (502/503/504) when the provider does not meet the strict contract.

### Out of Scope

- MCP/stdio, OCR, an alternate Python server, UI, databases/caches, embeddings/search, SDKs, or OpenClaw scripts.
- Automatic hidden fallback to the LLM, consumer-specific code, or existing-consumer migration (the OpenClaw MCP consumers are a separate migration boundary).
- Any server-side state: continuation IDs, retry tokens, sessions, or limit-expansion negotiation.
- Per-field provenance/uncertainty wrappers, conflict candidates, or precedence schemas.
- Claiming MiniMax output is verified before accepted live or authoritative contract evidence exists.

## Capabilities

### New Capabilities

- `pdf-extraction-service`: Bounded deterministic HTTP extraction via `POST /extract`, invoice-field recognition, the specialized Mercadona recognizer, and stateless truncation metadata.
- `structured-document-fallback`: Explicit, evidence-gated MiniMax extraction via `POST /extract-with-llm` with strict response validation and honest failures.
- `pdf-service-security-operations`: Routes, optional bearer auth, numeric limits, error mapping, untrusted-content handling, and deployment/CI evidence policy.

### Modified Capabilities

- None.

## Approach

Keep one Node.js 22 native-ESM service. `GET /healthz` and `GET /version` stay public. `POST /extract` runs bounded `pdfjs-dist` extraction with deterministic invoice-field and Mercadona recognizers and returns the documented envelope plus the simple truncation metadata. `POST /extract-with-llm` performs the same bounded extraction and then sends only the extracted text to MiniMax under a strict structured-response contract; any non-conforming provider output is rejected. Optional bearer auth (`AUTH_TOKEN`) protects both POST routes when configured. No server state is introduced; consumers own bytes, base64, timeouts, auth, endpoint choice, retry decisions (with human confirmation), and error handling.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/server.js` | Modified | Truncation metadata, source/confidence attribution, and contract alignment. |
| `src/extract.js`, `src/mercadona-parser.js` | Modified | Extraction metadata and recognizer output shaping. |
| `test/*.test.js` | Modified | Contract, truncation, source attribution, auth, limits, and provider-failure tests. |
| `README.md`, Docker/Compose, `.env.example`, `deploy.sh` | Modified | Documented HTTP contract, bounds, evidence gate, and deployment policy. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| MiniMax accepted response shape remains unresolved | High | Named evidence gate; the route stays experimental and rejects non-conforming responses (502); no implementation claim without accepted evidence. |
| Contract drift vs. the published v0.1 runtime | Medium | Specs and design reference the exact field names and limits verified in `src/server.js`; additive surfaces are isolated. |
| Consumers expect server-side retry negotiation | Medium | Truncation is explicitly stateless metadata with `requiresUserConfirmation: true`; consumers ask the human and retry within hard caps. |
| Legacy OpenClaw consumers still speak MCP | High | Separate migration change with explicit compatibility/error mapping; not part of this slice. |

## Rollback Plan

Revert the service change and restore the prior HTTP contract. If MiniMax evidence or deployment checks fail, disable the LLM route (unset `MINIMAX_API_KEY` → 503) while `/extract` remains intact, or revert the image.

## Dependencies

- Node.js 22, `pdfjs-dist` 4.10.38, Docker Compose, and MiniMax contract evidence (for moving the LLM route out of experimental status).

## Success Criteria

- [ ] The four endpoints, request fields (`data`, `maxChars`, `maxPages`, `prompt`, `maxTokens`, `name`), limits, and error shapes match the published runtime exactly.
- [ ] `/extract` returns bounded deterministic output with stateless truncation metadata and simple `source`/`confidence` attribution.
- [ ] `/extract-with-llm` is explicit, sends only extracted text, validates the structured response strictly, and fails honestly when the provider does not meet the contract.
- [ ] No server-side state, continuation IDs, retry tokens, or per-field provenance/conflict schemes appear anywhere in the contract.
- [ ] Native tests, `docker compose config`, and CI audit requirements pass.
