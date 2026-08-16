# Current State

WU-1D4 is implemented in `apps/nelupdf/src-tauri`: registered PDFs are cached in memory, extraction requests are framed and sent to the Node sidecar, and responses are mapped into the v1 API envelope.

Verification: `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml` passes 66 tests; `cargo clippy --manifest-path apps/nelupdf/src-tauri/Cargo.toml --all-targets -- -D warnings` is clean.
