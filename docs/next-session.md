# Next Session

WU-3A1 (fail-closed path-bearing CLI + MCP migration) is on `wu-3a1`. The
path-bearing single-PDF route now returns `unsafe_path_contract_removed_v1`
unconditionally on every surface — HTTP `/extract-path` (already WU-2B/2C),
CLI `--extract-path` / `extract-path` subcommand (new, with `--extract-path=value`
form), and MCP `extract_pdf_from_path` (already fail-closed in WU-1B3). The
shared `UNSAFE_PATH_MIGRATION` envelope from `src/mcp-facade.js` is reused by
the CLI guard. Folder-batch (`facturas <folder>`) stays a deterministic
local-process operation under the invoking OS user's authority, per design
§6.6 line 645 — the CLI guard sits in `main()` before any command dispatch,
so no `stat`, `realpath`, `readFile`, or extraction code is reached when the
typed envelope is emitted. The new `test/cli-extract-path.test.js` proves
the CLI flag exits with code 2 and emits `unsafe_path_contract_removed_v1`
on stderr even when a non-existent path is supplied (the typed error is
itself the proof that no fs access was attempted before rejection).

Follow-ups:

- **WU-3A1-future-contract**: Slice 2 may add a new versioned
  workspace/capability contract that restores workspace-bounded path access,
  per design §6.6 line 645. When that contract ships, the CLI guard in
  `bin/pdf-tool.mjs` (currently the first statement of `main()`) and the
  MCP `extract_pdf_from_path` tool in `src/mcp-facade.js` (currently
  returning `unsafePathMigrationResult()`) need to dispatch on the new
  contract — not reactivate the legacy arbitrary-path behavior.
- **WU-3A1-i18n**: the typed `console.error("unsafe_path_contract_removed_v1")`
  in `bin/pdf-tool.mjs` is intentionally literal English so consumers can
  match on it. `t("llm_preview_disabled")` in the same file uses i18n; the
  asymmetry is deliberate but worth a comment in `src/i18n.js` if anyone
  refactors the typed envelopes into a shared helper.
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

Open questions:

- The pre-existing `cargo clippy --all-targets -- -D warnings` error in
  `engine.rs:326` (`assert_eq!(local.untrusted, true)`) is unrelated to
  WU-3A1 — it predates the work and the test still passes. Fixing
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
- `FieldBboxV1` uses `f64`; `Eq` was dropped from `MatchedFieldV1`,
  `InvoiceFieldsV1`, and `LocalExtractionV1` derives (f64 doesn't impl Eq).
  Anything that compares these types with `==` on a MatchedField needs to
  be reworked.