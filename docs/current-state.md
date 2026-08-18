# Current State

WU-2D (fail-closed legacy raw-LLM route migration) is on `wu-2d`. The three
raw-LLM egress points — HTTP `/extract-with-llm`, CLI `--llm`, and MCP
`extract_pdf_with_llm` — now return `provider_disabled` unconditionally
(even with `llmApiKey` configured). The `callLlm` helper stays in
`server.js` as dead code; Slice 6 / PrivacyTransactionService own real
LLM access. The shared envelope is exported as `LLM_PROVIDER_DISABLED`
from `src/mcp-facade.js` and reused by the HTTP handler.

WU-2C (positional bbox extraction) landed on `wu-2c`. The Node sidecar now
surfaces page-relative percentages for every matched invoice field from
pdfjs-dist text items, so the WU-2B VisualReview SVG overlay has real
rectangles to draw. Empty/OCR PDFs still fall back to `bbox: null` and the
Rust contract switched `FieldBboxV1` from `u32` to `f64` so the wire format
can carry `4.90` / `4.29` / `1.01` etc. without losing precision.

WU-2B (Visual Review UI + template store) shipped on `wu-2b`. The new
`LocalExtractionV1.invoice.matched: MatchedField[]` carries `bbox: Bbox | null`
plus editable flag, the Rust sidecar grew a `get_document_pdf_base64_v1`
command, and the App routes extraction through a color-coded overlay where
templates exist or prompts the user to confirm/edit/drag otherwise.

Slice 3 privacy-transaction core landed: `src/privacy-service.js` ships `PrivacyTransactionService`,
`AuditSink`, `ProviderDisabledError`, the `AuditEvent` closed enum, and the default fail-closed
provider registry. 35 dedicated tests in `test/privacy-service.test.js` cover BoundTransaction
shape, atomic single-use confirm, expiry / mismatch / replay rejection, outbound payload hygiene
(PDF artifacts scrubbed, PII and amounts pseudonymized, canonical JSON with sorted keys), and
content-free audit evidence.

## Node sidecar (`src/extract.js`)

- **WU-2C**: positional bbox extraction. The page loop now calls
  `page.getTextContent({ disableCombineTextItems: true })` and feeds each item
  into `pageItemsFromPdfItems(items, pageNumber, viewport)`, which converts the
  PDF transform `[a,b,c,d,e,f]` into page-relative percentages (`x=e/width`,
  `y=(height-(f+a))/height`, `width=item.width/width`, `height=a/height`) and
  rounds to two decimals. Items with missing or non-finite transforms / widths
  are dropped so OCR-only pages leave `bbox: null` on their matched fields.
- `groupTokensByLine(pageItems)` clusters items by overlapping Y-centers into
  one line each, with a span bbox covering every contributing item.
- `sliceDateValuePos` / `sliceLabelPos` / `sliceAmountPos` / `sliceTaxLabelPos`
  mirror the text-only `sliceXxx` family but return `{ value, bbox }` so the
  matched field carries the right anchor. Date-on-next-line still works; the
  bbox is the union of the label and value lines.
- `extractInvoiceFieldsFromLines(lines)` is the new public positional entry
  point (`src/extract.js`). `mergeBaseFieldsWithVendor` keeps the WU-2B
  vendor-merging contract: vendor-only fields keep `bbox: null` because
  vendor parsers are text-only regexes; overlapping fields preserve the base
  bbox.
- `extractTextFromPdf` keeps the same return shape (`text`, `pages`,
  `truncated`, `truncationReason`, `applied`, `invoiceFields`) and now stamps
  bboxes on every matched field whose label came from a position-bearing item.
  Vendor parsing still runs against the plain-text `joined` join (vendor regex
  is unchanged).

## Rust backend (`apps/nelupdf/src-tauri`)

- **WU-1D1** (`contracts.rs`): 22 v1 API DTOs, bounds constants, 5 validators
  (UUID v4, base64url ID, name, base64, SHA-256), `Validate` trait impls, `ApiResult<T>` envelope.
- **WU-1D2**: adapter layer — `RequestEnvelope` trait, `validate_request()`, `validate_and_wrap()`
  converting `ContractError` → `PublicError` → `ApiResult::Error`.
- **WU-1D3**: envelope JSON integration tests (5 tests) verifying shape matches design §5.1.
- **WU-1D4** (`doc_store.rs`, `engine.rs`):
  - `DocStore`: thread-safe in-memory PDF cache (22-char base64url IDs, SHA-256, base64 decode).
  - `engine.rs`: framed Node sidecar (4-byte BE length prefix + UTF-8 JSON), path discovery,
    response parsing with `#[serde(default)]` for error responses.
- **WU-1C4**: round-trip integration tests with real PDF fixture (`test/fixtures/A-G2026-245895.pdf`).
  - Engine rejects SHA-256 mismatch (`hash_mismatch`).
  - Engine returns `status: "ok"` with `pages > 0` and `invoice_fields` present.
  - Tauri commands: `greet`, `register_document_v1`, `extract_local_v1`, `cancel_operation_v1`.

Verification: `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml` passes **70 tests**;
`cargo clippy --manifest-path apps/nelupdf/src-tauri/Cargo.toml --all-targets -- -D warnings` is **NOT
clean** — one pre-existing `assert_eq!(local.untrusted, true)` in `engine.rs:326` triggers
`clippy::bool-assert-comparison` (the clippy rule was tightened after that test was written; the
test still passes). Out of scope for WU-2B.

## Frontend (`apps/nelupdf/src`)

- **WU-1D5**: migrated from `fetch(VITE_MOTOR_URL)` to Tauri IPC.
  - `lib/desktop-api.ts`: `DesktopApi` interface + `createTauriDesktopApi()`.
  - `lib/types.ts`: `LocalExtractionV1`, `PublicError`, `ApiResult` TypeScript types.
  - Source guard tests reject `fetch`, `VITE_MOTOR_URL`, loopback URLs, path forwarding.
- **WU-1D6**: UI consumes `LocalExtractionV1`, typed extraction states
  (registering, ready, extracting, complete, partial/OCR, cancelled, engine_error),
  `PublicError` → Spanish user messages. Removed base64 retention from `Row`.
  Native path extraction disabled. LLM handlers stubbed (Slice 3).
- **WU-2B**: Visual Review UI + template store.
  - `lib/types.ts` gained `Bbox`, `MatchedField`, `Template`; `LocalExtractionV1.invoice.matched`
    is now `MatchedField[]` and a new `reviewPdfBase64: string | null` rides in the desktop
    process only (never serialized to the LLM facade).
  - `lib/template-store.ts` ships `LocalTemplateStore` (localStorage `nelupdf:templates:v1`,
    layout fingerprint quantized to 0.1% bins, similarity = fraction of fields within one bin
    on every axis; same label set required).
  - `lib/desktop-api.ts` adds `getDocumentPdfBase64(documentId)`, backed by the new Rust
    command `get_document_pdf_base64_v1` (reuses `DocStore`, scoped, no path forwarding).
  - `components/VisualReview.tsx` renders the PDF via pdfjs-dist 4 to a `<canvas>`, overlays
    an SVG with one `<rect>` per matched field color-coded by `FIELD_COLORS`. Click a rect to
    open the inline editor (label + value + "Correcto"); drag to move, SE corner to resize.
    Confirm button stays disabled until at least one field is reviewed; "Guardar template"
    passes through `onSaveTemplate` so the caller decides whether to persist.
  - `App.tsx` wires it: after extract, query `findMatch`; if a template matches, apply its
    bboxes and skip review; otherwise render the overlay and commit on confirm. Empty
    `matched` short-circuits to row creation (nothing to review).

Frontend verification: `pnpm test -- --run` passes **22 tests**; `pnpm build` succeeds from
`apps/nelupdf` (the `pdfjs-dist` worker is emitted as `dist/assets/pdf.worker-*.mjs`).

## Slice 3 — privacy service (`src/privacy-service.js`)

- `AuditSink`: closed enum `AuditEvent` (`tx_prepare`, `tx_confirm_attempt`, `tx_confirm_sent`,
  `tx_confirm_consumed`, `tx_expired`, `tx_cancelled`, `tx_mismatch`). Each kind has a fixed
  allowlisted field set, a per-kind outcome vocabulary, and a 256-char cap on every opaque
  string field. Buffer is capped at 256 events with FIFO eviction. `emit` rejects unknown
  kinds, free-form fields, missing required fields, wrong types, oversized strings.
- `PrivacyTransactionService`:
  - `prepare(...)`: validates inputs, looks up the provider (fails closed until Slice 6),
    creates a fresh per-transaction `pseudonymizer`, builds the minimized task payload from
    `localExtraction.invoice`, scrubs PDF artifacts (`%PDF-…`, `%%EOF`, XMP markers), hashes
    the canonical JSON bytes, binds everything into a 60 s transaction, returns
    `BoundTransaction` + `disclosure` + `expiresAt`. No upstream call. The transaction
    record carries a `localFields` allowlist (derived from `invoice.matched` plus the
    standard invoice / totals keys) so the response validator never has to keep a parallel
    schema in sync.
  - `confirm({ transactionId, requestId, providerId?, modelId?, purpose? })`: atomically
    validates (tx_unknown / tx_already_consumed / tx_expired / tx_mismatch), marks consumed,
    emits `tx_confirm_attempt` + `tx_confirm_consumed`, returns `{ request, onSent }`. The
    `request.exactPayloadBytes` is a fresh `Uint8Array` view of the stored bytes.
  - **`validateProviderResponse({ transactionId, requestId, responseBytes, contentType })`**
    (WU-3C2): byte-bounded (`RESPONSE_LIMIT_BYTES`), content-type checked
    (`application/json`), JSON-parsed, schema-validated against a closed v1 response
    (`schemaVersion`, `requestId`, `confidence ∈ {high, medium, low}`, `fields`,
    `warnings`), and reverse-mapped via the per-transaction pseudonymizer — exact map
    membership only. Defensive scan rejects any string field that shape-matches PII but
    has no matching reverse-map entry (anti-hallucination). Returns a frozen
    `{ requestId, confidence, fields, warnings }`. Contract violations share one error
    code: `provider_response_invalid` (the unified vocabulary covers content-type, byte
    limit, JSON parse, schema, allowlist, and unmapped PII). Transaction-state failures
    keep their existing `tx_unknown` / `tx_mismatch` codes.
  - `cancelTransaction`, `cleanup`, `clear`, `shutdown`: lifecycle. Audit events always
    carry a non-empty `operationCorrelationId` (synthetic fallback `cancel:<tx>` /
    `auto-cleanup:<tx>` when no caller operation exists).
  - Process shutdown hooks are **opt-in** (`enableShutdownHooks: true`) to keep tests
    from leaking `MaxListenersExceededWarning`. Production callers opt in explicitly.
- `createDefaultProviderRegistry()` returns `{ status: "disabled" }` for every provider.
  Slice 6 owns the qualified-review release gate.
- Canonical payload JSON: keys sorted alphabetically at every object level; only `: ` is
  allowed as whitespace. Bytes are stable so `payloadSha256` round-trips byte-for-byte.
- Bare numeric totals (`"121.00"`) are pseudonymized by appending a transient ` €` so the
  amount matcher fires; the suffix is stripped before serializing. Reverse map is keyed by
  the bare decimal.

Verification: `node --test test/privacy-service.test.js` passes **45 tests** (was 39 before
WU-3C2); full Node suite passes **219 tests** (was 213, +6 net).

## Test inventory

| Layer | Tests | Runner |
|---|---|---|
| Rust contract validators | 22 | `cargo test contracts` |
| Rust adapter + envelope | 12 | `cargo test contracts` |
| Rust DocStore | 5 | `cargo test contracts` |
| Rust engine framing | 4 | `cargo test engine` |
| Rust engine round-trip (real Node) | 3 | `cargo test engine` |
| Rust get_document_pdf_base64_v1 | 2 | `cargo test lib` |
| Rust total | **70** | `cargo test` |
| Frontend harness + a11y | 3 | `pnpm test` |
| Frontend IPC integration | 2 | `pnpm test` |
| Frontend source guards | 1 | `pnpm test` |
| Frontend VisualReview | 8 | `pnpm test` |
| Frontend template-store | 6 | `pnpm test` |
| Frontend total | **22** | `pnpm test` |
| Privacy service | **45** | `node --test test/privacy-service.test.js` |
| extract (text + bbox) | **19** | `node --test test/extract.test.js` |
| Other Node (server, providers, vendor-parsers, …) | **155** | `node --test test/*.test.js` |
| Node total | **219** | `node --test test/*.test.js` |
| **Grand total** | **311** | |
