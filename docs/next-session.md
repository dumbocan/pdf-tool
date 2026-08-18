# Next Session

WU-2D (fail-closed legacy raw-LLM route migration) is on `wu-2d`. The three
raw-LLM egress points — HTTP `/extract-with-llm`, CLI `--llm`, and MCP
`extract_pdf_with_llm` — now return `provider_disabled` unconditionally
(even with `llmApiKey` configured). The `callLlm` helper stays in
`server.js` as dead code; Slice 6 / PrivacyTransactionService own real
LLM access. The shared envelope is exported as `LLM_PROVIDER_DISABLED`
from `src/mcp-facade.js` and reused by the HTTP handler. The new
`test/cli-llm.test.js` proves the CLI flag exits non-zero with the
"LLM preview is disabled" message even when `MINIMAX_API_KEY` is set.

Follow-ups:

- **WU-2D-archaeology**: confirm with the user which slice removes the
  dead `callLlm` helper from `server.js`. WU-2D leaves it in place by
  design — the Slice 6 release gate should be the one to delete it once
  PrivacyTransactionService is wired end-to-end.
- **WU-2D-cleanup**: the `useLlm` parameter still flows through
  `src/folder-scan.js` and powers some `i18n.js` strings
  (`config_llm_hint`, `rename_next`, `help_scan_rename`). Once the
  follow-up slice lands, drop those strings and the parameter.
- **WU-2A** — multi-file review UX. Currently `processFiles` runs each
  file's extraction sequentially and `setReview` overwrites state, so a
  multi-file upload that triggers review on more than one doc shows only
  the last pending review. Either queue the reviews or promote the screen
  to a wizard.
- **WU-2E** — visual-review a11y hardening. The inline editor currently
  positions absolutely off the canvas; arrow-key navigation between
  fields, focus trapping, and a screen-reader-friendly alternative are
  not yet wired. Keyboard users can tab through the legend and buttons
  but not the rects themselves.
- **WU-3A1** — fail-closed legacy raw-LLM route migration (already noted
  in pre-WU-2B doc).
- Open questions:
  - The pre-existing `cargo clippy --all-targets -- -D warnings` error in
  `engine.rs:326` (`assert_eq!(local.untrusted, true)`) is unrelated to
  WU-2B / WU-2C — it predates the work and the test still passes. Fixing
  the test assertion to `assert!(local.untrusted)` is a one-liner; defer it
  to a follow-up.
  - `pdfjs-dist@4` adds ~2.2 MB to the build (`dist/assets/pdf.worker-*.mjs`).
  Acceptable for desktop; not relevant if a web-only fallback is ever
  requested.
  - The visual-review pdfjs `Worker` is loaded via Vite's
  `new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url)` pattern;
  no extra `vite.config.ts` change was needed beyond installing the
  package. Confirm in CI that the worker asset ships in `dist/`.
  - The WU-2C synthetic-PDF test fixture uses separate `BT ... ET` per text
  run; pdfjs silently merges sibling Tj operations inside one BT/ET block
  into a single item, which would collapse positional anchors and defeat
  the bbox exercise. Any future multi-line PDF fixture must keep each Tj
  in its own BT/ET pair.
  - `FieldBboxV1` now uses `f64`; `Eq` was dropped from `MatchedFieldV1`,
  `InvoiceFieldsV1`, and `LocalExtractionV1` derives (f64 doesn't impl Eq).
  Anything that compares these types with `==` on a MatchedField needs to
  be reworked. The Node sidecar now stamps
page-relative percentages on every matched invoice field from pdfjs-dist text
items, the Rust `FieldBboxV1` switched to `f64` so the wire format carries
fractional percentages, and the VisualReview SVG overlay finally has real
rectangles to draw. Empty/OCR PDFs still fall back to `bbox: null`. Follow-ups:

- **WU-2D** — multi-file review UX. Currently `processFiles` runs each
  file's extraction sequentially and `setReview` overwrites state, so a
  multi-file upload that triggers review on more than one doc shows only
  the last pending review. Either queue the reviews or promote the screen
  to a wizard.
- **WU-2E** — visual-review a11y hardening. The inline editor currently
  positions absolutely off the canvas; arrow-key navigation between
  fields, focus trapping, and a screen-reader-friendly alternative are
  not yet wired. Keyboard users can tab through the legend and buttons
  but not the rects themselves.
- **WU-3A1** — fail-closed legacy raw-LLM route migration (already noted
  in pre-WU-2B doc).
- Open questions:
  - The pre-existing `cargo clippy --all-targets -- -D warnings` error in
  `engine.rs:326` (`assert_eq!(local.untrusted, true)`) is unrelated to
  WU-2B / WU-2C — it predates the work and the test still passes. Fixing
  the test assertion to `assert!(local.untrusted)` is a one-liner; defer it
  to a follow-up.
  - `pdfjs-dist@4` adds ~2.2 MB to the build (`dist/assets/pdf.worker-*.mjs`).
  Acceptable for desktop; not relevant if a web-only fallback is ever
  requested.
  - The visual-review pdfjs `Worker` is loaded via Vite's
  `new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url)` pattern;
  no extra `vite.config.ts` change was needed beyond installing the
  package. Confirm in CI that the worker asset ships in `dist/`.
  - The WU-2C synthetic-PDF test fixture uses separate `BT ... ET` per text
  run; pdfjs silently merges sibling Tj operations inside one BT/ET block
  into a single item, which would collapse positional anchors and defeat
  the bbox exercise. Any future multi-line PDF fixture must keep each Tj
  in its own BT/ET pair.
  - `FieldBboxV1` now uses `f64`; `Eq` was dropped from `MatchedFieldV1`,
  `InvoiceFieldsV1`, and `LocalExtractionV1` derives (f64 doesn't impl Eq).
  Anything that compares these types with `==` on a MatchedField needs to
  be reworked.