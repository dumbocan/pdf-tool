# Current State

WU-1D4 is implemented in `apps/nelupdf/src-tauri`: registered PDFs are cached in memory, extraction requests are framed and sent to the Node sidecar, and responses are mapped into the v1 API envelope.

WU-1D6 is implemented in `apps/nelupdf/src/App.tsx`: the UI consumes `LocalExtractionV1`, renders typed extraction/error states, does not retain base64 in rows, and keeps native path/LLM extraction unavailable without HTTP fallback.

Verification: `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml` passes 66 tests; `cargo clippy --manifest-path apps/nelupdf/src-tauri/Cargo.toml --all-targets -- -D warnings` is clean.
Frontend verification: `npm run test -- --run` passes 8 tests; `npm run build` succeeds from `apps/nelupdf`.
