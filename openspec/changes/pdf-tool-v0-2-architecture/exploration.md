## Exploration: pdf-tool-v0-2-architecture

### Current State

`pdf-tool` is a standalone Node.js 22 native-ESM HTTP service using `pdfjs-dist` 4.10.38. It has no MCP server, Python runtime, persistence, OCR, or document-JavaScript execution.

- `POST /extract` accepts canonical base64 PDF bytes and performs bounded text extraction, deterministic Spanish invoice-field extraction, and the restored Mercadona tabular parser. The Mercadona parser is selected only after at least three detected rows; otherwise the result is `plain-text`.
- `POST /extract-with-llm` extracts bounded text locally, then sends text—not PDF bytes—to MiniMax through an OpenAI-compatible `/chat/completions` request. It currently accepts one exact JSON object in assistant `message.content`, one fenced JSON object, or one compatible `extract_document_structure` function call.
- `GET /healthz` and `/version` are unauthenticated. POST endpoints support optional bearer authentication. README and the API examples correctly describe Python as an HTTP consumer, not an in-service implementation.
- The v0.1 standalone decision intentionally removed the Mercadona-specific parser for simplicity. The current requirement explicitly reverses that decision: Mercadona is a supported deterministic capability, while the service remains universal and HTTP-only. The current checkout already contains the restored parser; the architectural work is to make that restoration coherent with generic documents and an honest fallback contract.

Prior Engram evidence records the former OpenClaw implementation as MCP-first, with mail-sidecar and Python consumers coupled to MCP sessions. Those consumers are migration references only: the standalone boundary must be plain HTTP. Existing OpenClaw clients still target `http://pdf-tool-sidecar:3000/mcp`, so consumer migration is outside this repository but is an explicit compatibility boundary.

### Affected Areas

- `src/extract.js` — bounded PDF validation/extraction and invoice-field schema; current deterministic output is invoice-oriented.
- `src/mercadona-parser.js` — restored Mercadona row parser; it is useful as a format-specific parser, but its output is not a universal document model.
- `src/server.js` — owns the HTTP contract, result normalization, auth/limits, MiniMax request, and strict response parsing. This is the main architectural seam.
- `test/extract.test.js` — PDF magic, size, page/character bounds, cleanup, and cancellation coverage.
- `test/invoice-fields.test.js` — Spanish invoice-field behavior and safety bounds.
- `test/parser.test.js` — Mercadona rows, headers/footers, deduplication, and manual prose non-match.
- `test/server.test.js` — HTTP health/version/auth/request/error contract.
- `test/extract-with-llm.test.js` — mocked MiniMax request and accepted/rejected response shapes, including the real Mercadona fixture for deterministic parsing.
- `README.md` — public API, trust boundary, deployment, and Node/Python consumer examples; it currently documents the desired LLM schema more confidently than live evidence supports.
- `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `.env.example`, `deploy.sh` — deployment and resource/auth configuration. The current `deploy.sh` has a complete health-check loop and passes the shell syntax gate; deployment runtime behavior remains a separate operational concern.
- OpenClaw reference consumers: `services/*-sidecar/src/pdf-tool-client.js` and `workspace/.runners/ingest_mercadona.py` still implement MCP session/JSON-RPC calls. They establish the required consumer responsibilities (download bytes, bound calls, parse stable JSON, handle failure), but must not be copied into the standalone service.

### Evidence and Contract Gaps

1. **MiniMax live contract remains unresolved.** Live HTTP transport and authentication work, but no live response has yet satisfied the strict structured parser. Prior metadata-only live evidence showed HTTP 200 responses without tool calls and `finish_reason: "length"` when thinking/tool forcing was used; a later bounded live call still returned HTTP 502 `LLM upstream response invalid`. The exact accepted provider response shape is therefore unresolved. The current parser inspects `choices[0].message.content` or one compatible tool call; implementation should not broaden that contract without capturing an actual accepted shape or authoritative provider evidence.
2. **The universal schema is incomplete.** Deterministic output has `text`, page/truncation metadata, invoice fields, Mercadona line items, parser stats, hash, and a trust warning. The LLM schema has `documentType`, free-form `fields`, free-form `lineItems`, `sections`, and string warnings. There is no shared typed envelope for invoice, manual, and other documents, no explicit deterministic-vs-LLM provenance/status, and no normalized error/uncertainty model. `lineItems` and `sections` are only checked as arrays; their element shapes are not validated.
3. **Fallback policy is ambiguous.** The endpoint is explicit (`/extract-with-llm`) rather than an automatic fallback. That is safer and easier for consumers, but the architecture must define when a consumer calls it: deterministic extraction succeeds but is insufficient, or the document is not trustworthy for a deterministic parser. It must not silently turn provider failure into fabricated structured data.
4. **Proof is local/mocked, not live or end-to-end.** Prior evidence reports the current native suite passing after the v0.2 changes, but no live MiniMax proof has produced an accepted structured result. There is no E2E consumer proof, no coverage gate, and no external-service test layer. The test suite covers the current parser branches but not the actual provider response that fails in production.

### Security and Resource Constraints

The smallest architecture should preserve the existing limits and trust boundary: 12 MiB raw PDF, 16 MiB JSON request, at most 200 pages, 200,000 extracted characters, 4,000 characters per page, 1 MiB serialized response, bounded prompt (16,000 chars), bounded LLM tokens (16,000), and a 180-second upstream timeout. PDF magic bytes are checked; pdfjs disables eval, fonts, images, and persistence; extracted text, parser output, and LLM output remain untrusted. The service must not follow links, execute instructions from documents, log document data/secrets, or expose upstream details.

Known operational gaps are not reasons to add speculative infrastructure: no rate/concurrency limiter is present, bearer auth is intentionally fail-open when empty, TLS is delegated to a private network or reverse proxy, and production Compose currently requires a MiniMax key even though deterministic extraction is useful without one. These should be explicit deployment-policy decisions, not hidden fallbacks. Do not add OCR, a database/cache, an SDK, MCP/stdio transport, or a Python server implementation in this change.

### Approaches

1. **Keep separate deterministic and explicit LLM HTTP endpoints, with a small shared document envelope** — Preserve `/extract` and `/extract-with-llm`; normalize both into a documented envelope with parser provenance, confidence/uncertainty, and bounded typed arrays. Keep the Mercadona parser as one deterministic recognizer and keep LLM invocation explicit.
   - Pros: smallest change; preserves current HTTP consumers and security limits; deterministic results remain reproducible; provider failures remain visible; manuals and other PDFs fit without pretending regex can understand them.
   - Cons: two calls for consumers that need fallback; the MiniMax provider shape still needs bounded live diagnosis and an adapter contract.
   - Effort: Medium

2. **One automatic `/extract` pipeline that invokes the LLM whenever deterministic parsing is incomplete** — Make the server decide when to call MiniMax and return one result.
   - Pros: simpler consumer flow and one apparent API.
   - Cons: hides cost/latency and provider failure; makes deterministic behavior less predictable; couples universal extraction to an optional external dependency; weakens operational control for mail consumers.
   - Effort: Medium/High

3. **Split into specialist services (invoice/Mercadona/manual/LLM) behind a router** — Introduce internal service/plugin routing.
   - Pros: independently scalable specialists.
   - Cons: contradicts the standalone/no-overengineering goal; multiplies deployment and security boundaries; unnecessary before evidence shows a scaling or parser-isolation problem.
   - Effort: High

### Recommendation

Choose Approach 1. Treat `pdf-tool` as one HTTP extraction service with a deterministic-first capability set and an explicit, optional LLM fallback. Restore Mercadona as a supported parser because the current user requirement overrides the old v0.1 simplification, but keep it behind a parser verdict rather than making the whole API Mercadona-shaped. Define a minimal universal envelope that can carry invoice fields, Mercadona line items, manual sections, generic fields, warnings, truncation, provenance, and hashes without claiming semantic certainty.

Before implementation, resolve the MiniMax contract with one bounded, metadata-only live observation or official provider contract inspection that records the actual `choices[0].message` shape and finish reason without storing secrets or document content. Then add a narrow provider adapter and tests for that exact shape; retain the current strict parser as the safe rejection path. Consumer work should be separate: each mail/Python/Node consumer downloads or receives bytes, base64-encodes them, calls the standalone HTTP endpoint with its own timeout/auth, and consumes only the stable envelope. No consumer logic belongs in the server.

### Risks

- The MiniMax response shape is still unverified live; implementation without that evidence would be guesswork and could repeat the HTTP 502 failure.
- A free-form universal schema can become an unbounded escape hatch. Keep arrays and field values bounded and distinguish extracted data from model interpretation.
- Automatic fallback would create hidden cost, latency, and reliability coupling; avoid it unless product requirements explicitly demand one-call behavior.
- Existing OpenClaw consumers use MCP, not this HTTP boundary. A standalone API change alone will not migrate them; integration must be tracked separately with explicit compatibility/error mapping.
- Production Compose requires `MINIMAX_API_KEY` in the production overlay even though deterministic extraction works without it. This is a current deployment policy choice; whether it is desirable depends on whether production is intended to expose the optional LLM endpoint, so it should be stated neutrally rather than treated as an inherent defect.
- No live MiniMax response has yet passed the structured parser, and no external-consumer, OCR/scanned-PDF, or E2E proof exists. Scanned manuals/invoices remain outside the evidenced capability because OCR is explicitly absent.

### Ready for Proposal

Yes. The proposal should lock the HTTP-only boundary, deterministic Mercadona support, explicit LLM fallback semantics, the minimal universal response envelope, and the provider-contract evidence gate. It should keep consumer migration, OCR, automatic fallback, and deployment hardening beyond the smallest v0.2 slice unless the user explicitly expands scope.
