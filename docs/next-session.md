# Next Session

Slice 3 (privacy-transaction) core landed. Follow-up work units and open questions:

- **WU-3A1** — fail-closed legacy raw-LLM route migration. `server.js`, `mcp-facade.js`,
  `bin/pdf-tool.mjs` must reject raw `/extract-with-llm` and `extract_pdf_with_llm`
  callers with the versioned migration envelope, while deterministic `/extract`,
  `extract_pdf_from_base64`, and OpenClaw list/schema remain operational. The new
  `PrivacyTransactionService.prepare` is the only sanctioned outbound path.
- **WU-3A2** — formalize the data-class taxonomy and per-purpose minimization matrix
  beyond the current "use `localExtraction.invoice` fields". The current payload shape
  is correct for invoice extraction; other declared purposes will need their own
  minimizers.
- **WU-3C2** — provider response validation and exact reverse mapping. Use the
  per-transaction `pseudonymizer` already stored in the transaction record. Numbers
  and identifiers absent from the map must remain unchanged (no heuristic reversal).
- **WU-3D1** — wire CLI/HTTP/MCP adapters to call `PrivacyTransactionService.prepare`
  and `.confirm`. Verify no legacy raw path can construct a payload directly.
- **WU-3D2** — desktop disclosure/confirm modal in Rust/React. The current
  `DesktopApi.requestLlmPreview` and `confirmLlm` stubs in
  `apps/nelupdf/src/lib/desktop-api.ts` need Tauri commands that invoke this service.
- **Slice 6** — provider enablement gated by qualified review (not just the
  `provider_disabled` registry).
- Open questions:
  - `src/privacy-service.js` is 809 lines — under the SDD "forecasted 400 lines"
    rule. Confirm with reviewers whether to split into `privacy-service.js`,
    `transaction-store.js`, `audit-sink.js` in a follow-up, or keep the consolidated
    shape that mirrors the WU-3B1 / WU-3B2 / WU-3C1 grouping.
  - The shutdown hooks are opt-in (`enableShutdownHooks: true`). Production callers
    (`server.js`, MCP facade) should opt in explicitly during Slice 5 start-up wiring.
  - The defensive PDF-artifact scrub uses regex against `%PDF-…`, `%%EOF`, and XMP
    markers. If a future document class produces novel raw-PDF artifacts in invoice
    fields, broaden `PDF_MARKER_PATTERNS` in `privacy-service.js`.