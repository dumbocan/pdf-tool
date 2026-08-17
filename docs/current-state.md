# Current State

WU-1 complete: all work units (D1–D6) and the C4 round-trip integration test are implemented, committed, and green.

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
| **Grand total** | **76** | |
