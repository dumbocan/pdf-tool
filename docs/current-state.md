# Current State

WU-1 complete: all work units (D1–D6) and the C4 round-trip integration test are implemented, committed, and green.

Slice 3 privacy-transaction core landed: `src/privacy-service.js` ships `PrivacyTransactionService`,
`AuditSink`, `ProviderDisabledError`, the `AuditEvent` closed enum, and the default fail-closed
provider registry. 35 dedicated tests in `test/privacy-service.test.js` cover BoundTransaction
shape, atomic single-use confirm, expiry / mismatch / replay rejection, outbound payload hygiene
(PDF artifacts scrubbed, PII and amounts pseudonymized, canonical JSON with sorted keys), and
content-free audit evidence.

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

Verification: `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml` passes **68 tests**;
`cargo clippy --manifest-path apps/nelupdf/src-tauri/Cargo.toml --all-targets -- -D warnings` is clean.

## Frontend (`apps/nelupdf/src`)

- **WU-1D5**: migrated from `fetch(VITE_MOTOR_URL)` to Tauri IPC.
  - `lib/desktop-api.ts`: `DesktopApi` interface + `createTauriDesktopApi()`.
  - `lib/types.ts`: `LocalExtractionV1`, `PublicError`, `ApiResult` TypeScript types.
  - Source guard tests reject `fetch`, `VITE_MOTOR_URL`, loopback URLs, path forwarding.
- **WU-1D6**: UI consumes `LocalExtractionV1`, typed extraction states
  (registering, ready, extracting, complete, partial/OCR, cancelled, engine_error),
  `PublicError` → Spanish user messages. Removed base64 retention from `Row`.
  Native path extraction disabled. LLM handlers stubbed (Slice 3).

Frontend verification: `npm run test -- --run` passes **8 tests**; `npm run build` succeeds from `apps/nelupdf`.

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
    `BoundTransaction` + `disclosure` + `expiresAt`. No upstream call.
  - `confirm({ transactionId, requestId, providerId?, modelId?, purpose? })`: atomically
    validates (tx_unknown / tx_already_consumed / tx_expired / tx_mismatch), marks consumed,
    emits `tx_confirm_attempt` + `tx_confirm_consumed`, returns `{ request, onSent }`. The
    `request.exactPayloadBytes` is a fresh `Uint8Array` view of the stored bytes.
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

Verification: `node --test test/privacy-service.test.js` passes **35 tests**; full Node suite
passes **210 tests** (was 175 before this slice).

## Test inventory

| Layer | Tests | Runner |
|---|---|---|
| Rust contract validators | 22 | `cargo test contracts` |
| Rust adapter + envelope | 12 | `cargo test contracts` |
| Rust DocStore | 5 | `cargo test contracts` |
| Rust engine framing | 4 | `cargo test engine` |
| Rust engine round-trip (real Node) | 3 | `cargo test engine` |
| Rust total | **68** | `cargo test` |
| Frontend harness + a11y | 3 | `npm run test` |
| Frontend IPC integration | 2 | `npm run test` |
| Frontend source guards | 1 | `npm run test` |
| Frontend total | **8** | `npm run test` |
| Privacy service | **35** | `node --test test/privacy-service.test.js` |
| Other Node (extract, server, providers, …) | **99** | `node --test test/*.test.js` |
| Node total | **210** | `node --test test/*.test.js` |
| **Grand total** | **210** | |
