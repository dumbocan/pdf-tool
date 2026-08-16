# SDD Project Context: pdf-tool

Refreshed: 2026-08-15T20:24:07Z

## Session Preflight

- Execution mode: `interactive`
- Artifact store: `hybrid` (OpenSpec + Engram)
- Chained PR strategy: `auto-forecast`
- Review budget: 400 changed lines
- Strict TDD: enabled
- Current activity: initialize context before the NeluPDF audit
- Initialization does not authorize product-code implementation.

## Repository State Boundary

The repository contains existing tracked and untracked application changes, including the in-progress `apps/nelupdf/` desktop application and privacy-related Node modules/tests. These changes predate this initialization and must be preserved. This phase changes only SDD context artifacts.

## Product and Architecture

### Node extraction engine (`pdf-tool` 0.2.0)

- Runtime: Node.js >=22, native ESM.
- Main dependencies: `pdfjs-dist` 4.10.38, Zod 4.4.3, MCP SDK 1.30.0.
- Entry points:
  - HTTP service: `src/server.js`
  - CLI: `bin/pdf-tool.mjs`
  - MCP facade: `src/mcp-facade.js`
- Responsibilities: bounded PDF text extraction, deterministic invoice-field and vendor parsing, folder scanning/OCR orchestration, privacy preview/pseudonymization, and optional provider-assisted extraction.
- Trust boundary: PDF content is untrusted. Deterministic local processing is the default; provider use requires explicit paths and privacy controls.

### NeluPDF desktop client (`apps/nelupdf`, 0.1.0)

- Frontend: React 19, TypeScript 5.8, Vite 7.
- Desktop shell: Tauri 2 with Rust 2021.
- Current integration: the React webview calls the Node engine over `VITE_MOTOR_URL`, defaulting to `http://127.0.0.1:3000`.
- The frontend currently implements PDF selection/drag-and-drop, deterministic extraction requests, CSV export, and an explicit privacy-preview/confirmation path before LLM-assisted extraction.
- The Rust shell currently contains only the template `greet` command and opener plugin. No engine sidecar startup, shutdown, readiness, packaging, or authentication integration was observed.
- The desktop app is currently untracked in Git and is not covered by repository CI.

## Authoritative Commands

### Root Node engine

- Install: `npm ci`
- Start: `npm start`
- Test: `npm test` (equivalent to `node --test test/*.test.js`)
- Scan CLI: `npm run scan`
- Docker configuration check: `docker compose config`
- CI: `npm ci && node --test test/*.test.js && npm audit --omit=dev && docker compose config`

### NeluPDF desktop app

- Development: `cd apps/nelupdf && pnpm dev`
- Type check: `pnpm --dir apps/nelupdf exec tsc --noEmit`
- Frontend build: `cd apps/nelupdf && pnpm build`
- Tauri development: `cd apps/nelupdf && pnpm tauri dev`
- Tauri build: `cd apps/nelupdf && pnpm tauri build`

## Testing Capabilities and Baseline

- Framework: Node.js built-in test runner.
- Test location: `test/*.test.js` (17 files observed).
- Coverage: unit and HTTP integration behavior, privacy boundaries, MCP facade, parser behavior, CLI-adjacent folder scanning, and server contracts.
- No E2E suite or coverage gate is configured.
- No project linter or formatter is configured.
- NeluPDF TypeScript strict checking is available through `tsc`; the check passed during initialization.
- No frontend, Tauri/Rust, or desktop integration tests are configured for NeluPDF.
- `docker compose config --quiet` passed during initialization.
- Current Node test baseline: 144 tests total, 143 passed, 1 failed.
- Current failure: `test/pseudonymize.test.js` — `amounts mapped affinely preserving arithmetic (factor entero)` failed because a real amount remained present.

Strict TDD remains active because the repository has an executable automated test runner. Any later apply phase must distinguish the pre-existing failing baseline from new failures and add the appropriate test coverage before product changes. Desktop work must not claim TDD coverage until a suitable desktop test seam/runner exists or the design explicitly establishes one.

## Conventions

- JavaScript and TypeScript use ESM imports, semicolons, two-space indentation, and explicit bounded error contracts.
- Root tests use `node:test` with `node:assert/strict` and are colocated under `test/`.
- TypeScript uses strict mode, `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch`.
- Rust uses edition 2021 and standard Cargo/Tauri conventions.
- User-facing project documentation and UI are primarily Spanish; technical SDD artifacts remain English.
- Security/privacy behavior and local-first claims must be verified against runtime paths rather than inferred from UI copy or documentation.

## SDD Phase Rules

- Proposal: define the Node engine, desktop client, process lifecycle, loopback authentication, and packaging boundaries; separate observations from audit recommendations.
- Specs: use RFC 2119 keywords and Given/When/Then scenarios; cover local-only behavior, explicit provider consent, untrusted PDFs, desktop failures, and privacy boundaries.
- Design: preserve bounded resource use and deterministic/local behavior; make startup/shutdown, readiness, authentication, CSP, and sidecar ownership explicit.
- Tasks: order by dependency, keep work independently verifiable, forecast PR/review size against the 400-line budget, and preserve existing user changes.
- Apply: strict TDD is mandatory. Do not implement from this initialization artifact alone.
- Verify: run the root Node suite, NeluPDF TypeScript check, relevant desktop tests once established, and configuration/build checks appropriate to the changed scope.
- Archive: require explicit implementation authorization and verification evidence.

## Known Audit Risks

1. The root test baseline is not green.
2. NeluPDF has no automated desktop test coverage and is absent from CI.
3. The desktop client assumes a separately running loopback engine; lifecycle and packaging ownership are not implemented in the Rust shell.
4. Desktop HTTP authentication and CSP hardening are not evident in the current client/config.
5. Existing README test counts and some architecture claims are stale relative to the current working tree.
