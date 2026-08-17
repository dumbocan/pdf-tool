# Next Session

WU-2B (Visual Review UI + template store) is on `wu-2b`. The UI takes
`MatchedField[]` from `LocalExtractionV1.invoice.matched`, but every field
currently has `bbox: null` because the Node sidecar still extracts via plain
text — coordinates are not produced yet. Follow-ups:

- **WU-2C** — populate real `bbox` values in `src/extract.js`. The
  `pdf-parse` / `pdfjs-dist` text extractor used in the sidecar already
  returns positional info for each text item; the work is to surface those
  positions in `MatchedField.bbox` (page-relative percentages) when the
  extractor actually locates the value. Until then the Visual Review's SVG
  overlay has nothing to draw and the App.tsx integration falls straight
  through to row creation when `matched` is empty (no template → no review).
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
  WU-2B — it predates the work and the test still passes. Fixing the
  test assertion to `assert!(local.untrusted)` is a one-liner; defer it
  to a follow-up or fold into WU-2C.
  - `pdfjs-dist@4` adds ~2.2 MB to the build (`dist/assets/pdf.worker-*.mjs`).
  Acceptable for desktop; not relevant if a web-only fallback is ever
  requested.
  - The visual-review pdfjs `Worker` is loaded via Vite's
  `new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url)` pattern;
  no extra `vite.config.ts` change was needed beyond installing the
  package. Confirm in CI that the worker asset ships in `dist/`.