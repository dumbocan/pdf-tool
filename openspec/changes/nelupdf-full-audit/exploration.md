# Exploration: NeluPDF Full Audit

**Change:** `nelupdf-full-audit`
**Phase:** read-only exploration
**Artifact store:** hybrid
**Date:** 2026-08-15

## Executive summary

The current checkout contains a capable bounded Node.js PDF extraction engine and an early NeluPDF desktop UI, but it does not yet form an installable, self-contained desktop product. The React webview assumes that a separately managed Node server is already listening on `127.0.0.1:3000`; the Tauri/Rust shell is still template code and owns no engine startup, readiness, authentication, port selection, shutdown, recovery, or packaging.

The most serious source-confirmed issue is in the CLI privacy flow: the user-facing notice states that identifiers and amounts are replaced before transmission, but `scanFolder(..., { useLlm: true })` calls `llmEnrich(text)` with raw extracted text. The newer desktop-specific privacy endpoints do pseudonymize, but preview and confirmation are separate, unbound requests, confirmation can be called directly, and the reverse-mapping algorithm can divide unrelated numeric strings because it does not require membership in the generated amount map. Separately, the default unauthenticated loopback service combines wildcard CORS with path-reading endpoints, creating an unsafe local trust boundary.

The desktop UI also has confirmed functional defects: native drag-and-drop rows discard the absolute path and retain no base64 bytes, so their “Extract with AI” flow always refuses to proceed; enabling `AUTH_TOKEN` makes every desktop POST fail because the client sends no bearer header; and the desktop CSV exporter neither neutralizes spreadsheet formulas nor escapes quotes/newlines correctly. Accessibility, failure-state design, desktop tests, CI coverage, CSP hardening, and packaging are not release-ready.

No product source, tests, Git state, environment files, or secrets were modified. No tests were run in this phase; runtime baseline results are inherited from initialization: 143 Node tests passed and 1 failed, NeluPDF TypeScript passed, and Docker Compose configuration passed.

## Evidence basis and confidence

- Project context: `openspec/config.yaml`, `openspec/project-context.md`.
- Desktop: `apps/nelupdf/src/App.tsx`, `App.css`, `index.html`, `package.json`, `vite.config.ts`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, and `src-tauri/capabilities/default.json`.
- Engine and privacy paths: `src/server.js`, `src/extract.js`, `src/folder-scan.js`, `src/llm-privacy.js`, `src/pseudonymize.js`, `src/privacy-preview.js`, `src/consent-store.js`, `src/env.js`, `src/mcp-facade.js`, and `bin/pdf-tool.mjs`.
- Operations and packaging: root and desktop manifests, `Dockerfile`, Compose files, `deploy.sh`, `install.sh`, `install.ps1`, and `.github/workflows/ci.yml`.
- Tests and documentation: the 17 root `test/*.test.js` files, `README.md`, `PRIVACY.md`, `DOC-PSEUDONIMIZACION.md`, `SECURITY.md`, `PLAN-NEGOCIO-NeluPDF.md`, and the desktop template README.
- CodeGraph was unavailable and `.codegraph/config.json` was absent, so targeted read-only filesystem inspection was used.
- “Confirmed” below means directly established by reachable source/control flow or static configuration. Runtime-only behavior not exercised here is labeled as a risk or gap.
- Attribution uses initialization evidence: `apps/nelupdf/` and privacy-related Node modules/tests are current untracked NeluPDF work; the v0.2 engine, published HTTP/CLI/MCP contract, and installers are treated as pre-existing baseline. Mixed findings are marked explicitly. No history-changing or Git inspection command was used.

## Audit boundaries and non-goals

### In scope

Current architecture and behavior; deterministic and LLM-assisted flows; untrusted-PDF handling; loopback transport and authentication; Tauri process lifecycle; CSP and capabilities; installation and packaging; privacy, retention, and logging; UX and WCAG-oriented accessibility; failure states; test strategy and CI; and public/internal documentation accuracy.

### Non-goals

- No fixes, refactors, dependency updates, test additions, snapshots, commits, or environment changes.
- No live provider calls, destructive/malformed-PDF execution, browser automation, installer execution, package build, signing, store submission, penetration testing, or legal-compliance certification.
- No audit of future hosted, licensing, payment, inventory, Facturae/Factur-X, or app-store features beyond identifying current documentation drift.
- No acceptance of roadmap or business-plan statements as runtime evidence.

## Current architecture and behavior

### Node engine

1. `startServer` binds to loopback by default and refuses a non-loopback bind without `AUTH_TOKEN`.
2. `createServer` exposes health/version, deterministic extraction, direct LLM extraction, MCP, native-path extraction, privacy preview, and privacy extraction routes.
3. Base64 extraction validates the JSON/body, PDF magic and decoded size, then uses `extractWithOcr`. Digital PDFs go through bounded `pdfjs-dist`; empty-text PDFs fall back to local Poppler/Tesseract OCR.
4. Deterministic parsing produces invoice fields, vendor-specific fields/items, truncation metadata, hash, provenance, and an untrusted-content warning.
5. The direct `/extract-with-llm` route sends extracted text to the configured provider under a strict six-key response contract. It does not use the preview/pseudonymization flow.
6. `/llm-preview` extracts and pseudonymizes text and returns a 1,200-character sample. `/extract-with-llm-privacy` independently repeats extraction and pseudonymization, calls the provider, and reverses selected values.
7. The MCP facade wraps the older REST routes and constrains path input to a configured workspace. The newer desktop `/extract-path` route has no equivalent path boundary.
8. The CLI scans folders, optionally OCRs, exports CSV, optionally renames PDFs, and optionally calls an LLM. Its informed-transfer prompt and persisted provider/model preference are separate from the actual raw-text LLM implementation.

### NeluPDF desktop

1. The Tauri shell launches only the React bundle and registers the template `greet` command plus opener plugin.
2. `App.tsx` resolves a build-time `VITE_MOTOR_URL`, defaulting to `http://127.0.0.1:3000`.
3. File-dialog PDFs are fully loaded into webview memory, converted to base64, and posted to `/extract`; their base64 remains in React row state for a later LLM request.
4. Native drag-and-drop sends absolute paths to `/extract-path`, but successful rows retain only the basename.
5. Results are held in memory and shown in a table. Missing totals expose an AI action. CSV is generated in the webview and downloaded through an object URL.
6. AI preview and confirmation use two separate HTTP calls. There is no desktop-owned engine readiness check, auth negotiation, cancellation, retry model, or shutdown handling.

### Deployment and installation

- Docker packages the Node HTTP engine and OCR tools, not the desktop app.
- Shell/PowerShell installers install the CLI and dependencies, not NeluPDF desktop bundles.
- Tauri bundling is enabled for all targets but declares no Node runtime, engine resources, OCR binaries/language data, sidecar, updater, signing, or release pipeline.
- Root CI runs only Node tests, root production dependency audit, and Compose validation.

## Findings

Severity meanings: **Critical** = privacy/security or release-blocking failure; **High** = major feature, data-integrity, or trust-boundary failure; **Medium** = material reliability/UX/maintainability gap; **Low** = localized polish or stale metadata.

### Confirmed defects

| ID | Severity | Attribution | Finding and impact | Evidence |
| --- | --- | --- | --- | --- |
| DEF-01 | **Critical** | Current privacy work | The CLI promises pseudonymization before provider transfer but sends raw extracted text. A user may transmit identifiers, names, addresses, and amounts under a materially false preview. | `bin/pdf-tool.mjs` `main` shows `buildPrivacyNotice` then calls `scanFolder`; `src/folder-scan.js` `scanFolder` calls `llmEnrich(text)`; `llmEnrich` places raw `text` in `userContent`. |
| DEF-02 | **High** | Current desktop work | Native drag-and-drop AI extraction cannot work. `processPaths` stores only a basename and no `data`; `requestLlmPreview` rejects any row that neither starts with `/` nor has base64. Windows paths would also fail the `/` heuristic. | `apps/nelupdf/src/App.tsx`: `processPaths`, `requestLlmPreview`. |
| DEF-03 | **High** | Current desktop work | Configuring engine authentication breaks the desktop. All protected fetches omit `Authorization`, while the server correctly returns 401 when `AUTH_TOKEN` is set. This forces the desktop toward the unsafe fail-open mode. | `App.tsx` fetch calls; `src/server.js` `hasValidToken`; `test/server.test.js` auth contract. |
| DEF-04 | **High** | Current privacy work | Reverse pseudonymization can corrupt unrelated numeric fields. `reverseAmount` divides any numeric value whose cents are divisible by the session factor; it does not check `reverseAmounts`. `reverseDeep` applies that rule recursively to every numeric-looking string, including IDs or quantities returned by the model. | `src/pseudonymize.js`: `reverseAmounts`, `reverseAmount`, `reverseDeep`. |
| DEF-05 | **High** | Current desktop work | Desktop CSV hardening is ineffective and CSV escaping is incomplete. Quoting a value beginning with `=`, `+`, `-`, or `@` does not neutralize spreadsheet evaluation; quotes and newlines are not escaped. Untrusted PDF/model fields can therefore produce unsafe or malformed exports. | `App.tsx` `csvCell`; compare the safer root `bin/pdf-tool.mjs` `csvCell`. |
| DEF-06 | **Medium** | Mixed | The documented 12 MiB PDF maximum cannot be reached through base64 HTTP: 12 MiB expands to 16 MiB before JSON overhead, exceeding the 16 MiB request-body limit. Users receive 413 below the advertised decoded limit. | `src/extract.js` `MAX_PDF_BYTES`; `src/server.js` `DEFAULTS.maxRequestBytes`, `readBody`. |
| DEF-07 | **Medium** | Current privacy tests | The known pseudonymization test is flaky. The factor is random from 3–12 and the assertion uses substring matching; when factor 10 produces `12500.00`, it contains `1250.00` and falsely appears to retain the real value. | `src/pseudonymize.js` `factor`; `test/pseudonymize.test.js` “amounts mapped affinely…” assertion. |
| DEF-08 | **Medium** | Current CLI work | The CLI can throw a temporal-dead-zone `ReferenceError` when `--llm`, a legacy MiniMax key, and the rename branch are active because `doRename` is read before its `let` declaration. | `bin/pdf-tool.mjs` `main`: `if (... envNow.MINIMAX_API_KEY && doRename)` precedes `let doRename`. |
| DEF-09 | **Medium** | Current desktop work | Two PDFs with the same basename collide: native rows use basename as React key and as the identity for LLM updates, so duplicate keys occur and confirming one result can update every matching row. | `App.tsx`: native row construction, `<tr key={r.file}>`, `prev.map(r.file === preview.row.file)`. |
| DEF-10 | **Low** | Current privacy metadata | Aleph Alpha is catalogued as `alephalpha`, but the country map uses `alephalph`; the UI therefore reports its location/adequacy as unknown. | `src/providers.js`; `src/privacy-preview.js` `PROVIDER_COUNTRY`. |

### Architectural gaps

| ID | Severity | Attribution | Finding and impact | Evidence |
| --- | --- | --- | --- | --- |
| ARC-01 | **Critical** | Current desktop work | There is no desktop product lifecycle. Tauri does not start, supervise, authenticate, wait for, recover, or stop the Node engine. A packaged app is non-functional unless the user separately installs/configures/starts the engine. | `src-tauri/src/lib.rs`, `Cargo.toml`, `tauri.conf.json`; `App.tsx` fixed loopback assumption. |
| ARC-02 | **High** | Current desktop work | Port ownership and endpoint identity are undefined. Port 3000 may be absent, occupied, stale, or controlled by another process; the webview accepts any service answering the expected paths. | `App.tsx` `MOTOR_URL`; no shell readiness or handshake implementation. |
| ARC-03 | **High** | Current privacy work | Preview is not a content-bound authorization. Preview and confirm re-read/re-extract/re-pseudonymize independently, use different maps/factors, and no nonce/hash/expiry binds confirmation to document bytes, provider, model, or outbound text. The confirmation endpoint is directly callable without preview. | `src/server.js` `/llm-preview` and `/extract-with-llm-privacy`; `src/llm-privacy.js`. |
| ARC-04 | **High** | Mixed | Privacy policy is split across incompatible interfaces: desktop privacy routes pseudonymize, CLI `--llm` sends raw text, MCP/direct `/extract-with-llm` sends raw text, and only some paths ask before transfer. “LLM mode” has no single enforceable contract. | `server.js`, `folder-scan.js`, `mcp-facade.js`, `bin/pdf-tool.mjs`. |
| ARC-05 | **Medium** | Current desktop work | The webview trusts unvalidated JSON and has no shared versioned client/server schema. A wrong/stale/hijacked engine can return arbitrary shapes; failures degrade to blanks or generic alerts rather than a protocol mismatch. | `App.tsx` untyped `await res.json()` access; no shared schema package/handshake. |
| ARC-06 | **Medium** | Current desktop work | Data lifetime is implicit. File-dialog PDF bytes remain base64-encoded in React state until rows/app are cleared, while native paths are logged to the webview console. No explicit clear/remove/session-retention behavior exists. | `App.tsx` `Row.data`, `console.log` in drag-drop listener. |
| ARC-07 | **High** | Current desktop work | Packaging has no declared engine/Node/OCR resource model, platform compatibility matrix, code signing, update channel, rollback, or installer ownership. `bundle.targets: "all"` alone does not create a working bundle. | `src-tauri/tauri.conf.json`; installers and Dockerfile package only root engine/CLI. |
| ARC-08 | **Medium** | Current desktop work | Failure semantics are not designed across layers: engine missing, wrong version, auth failure, port conflict, malformed PDF, OCR unavailable, OCR timeout, provider unavailable, offline mode, truncated output, and shutdown failure have no typed user-facing state model. | `App.tsx` generic `String(error)`/HTTP snippets/alerts; no Rust lifecycle code. |

### Security and privacy risks

| ID | Severity | Attribution | Finding and impact | Evidence |
| --- | --- | --- | --- | --- |
| SEC-01 | **Critical** | Mixed; amplified by current desktop routes | Default no-auth loopback plus `Access-Control-Allow-Origin: *` and unauthenticated preflight creates an unsafe boundary. `/extract-path` and privacy path forms read caller-supplied filesystem paths without the MCP workspace restriction. Any local process, and potentially a permitted web origin depending on browser private-network policy, can invoke extraction; known PDF paths can be read and returned. | `src/server.js` CORS, optional auth, `/extract-path`, privacy path input; contrast `mcp-facade.js` `assertInsideWorkspace`. |
| SEC-02 | **High** | Current desktop work | Tauri CSP is disabled (`null`) and the main window has the opener capability/plugin despite no observed product use. A webview injection or compromised dependency therefore has a broader path to network/plugin actions than necessary. | `src-tauri/tauri.conf.json`; `capabilities/default.json`; `src-tauri/src/lib.rs`. |
| SEC-03 | **High** | Pre-existing OCR, now desktop-reachable | OCR resource limits do not match PDF limits. After bounded text extraction finds no text, `pdftoppm` renders the entire PDF at 300 DPI and synchronous Poppler/Tesseract calls have no timeout/page/output cap. A small malicious scanned PDF can consume CPU, disk, and memory and block the Node event loop. | `src/folder-scan.js` `ocrPdf`, `extractWithOcr`. |
| SEC-04 | **High** | Pre-existing baseline | `/extract-with-llm` and MCP LLM extraction send raw extracted text without an in-band preview or content-bound confirmation. Optional auth does not establish user intent. This contradicts the stronger product-wide privacy claims. | `src/server.js` direct LLM route; `src/mcp-facade.js` `extract_pdf_with_llm`. |
| SEC-05 | **High** | Current privacy work | Pseudonymization coverage is narrower than claims. Code explicitly leaves person/company names intact and has no address recognizer; preview exposes only the first 1,200 characters while the full text is sent. `PRIVACY.md` claims names and addresses are replaced. | `src/pseudonymize.js`; `DOC-PSEUDONIMIZACION.md`; `server.js` sample slicing; `PRIVACY.md`. |
| SEC-06 | **Medium** | Pre-existing provider configuration | A user-entered `LLM_BASE_URL` is not constrained to HTTPS or trusted local schemes. A typo or malicious configuration can transmit the API key and document text over plaintext or to an unintended host. | `bin/pdf-tool.mjs` `runConfig`; `server.js`/`folder-scan.js` provider fetch construction. |
| SEC-07 | **Medium** | Current desktop work | Native drag/drop logs absolute local paths. Paths commonly contain usernames, customer names, or invoice identifiers and can persist in developer/support logs. | `App.tsx` drag/drop `console.log`. |
| SEC-08 | **Medium** | Mixed | The server reads a path target fully into memory before PDF size validation. Combined with unrestricted path input, a caller can cause large-file reads even though extraction later rejects files over 12 MiB. | `server.js` `/extract-path` and privacy path branches call `readFile` before `extract`. |
| SEC-09 | **Medium** | Documentation/configuration | Provider country/adequacy claims are static product assertions, not runtime-verified provider/account guarantees, and provider retention/training policies are not actually shown individually as documentation claims. This creates legal/product-representation risk and requires specialist review. | `privacy-preview.js`, `PRIVACY.md`; no policy metadata in `providers.js`. |

### UX and accessibility gaps

| ID | Severity | Attribution | Finding and impact | Evidence |
| --- | --- | --- | --- | --- |
| UX-01 | **High** | Current desktop work | The primary drop zone is a clickable `div` with no keyboard handler, role, tab stop, or accessible label. Keyboard-only users cannot open the file chooser through the visible control. | `App.tsx` dropzone markup. |
| UX-02 | **High** | Current desktop work | The privacy modal lacks `role="dialog"`, `aria-modal`, an accessible name relationship, focus entry/trap/restoration, Escape handling, and background inertness. | `App.tsx` modal markup; `App.css`. |
| UX-03 | **Medium** | Current desktop work | Progress and async outcomes are not announced (`aria-live`/status/busy absent), and blocking `alert` dialogs carry raw technical failures. | `App.tsx` progress and alert paths. |
| UX-04 | **Medium** | Current desktop work | The table has no narrow-window strategy and the Tauri minimum width is 800px. Long names/errors can dominate; fields are read-only despite the business plan describing validation/editing; confidence is reduced to presence/absence of total. | `App.tsx`, `App.css`, `tauri.conf.json`, `PLAN-NEGOCIO-NeluPDF.md`. |
| UX-05 | **Medium** | Current desktop work | Missing engine, auth mismatch, OCR dependency failure, provider misconfiguration, offline state, truncation, and partial extraction do not offer actionable recovery, retry, cancel, or diagnostics. | `App.tsx`; no readiness/failure-state layer. |
| UX-06 | **Low** | Current desktop work | Document language and title remain template values (`lang="en"`, “Tauri + React + Typescript”) while UI content is Spanish; this harms assistive pronunciation and product identity. | `apps/nelupdf/index.html`. |
| UX-07 | **Low** | Current desktop work | The app has no clear/remove/reset control and can start overlapping file batches while global `processing`/`progress` state represents only one operation. | `App.tsx` state and handlers. |

### Testing and CI gaps

| ID | Severity | Attribution | Finding and impact | Evidence |
| --- | --- | --- | --- | --- |
| TST-01 | **High** | Current desktop work | No frontend component/unit, accessibility, Rust, lifecycle, integration, or desktop E2E tests exist. Strict TDD cannot be honestly applied to desktop behavior until a test seam and runners are established. | Desktop `package.json`; root project context. |
| TST-02 | **High** | Current desktop work | CI never installs, type-checks, builds, tests, or audits NeluPDF/Tauri. Root `npm audit` does not cover the desktop pnpm or Cargo dependency graphs. | `.github/workflows/ci.yml`; separate desktop manifests/locks. |
| TST-03 | **Medium** | Current privacy/security work | Tests do not lock origin/CORS policy, `/extract-path` authorization/scope, mandatory desktop auth, preview-confirm binding, direct-confirm rejection, or content identity. Existing privacy route tests prove only independent endpoint behavior with stubs. | `test/server-llm-privacy.test.js`; grep shows no CORS or extract-path tests. |
| TST-04 | **High** | Mixed | No adversarial OCR/resource test covers page bombs, Poppler/Tesseract timeouts, concurrent OCR, temporary-disk exhaustion, or process cancellation. | `folder-scan.js`; test inventory. |
| TST-05 | **Medium** | Current privacy work | Provider privacy tests use short fixtures and mocked providers; they do not prove names/addresses/full-document minimization, international amount formats, reverse-map collision safety, or that CLI outbound text is pseudonymized. | privacy/pseudonymization tests and `no-network-without-llm.test.js`. |
| TST-06 | **Medium** | Whole repository | No coverage gate, lint, formatter, desktop build matrix, installer smoke tests, signed-artifact verification, or release CI exists. | manifests and CI workflow. |
| TST-07 | **Medium** | Current baseline | The suite is not green (143/144), and the failing assertion is randomized. A red/flaky baseline weakens regression attribution for any follow-on work. | initialization baseline; `pseudonymize.test.js`. |

### Documentation drift

| ID | Severity | Attribution | Finding and impact | Evidence |
| --- | --- | --- | --- | --- |
| DOC-01 | **High** | Current privacy work | `PRIVACY.md` says CLI LLM text is pseudonymized, names/addresses are replaced, and users see what will be sent; current CLI sends raw text and does not show a representative pseudonymized document. | `PRIVACY.md`; `bin/pdf-tool.mjs`; `folder-scan.js`. |
| DOC-02 | **Medium** | Current privacy work | `PRIVACY.md` describes `export`/`wipe` as upcoming “all data” controls, while implemented commands only export/delete consent preferences and explicitly leave credentials, PDFs, and CSVs untouched. | `PRIVACY.md`; `bin/pdf-tool.mjs` `export`/`wipe`. |
| DOC-03 | **Medium** | Whole repository | README badges and text claim 109/109 tests, while initialization observed 144 total with one failure. Endpoint docs omit the new desktop path/privacy routes and their trust implications. | root `README.md`; initialization baseline; `server.js`. |
| DOC-04 | **Medium** | Current desktop work | Desktop README, HTML title/icon, Cargo description/authors, and Rust command remain scaffold metadata. There is no user installation, engine prerequisite, privacy mode, troubleshooting, packaging, or platform-support documentation. | `apps/nelupdf/README.md`, `index.html`, `src-tauri/Cargo.toml`, `lib.rs`. |
| DOC-05 | **Medium** | Current desktop work | The business plan reports editable fields, confidence badges, CSV hardening, integrated sidecar direction, and completed privacy phases more strongly than source supports. | `PLAN-NEGOCIO-NeluPDF.md` versus `App.tsx`, `server.js`, `folder-scan.js`. |
| DOC-06 | **Medium** | Installation baseline | The one-line installers update mutable remote code and can invoke privileged package installation; there is no release checksum/signature/pinned artifact flow. The Windows script has no equivalent pre-execution transparency/confirmation gate because `iex` executes it immediately. | `README.md`, `install.sh`, `install.ps1`. |
| DOC-07 | **Low** | Current privacy docs | `DOC-PSEUDONIMIZACION.md` reports seven tests and a 125/125 suite; plan/README report other stale totals. The documentation has no single generated evidence source. | documentation files and current initialization baseline. |

## Positive controls already present

- Loopback is the default bind, and non-loopback startup without auth fails closed.
- Bearer comparison is length-checked and timing-safe when configured.
- PDF magic, decoded bytes, pages, characters, per-page text, response size, prompt size, model tokens, and provider timeout are bounded in the digital extraction path.
- `pdfjs-dist` eval/font/image surfaces are reduced, extracted content is labeled untrusted, and provider output is schema-checked on the current HTTP route.
- Local deterministic mode has a zero-network test.
- Server responses use `no-store` and `nosniff`; content errors avoid stack traces.
- OCR temporary directories are removed in `finally` on ordinary completion/failure.
- Root CLI CSV escaping is materially safer than the desktop implementation.
- Provider preview clearly states that pseudonymization is not anonymity and that external providers may retain data, although actual flow consistency is defective.

## Proposal inputs

A proposal should treat this as a trust-boundary and product-lifecycle correction, not a UI polish pass.

### Required product decisions

1. **Desktop-to-engine boundary:** decide whether the webview may call loopback directly, or whether Rust mediates all engine requests. Rust mediation reduces web-origin exposure and token handling in JavaScript; direct HTTP is simpler but requires strict origin/auth/path controls.
2. **Engine ownership:** define the packaged Node/runtime/OCR model, random-port selection, per-launch credential generation, readiness/version handshake, crash recovery, concurrency limits, and graceful/forced shutdown.
3. **File authority:** define how a user-selected file becomes an authorized engine input. Avoid a general arbitrary-path HTTP API; bind access to a Tauri selection capability or short-lived request token.
4. **One LLM privacy contract:** decide whether every CLI/HTTP/MCP/desktop provider call must use the same pseudonymization and explicit-intent policy, and whether the legacy raw route remains, is restricted, or is deprecated.
5. **Content-bound confirmation:** bind preview to exact document hash, transformed payload hash, provider/model, expiry, and one-time confirmation; confirmation must not silently recompute different outbound content.
6. **Pseudonymization claims:** align code, UI, and policy on exactly which data classes are transformed, what remains visible, and what “preview” covers. Legal statements require qualified review.
7. **Release platforms:** define the first supported OS and required Node/OCR bundling, signing, updater, installer verification, and rollback evidence before claiming “all targets.”
8. **Retention model:** define in-memory document lifetime, console/support logging policy, clear/reset behavior, consent-preference lifetime, and provider-policy presentation.

### Recommended specification slices

1. **Trust boundary and lifecycle:** shell-owned engine, readiness/version/auth, port collision, crash and shutdown scenarios.
2. **Authorized document processing:** file-dialog/native-drop parity, path authority, size/page/OCR resource caps, cancellation, and untrusted-PDF failure behavior.
3. **Privacy transaction:** exact preview/confirm binding, consistent CLI/HTTP/MCP/desktop behavior, provider disclosure, full-vs-sample semantics, and no direct bypass.
4. **Desktop experience:** typed errors, retry/cancel/clear, duplicate filenames, editable review state if still in scope, safe CSV, keyboard/screen-reader/modal/responsive requirements.
5. **Packaging and operations:** platform-specific sidecar/OCR resources, CSP/capabilities, signing/update/rollback, installer integrity, logging, and support diagnostics.
6. **Verification:** strict-TDD test seams, frontend accessibility tests, Rust lifecycle tests, HTTP security tests, adversarial OCR bounds, desktop E2E, CI matrices, and package smoke tests.
7. **Documentation reconciliation:** generated test/version evidence, current-vs-roadmap labels, privacy claims, installation, troubleshooting, and security model.

### Suggested sequencing and review forecast

The likely implementation is substantially above the 400-line review budget and should be split by dependency, not by arbitrary file count:

1. Establish tests and the lifecycle/trust contract.
2. Implement shell-owned authenticated engine transport and authorized file access.
3. Unify and bind privacy flows.
4. Correct desktop behavior, CSV, and accessibility.
5. Add packaging/release CI and reconcile documentation.

Each slice should remain independently verifiable; the proposal/tasks phase should forecast changed lines and PR boundaries before apply. No implementation should begin from this exploration alone.

## Primary risks for the next phase

- Treating loopback as authentication would preserve the highest-impact local attack surface.
- Fixing only the desktop privacy route would leave CLI/MCP/direct HTTP claims inconsistent.
- Bundling Node without OCR/resource/shutdown design would produce a larger but still unreliable app.
- A broad single PR would exceed the review budget and mix trust-boundary, UX, packaging, and documentation concerns.
- The existing red/flaky test must be classified and stabilized before it can serve as regression evidence.
- Legal/privacy claims should be validated by qualified counsel; this exploration establishes code/document mismatches, not legal compliance.
