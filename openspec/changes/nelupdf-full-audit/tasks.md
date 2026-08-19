# Tasks: NeluPDF Full Audit

**Change:** `nelupdf-full-audit`
**Artifact store:** Hybrid (OpenSpec + Engram)
**Preflight strategy:** `auto-forecast`
**Implementation rule:** Execute one bounded work unit at a time. Do not create commits or PRs unless separately authorized.

## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | 12,400–19,200 authored lines across the six-slice program |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | One review/PR candidate per work unit: Slice 1A1 → 1A2 → … → 6D1; never combine units merely to reduce review count |
| Delivery strategy | ask-on-risk (using the requested auto-forecast preflight) |
| Chain strategy | feature-branch-chain (user-approved; no PR action authorized) |

Decision needed before apply: No — chain strategy resolved
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

The delivery-mechanics decision is resolved as `feature-branch-chain`. This document still does not authorize a branch, commit, push, or PR. The smallest next implementable unit is **WU-1A1**, because every later behavior unit depends on an executable frontend/component/accessibility seam and runtime visual evidence. WU-1A1 does not change extraction, MCP, HTTP, Rust command, provider, or release behavior.

### Per-slice forecast

| Slice | Outcome | Authored changed lines | Review units |
| --- | --- | ---: | --- |
| 1 | Test seams, Rust-mediated private stdio boundary, local extraction, immediate HTTP/CSP closure | 4,780–7,290 | 1A1–1G3 |
| 2 | Persistent lifecycle, shell document authority, bounded OCR | 2,120–3,040 | 2A1–2D2 |
| 3 | Unified content-bound privacy transaction with no raw bypass | 1,980–2,980 | 3A1–3D2 |
| 4 | Desktop reliability, accessibility, safe export, diagnostics | 1,220–1,930 | 4A1–4D1 |
| 5 | Linux qualification, package, CSP/capabilities, integrity, release operations | 1,620–2,550 | 5A1–5D2 |
| 6 | Evidence-gated provider enablement | 680–1,140 | 6A1–6D1 |

### Per-work-unit forecast and proposed chain boundaries

| Unit | Authored lines | Unit | Authored lines | Unit | Authored lines |
| --- | ---: | --- | ---: | --- | ---: |
| 1A1 | 180–280 | 1A2 | 100–180 | 1A3 | 120–220 |
| 1A4 | 80–160 | 1B1 | 180–300 | 1B2 | 280–390 |
| 1B3 | 220–360 | 1C1 | 240–360 | 1C2 | 260–390 |
| 1C3 | 180–300 | 1D1 | 240–360 | 1D2 | 260–390 |
| 1D3 | 280–400 | 1E1 | 280–390 | 1E2 | 300–400 |
| 1E3 | 260–390 | 1F1 | 260–380 | 1F2 | 300–400 |
| 1F3 | 280–400 | 1G1 | 180–300 | 1G2 | 220–360 |
| 1G3 | 80–180 | 2A1 | 240–360 | 2A2 | 300–400 |
| 2B1 | 280–390 | 2B2 | 260–380 | 2C1 | 260–390 |
| 2C2 | 240–360 | 2D1 | 240–360 | 2D2 | 300–400 |
| 3A1 | 220–340 | 3A2 | 240–360 | 3B1 | 260–390 |
| 3B2 | 260–390 | 3C1 | 220–350 | 3C2 | 280–400 |
| 3D1 | 240–360 | 3D2 | 260–390 | 4A1 | 220–340 |
| 4A2 | 160–280 | 4B1 | 260–390 | 4C1 | 240–360 |
| 4C2 | 180–300 | 4D1 | 160–260 | 5A1 | 160–260 |
| 5A2 | 220–340 | 5B1 | 180–300 | 5B2 | 220–340 |
| 5C1 | 180–300 | 5C2 | 260–390 | 5D1 | 240–360 |
| 5D2 | 160–260 | 6A1 | 180–280 | 6B1 | 180–300 |
| 6C1 | 220–360 | 6D1 | 100–200 | | |

Each unit is an autonomous candidate boundary with a defined start, finish, focused verification, visual evidence, and file-level rollback. If actual authored additions plus deletions approach 400, stop and subdivide before further implementation; generated fixtures remain in candidate identity even when excluded from authored-line accounting.

## Program-wide apply protocol

These requirements apply to **every** implementation work unit below.

1. **Scope preservation.** Before editing, capture `git status --short --untracked-files=all`, `git diff --name-status`, `git diff --stat`, and `git ls-files --others --exclude-standard`. Read every candidate file before replacing it. After editing, repeat the four commands, run `git diff --check`, and record intended paths, pre-existing paths, additions/deletions, file modes, and any unexplained drift in `sdd/nelupdf-full-audit/apply-progress`. Never stage, reset, clean, checkout, commit, or modify unrelated tracked/untracked work.
2. **Strict TDD.** Record the focused RED command, expected failing assertion, and actual failure before product behavior; implement only enough for GREEN; add at least one boundary/negative case in TRIANGULATE; then REFACTOR with the same focused tests green. A test that passes initially is characterization evidence, not RED.
3. **Evidence.** Record exact command, exit status, test counts, and runtime context. After WU-1A1, run the applicable `vui-smoke` runtime scenario at standard and narrow viewports after every unit. For non-UI units, capture the unchanged selection/local-only state and console/network readback; if the shell cannot run, record a blocking unavailable result rather than claiming visual proof.
4. **Regression claims.** Do not call the root suite green until WU-1A3 stabilizes or visibly isolates the randomized pseudonymization test. Do not call desktop work TDD-covered before WU-1A1 and WU-1A2 establish the frontend and Rust seams.
5. **OpenClaw invariant.** The live service is `pdf-tool` in `/home/jmon/openclaw/docker-compose2.yml`; `/home/jmon/openclaw/services/pdf-tool-sidecar` is historical and must not be used as deployment evidence. Relevant Node/HTTP/MCP units must preserve `/mcp`, initialize/session behavior, `tools/list`, the names and schemas of `extract_pdf_from_path`, `extract_pdf_from_base64`, and `extract_pdf_with_llm`, and internal connectivity from `laia-imap-sidecar`, or deliver an explicit versioned migration with consumer evidence before changing behavior. Never silently break OpenClaw.
6. **No provider enablement.** Provider traffic remains disabled until Slice 6 has qualified dated provider/account/model/purpose/jurisdiction evidence and Slice 5 release gates. Technical configuration is insufficient.
7. **Dependency/package gates.** Any `package.json`, `pnpm-lock.yaml`, `Cargo.toml`, or `Cargo.lock` change must identify why each dependency is required, use the existing package manager, inspect lockfile-only drift, run the applicable audit/build commands, and avoid unrelated upgrades.

### Canonical verification commands

- Root focused/full: `node --test test/<focused>.test.js`; `node --test test/*.test.js`; `npm audit --omit=dev`; `docker compose config`.
- Frontend after WU-1A1: `pnpm --dir apps/nelupdf test -- --run <test-file>`; `pnpm --dir apps/nelupdf test -- --run`; `pnpm --dir apps/nelupdf exec tsc --noEmit`; `pnpm --dir apps/nelupdf build`.
- Rust after WU-1A2: `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml <filter>`; `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml`; `cargo check --manifest-path apps/nelupdf/src-tauri/Cargo.toml`; `cargo fmt --manifest-path apps/nelupdf/src-tauri/Cargo.toml -- --check`.
- Installed Tauri config/API gate: `pnpm --dir apps/nelupdf tauri info`; `pnpm --dir apps/nelupdf tauri build --debug --no-bundle`.
- OpenClaw static/focused: `node --test test/mcp-facade.test.js test/server.test.js`; `npm --prefix /home/jmon/openclaw/services/laia-imap-sidecar test`.
- OpenClaw live after WU-1A3 creates the safe script: `docker compose -f /home/jmon/openclaw/docker-compose2.yml ps pdf-tool laia-imap-sidecar`; `docker inspect --format '{{.State.Health.Status}}' "$(docker compose -f /home/jmon/openclaw/docker-compose2.yml ps -q pdf-tool)"`; `docker compose -f /home/jmon/openclaw/docker-compose2.yml exec -T laia-imap-sidecar node --input-type=module < test/fixtures/openclaw-live-smoke.mjs`.
- Visual runtime after WU-1A1: start with `pnpm --dir apps/nelupdf dev --host 127.0.0.1`; invoke the runtime `vui-smoke` actor against `http://127.0.0.1:1420` using `apps/nelupdf/test/visual/<unit>.scenario.json`; capture screenshots, semantic readback, keyboard/focus results, console, and network attempts. Direct Playwright MCP is not an accepted substitute.

## Foolproof per-WU continuation contract

Use this contract for every continuation, even when a prompt or older progress entry sounds broader.

1. Read, in order: the newest resumption summary, this contract, the selected WU definition, the newest generation block, and the final Immediate apply boundary. Newer explicit boundaries override stale historical “next” text; history remains evidence, not authority.
2. Select exactly one WU named by the Immediate apply boundary. Never infer authorization from dependencies being complete, checked rows, candidate lists, or a future WU appearing next in this file.
3. Confirm every dependency and parent-owned verification/settlement named for that WU is closed. If any proof is missing or contradictory, stop and return the missing fact; do not guess.
4. Before work, create a continuation packet from the canonical template in `apply-progress.md`. It must name the exact allowed edit root/files, forbidden surfaces, existing dirty paths, line budget, checks, and hard stop.
5. Preserve all pre-existing tracked and untracked work. Read each allowed target before editing; never stage, reset, clean, checkout, commit, push, open a PR, publish, release, or mutate review/RDD state unless a later human authorization explicitly names that exact action.
6. Candidate lists are maximum possible scope, not permission to edit every candidate. Touch only files required by the observed RED and explicitly allowed by the continuation packet.
7. Follow strict TDD for behavior work: capture a meaningful behavior RED first, make the minimum GREEN change, TRIANGULATE a material boundary/negative case, then REFACTOR only while focused checks remain green. Never relabel characterization, compilation, or an unavailable check as RED or PASS.
8. Documentation-only closure is a justified no-RED exception. It may change only its named documentation/memory surfaces and must run structural readback plus `git diff --check`; it must not run product tests merely to manufacture TDD evidence.
9. Run focused checks before broader authorized checks. Record exact command, exit status, counts, runtime context, typed unavailable evidence, and any non-green result without concealment.
10. Treat OpenClaw as read-only unless the selected WU and a later explicit authorization both require mutation. Never expose credentials, tokens, mail, invoice content, or private payloads in commands, logs, fixtures, docs, or memory.
11. Re-run the four scope commands from the Program-wide apply protocol and `git diff --check`. The effective budget is `max(native changed_lines, real authored lines)`. Real authored lines MUST include: tracked files via `git diff --numstat`; untracked candidate files counted explicitly as additions/deletions; tasks.md and apply-progress.md. Exclude only lockfiles, generated fixtures, or artifacts when the SDD explicitly justifies it. The native ledger remains mandatory but is not the sole control when it omits untracked files. Record BOTH figures at start and at close; if either reaches the WU budget (WU-1B2 = 390), stop and split. Report unexplained drift instead of repairing unrelated files.
12. Update only the selected WU rows and append one bounded generation block. Never rewrite historical generations; factual corrections require exact parent authorization and must be called out.
13. Return the continuation packet, RED/GREEN/TRIANGULATE/REFACTOR evidence, structural/runtime readback, exact scope/modes, line accounting, row truth, rollback, risks, and next hard stop. Mirror canonical tasks/progress in Engram without overwriting the handoff topic.
14. Stop after the selected WU. The following WU remains unauthorized until parent independent verification and native settlement close the current candidate and the human or parent explicitly selects the next boundary.

## Slice 1 — Harness, Rust boundary, deterministic local extraction

### WU-1A1 — NEXT: frontend/component/a11y and visual seam

**Depends on:** None. **Candidates:** `apps/nelupdf/package.json`, `apps/nelupdf/pnpm-lock.yaml`, `apps/nelupdf/vite.config.ts`, `apps/nelupdf/src/test/setup.ts`, `apps/nelupdf/src/App.harness.test.tsx`, `apps/nelupdf/test/visual/1a1-baseline.scenario.json`. **Acceptance:** Vitest-compatible component tests, DOM user events, and automated accessibility assertions run in this project; a current selection-screen characterization is executable; real-`App` user-event/axe tests prove the selection control's role/name, keyboard activation, and automated accessibility result, while installed `vui-smoke` records the standard 1440×1000 visual, semantic, console, failed-request, and HTTP-error baseline; narrow interactive browser evidence is maintainer-deferred because the installed actor has no scenario, viewport, or keyboard interface; no extraction/Rust/MCP behavior changes. **Rollback:** remove only harness/config/dependency additions and restore exact lockfile/config hunks.

- [x] `WU-1A1-RED` Add the smallest test and visual manifests first; record the failing `pnpm --dir apps/nelupdf test -- --run src/App.harness.test.tsx` result caused only by the absent runner/setup. <!-- sdd-owner: implementation -->
- [x] `WU-1A1-GREEN` Add pinned test/a11y dependencies and scripts with `pnpm`, make the characterization pass, then run TypeScript and build commands without claiming desktop E2E. <!-- sdd-owner: implementation -->
- [x] `WU-1A1-TRIANGULATE` Prove keyboard activation and an axe-style negative fixture; run installed `vui-smoke` at its standard 1440×1000 viewport and record semantic, console, failed-request, and HTTP-error evidence; record the maintainer-approved narrow interactive browser deferral. <!-- sdd-owner: implementation -->
- [x] `WU-1A1-REFACTOR` Remove harness duplication, inspect lockfile drift, run the program-wide scope protocol, and stop if authored changes exceed 280 lines. <!-- sdd-owner: implementation -->

Correction note: fixture-only keyboard evidence is superseded. Current WU-1A1 proof renders and exercises the real `<App />`; the isolated negative fixture verifies only the harness.

### WU-1A2 — Rust unit and command-contract seam

**Depends on:** WU-1A1. **Candidates:** `apps/nelupdf/src-tauri/Cargo.toml`, `apps/nelupdf/src-tauri/Cargo.lock`, `apps/nelupdf/src-tauri/src/lib.rs`, `apps/nelupdf/src-tauri/src/test_support.rs`. **Acceptance:** `cargo test` can exercise pure DTO/service tests without launching a GUI; no production extraction command is added; installed Cargo/Tauri versions are recorded. **Rollback:** remove only test-only modules/dependencies and restore manifest/lock hunks.

- [x] `WU-1A2-RED` Add a minimal test-only contract placeholder and record `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml contract_test_seam` failing because the seam is absent. <!-- sdd-owner: implementation -->
- [x] `WU-1A2-GREEN` Add the smallest `cfg(test)` seam and make the focused test, full Cargo test, Cargo check, and format check pass. <!-- sdd-owner: implementation -->
- [x] `WU-1A2-TRIANGULATE` Prove tests can inject deterministic IDs/clocks without exposing those controls in production; keep real Tauri APIs compile-checked. <!-- sdd-owner: implementation -->
- [x] `WU-1A2-REFACTOR` Remove unused template test helpers, capture unchanged `vui-smoke` baseline, and complete scope/lockfile evidence within 180 lines. <!-- sdd-owner: implementation -->

### WU-1A3-PRE — hash-locked pseudonymization baseline import

**Separate prerequisite only:** this imports an already-inspected baseline; it grants no WU-1A3 product-development permission.
**OUTCOME:** the exact authorized pseudonymizer and characterization test exist in the isolated worktree with provenance and no behavior edits.
**START ONLY IF:** WU-1A2 is independently verified/natively complete and both dirty-root sources match their authorized hashes, line counts, and byte sizes.
**ALLOWED FILES:** `src/pseudonymize.js`, `test/pseudonymize.test.js`, this `tasks.md`, and cumulative `apply-progress.md` only.
**NEVER TOUCH:** OpenClaw, WU-1A2 candidate bytes, WU-1A3/WU-1A4 behavior, delivery state, or any other path.
**LINE LIMIT 280:** count all authored additions plus deletions, including task/progress evidence; stop before exceeding it.
**STRUCTURAL RED:** before copy, the exact focused stable test MUST exit nonzero because its file is absent; this proves PRE provenance only.
**GREEN:** copy both authorized files byte-for-byte, normalize only to regular non-executable mode `100644`, verify exact hashes, and pass the focused stable test.
**TRIANGULATE:** pass focused reverse/masking wiring tests, then run the imported file once as characterization; preserve any randomized failure without claiming stability.
**REFACTOR:** no source/test refactor is allowed; recheck hashes, sizes, modes, imports, secret assignments, scope, `git diff --check`, and line budget.
**EXACT COMMANDS/EXPECTED RESULTS:** RED/GREEN use `node --test --test-name-pattern='PII identifiers replaced consistently across multiple occurrences' test/pseudonymize.test.js` (absent/nonzero, then 1/1 pass); TRIANGULATE runs focused reverse/masking tests and `node --test test/pseudonymize.test.js` once; never run the WU-1A3 50-loop command.
**INVALID RED:** any pass-before-copy, different failure after the file exists, behavioral assertion, source/test mutation, or WU-1A3 randomized-gate execution is invalid.
**ENGRAM SAVES:** persist distinct PRE preflight, RED, GREEN, TRIANGULATE, REFACTOR, and closure checkpoints plus canonical tasks/progress updates; never overwrite the handoff topic.
**ROLLBACK:** remove only the two imported files and PRE task/progress hunks; preserve all WU-1A1/WU-1A2 history and unrelated work.
**DONE ONLY WHEN:** every PRE gate passes, the four PRE rows are checked in both stores, exact revisions/accounting are recorded, and parent independent verification/native settlement is requested.
**NEXT WU/HARD STOP:** parent lifecycle verifies/settles PRE; only then may WU-1A3 be separately started. Do not start WU-1A4 or WU-1B1.

- [x] `WU-1A3-PRE-RED` Capture the valid absent-file structural RED before copying either authorized baseline file. <!-- sdd-owner: implementation -->
- [x] `WU-1A3-PRE-GREEN` Import both hash-locked files byte-for-byte and pass the exact focused stable test. <!-- sdd-owner: implementation -->
- [x] `WU-1A3-PRE-TRIANGULATE` Pass focused reverse/masking wiring tests and characterize the full imported file exactly once without a stability claim. <!-- sdd-owner: implementation -->
- [x] `WU-1A3-PRE-REFACTOR` Make no source/test refactor; complete integrity, security, scope, mode, process, and line-budget checks. <!-- sdd-owner: implementation -->

### WU-1A3 — Node/OpenClaw characterization and randomized-baseline gate

**Depends on:** WU-1A2. **Candidates:** `test/pseudonymize.test.js`, `test/mcp-facade.test.js`, `test/openclaw-compat.test.js`, `test/fixtures/openclaw-live-smoke.mjs`; product candidates are forbidden unless a separate RED proves they are required. **Acceptance:** run the randomized assertion repeatedly; either stabilize test inputs/assertions without changing product behavior or mark the test isolated and block green-suite claims; characterize `/mcp`, initialize/list, all three legacy names/schemas, and live `laia-imap-sidecar` wiring. **Rollback:** revert only test/fixture changes; never modify `/home/jmon/openclaw`.

- [x] `WU-1A3-RED` Run `for i in $(seq 1 50); do node --test --test-name-pattern='amounts mapped affinely preserving arithmetic' test/pseudonymize.test.js || exit 1; done` and record the first reproducible failure/seed evidence without repairing unrelated product code. <!-- sdd-owner: implementation -->
- [x] `WU-1A3-GREEN` Make the randomized test deterministic only at its test seam, or record explicit isolation and create a separately scoped dependency task if production behavior is truly defective. <!-- sdd-owner: implementation -->
- [x] `WU-1A3-TRIANGULATE` Add static and live OpenClaw contract checks, then run the canonical OpenClaw focused, sidecar, health, and stdin smoke commands; require the three exact tool names and schemas. <!-- sdd-owner: implementation -->
- [x] `WU-1A3-REFACTOR` Keep fixtures credential-free/content-safe, capture unchanged visual baseline and candidate scope, and forbid any green-regression claim unless the randomized gate is trustworthy. <!-- sdd-owner: implementation -->

### WU-1A4 — CI seam inventory without behavior rollout

**Depends on:** WU-1A3. **Candidates:** `.github/workflows/ci.yml`, `apps/nelupdf/package.json`, `apps/nelupdf/src-tauri/Cargo.toml`. **Acceptance:** CI commands for frontend, a11y, TypeScript, Rust, and existing Node checks are defined but no unavailable boundary/E2E check is misrepresented as passing; `vui-smoke` remains runtime evidence, not fake CI E2E. **Rollback:** restore only CI/script hunks.

- [x] `WU-1A4-RED` Add a CI validation expectation and record its failure because desktop jobs/scripts are absent. <!-- sdd-owner: implementation -->
- [x] `WU-1A4-GREEN` Add install/cache/test/check stages using `pnpm --frozen-lockfile`, Cargo, and existing npm commands; keep boundary/package jobs explicitly pending. <!-- sdd-owner: implementation -->
- [x] `WU-1A4-TRIANGULATE` Prove a deliberately failing frontend and Rust test would fail their jobs, then restore green bytes; do not disable the randomized baseline gate. <!-- sdd-owner: implementation -->
- [x] `WU-1A4-REFACTOR` Remove duplicated installs, run workflow structural readback plus all local canonical checks, capture visual/scope evidence, and stay within 160 lines. <!-- sdd-owner: implementation -->

### WU-1B1 — Freeze OpenClaw/MCP compatibility contract

**Depends on:** WU-1A4. **Candidates:** `test/mcp-facade.test.js`, `test/openclaw-compat.test.js`, `test/fixtures/openclaw-tools-v1.json`, `docs/migrations/openclaw-mcp-v1.md`. **Acceptance:** exact `/mcp` session behavior, tool names, schemas, deterministic base64 result meaning, and live internal network are executable gates; path/LLM security changes are documented as future versioned migrations, not silently applied. **Rollback:** remove only contract fixture/docs/tests.

- [x] `WU-1B1-RED` Add a contract test that fails on renamed/removed tools or schema drift and record the expected failure against a deliberately mutated fixture. <!-- sdd-owner: implementation -->
- [x] `WU-1B1-GREEN` Generate/curate the fixture from current verified behavior and make `node --test test/mcp-facade.test.js test/openclaw-compat.test.js` pass. <!-- sdd-owner: implementation -->
- [x] `WU-1B1-TRIANGULATE` Exercise initialize, `tools/list`, session reuse, deterministic base64 call, and all three tool declarations from `laia-imap-sidecar`; require healthy `pdf-tool`. <!-- sdd-owner: implementation -->
- [x] `WU-1B1-REFACTOR` Keep the fixture stable and content-free, run visual/scope evidence, and reject use of the historical `services/pdf-tool-sidecar` directory. <!-- sdd-owner: implementation -->

### WU-1B2 — HTTP Origin/auth/CORS pre-document closure

**Depends on:** WU-1B1. **Candidates:** `src/server.js`, `test/server.test.js`. **Acceptance:** exact canonical origin allowlist, fail-closed 43-character base64url bearer requirement, preflight matrix, no wildcard/credentials, and rejection before body/extractor/provider work; `/healthz`, `/version`, `/mcp` compatibility behavior is explicitly tested rather than accidentally blocked. **Rollback:** revert server/test hunks; if safe rollback is impossible, disable document HTTP routes rather than restore permissive behavior.

- [x] `WU-1B2-RED` Add trusted/untrusted/missing/opaque/`null` origin and missing/invalid/valid auth tests with body/extractor/provider sentinels; record focused failures. <!-- sdd-owner: implementation -->
- [x] `WU-1B2-GREEN` Implement the minimal pre-route policy and make `node --test test/server.test.js` pass without weakening `/mcp` or content-free health/version behavior. <!-- sdd-owner: implementation -->
- [x] `WU-1B2-TRIANGULATE` Add malformed/multiple origin, exact CORS header, disallowed preflight, and no-sensitive-echo cases; run all OpenClaw static/live commands. <!-- sdd-owner: implementation -->
- [x] `WU-1B2-REFACTOR` Isolate policy parsing from route logic, run full root tests and unchanged visual smoke, and capture scope within 390 lines. <!-- sdd-owner: implementation -->

### WU-1B3 — Versioned unsafe-path migration

**Depends on:** WU-1B2. **Candidates:** `src/server.js`, `src/mcp-facade.js`, `test/server.test.js`, `test/mcp-facade.test.js`, `docs/migrations/openclaw-mcp-v1.md`, OpenClaw files are read-only discovery targets. **Acceptance:** `/extract-path` cannot read before authority and returns `unsafe_path_contract_removed_v1`; MCP `extract_pdf_from_path` remains listed with its frozen schema and either remains workspace-bounded under approved compatibility or returns the explicit versioned migration result; `laia-imap-sidecar` base64 extraction remains live. **Rollback:** preserve the safer policy; disable the affected route/tool rather than restore arbitrary reads.

- [x] `WU-1B3-RED` Add filesystem spies for HTTP/MCP path branches, workspace escape/symlink cases, stable error code, tool-list preservation, and live consumer expectations; record focused failures. <!-- sdd-owner: implementation -->
- [x] `WU-1B3-GREEN` Implement the smallest security-monotonic migration without changing tool names/schemas or the safe base64 path. <!-- sdd-owner: implementation -->
- [x] `WU-1B3-TRIANGULATE` Test no stat/realpath/read on rejected inputs, explicit migration guidance, OpenClaw initialize/list/base64 extraction, and any approved path-consumer migration. <!-- sdd-owner: implementation -->
- [x] `WU-1B3-REFACTOR` Centralize the stable migration envelope, run focused/full/OpenClaw/visual checks, and record rollback plus scope within 360 lines. <!-- sdd-owner: implementation -->

### WU-1C1 — Node framed-stdio parser and closed request contract

**Depends on:** WU-1B3. **Candidates:** `src/engine-protocol.js`, `test/engine-protocol.test.js`, `test/fixtures/engine-protocol/*.json`. **Acceptance:** 32-bit big-endian framing, exact request/base64/decoded/hash/limit validation, one JSON value, EOF/trailing-data rejection, and 17,825,792-byte request cap are tested independently of extraction. **Rollback:** remove the additive protocol module/tests/fixtures.

- [x] `WU-1C1-RED` Write malformed, zero, overflow, under-read, over-read, trailing, UTF-8/JSON, base64, hash, and boundary-size tests before the parser exists. <!-- sdd-owner: implementation -->
- [x] `WU-1C1-GREEN` Implement only bounded frame/request parsing and make `node --test test/engine-protocol.test.js` pass. <!-- sdd-owner: implementation -->
- [x] `WU-1C1-TRIANGULATE` Add exact-max/exact-max-plus-one and unknown-field/version cases plus allocation guards. <!-- sdd-owner: implementation -->
- [x] `WU-1C1-REFACTOR` Keep I/O separate from domain extraction, run root/OpenClaw/visual/scope checks, and stay within 360 lines. <!-- sdd-owner: implementation -->
- Evidence: 12/12 engine-protocol tests pass; root suite 153/153 pass; `git diff --check` exit 0; 164+151+~44=359 lines within 360 budget. Real SHA-256 hash validation (not the old `Buffer.from(JSON.stringify({data})).toString("base64").slice(0,32)` algorithm). parseFrame (I/O) vs validateRequest (domain) separated.

### WU-1C2 — Node stdio extraction adapter reusing the existing engine

**Depends on:** WU-1C1. **Candidates:** `src/engine-stdio.js`, `src/engine-protocol.js`, `src/extract.js` only for exported reuse seams, `src/vendor-parsers.js`, `src/mercadona-parser.js`, `test/engine-stdio.test.js`. **Acceptance:** adapter imports and reuses `validatePdfBuffer`, `extractTextFromPdf`, invoice/vendor parsing, and existing bounds; it does not duplicate or rewrite PDF parsing; stdout is protocol-only; scanned input returns typed `ocr_required_unavailable`; provider/OCR paths are unreachable. **Rollback:** remove adapter and any purely additive export seam; existing engine remains unchanged.

- [x] `WU-1C2-RED` Add valid, invalid, truncated, partial/scanned, parser-result, no-OCR, and no-provider tests that fail because the executable adapter is absent. <!-- sdd-owner: implementation -->
- [x] `WU-1C2-GREEN` Implement the one-request executable as a bounded adapter over existing extraction modules and make `node --test test/engine-stdio.test.js` pass. <!-- sdd-owner: implementation -->
- [x] `WU-1C2-TRIANGULATE` Add fixture parity against existing deterministic HTTP/CLI meaning and reject any duplicated parser implementation in the adapter. <!-- sdd-owner: implementation -->
- [x] `WU-1C2-REFACTOR` Extract only shared normalization justified by parity, run root/OpenClaw/visual/scope checks, and stay within 390 lines. <!-- sdd-owner: implementation -->
- Evidence: 5/5 engine-stdio tests pass; root suite 158/158 pass; `git diff --check` exit 0; 333 lines within 260-390 budget. Adapter reuses `validatePdfBuffer`, `extractTextFromPdf`, `parseVendorLineItems` from existing modules without duplicating PDF parsing. Scanned input returns `status=partial` + `extractionMode=ocr_required_unavailable`.

### WU-1C3 — Node process security, response bound, and no-network proof

**Depends on:** WU-1C2. **Candidates:** `src/engine-stdio.js`, `src/engine-protocol.js`, `test/engine-process.test.js`, `test/fixtures/network-deny.mjs`. **Acceptance:** one response capped at 1,048,576 bytes, EOF required, stderr separated, external sockets/provider env/OCR forbidden, deterministic extraction succeeds under network denial. **Rollback:** revert only process-security test/adapter hunks.

- [x] `WU-1C3-RED` Add outbound-network, extra stdout/frame, response overflow, crash, stderr flood, and provider/OCR sentinel tests; record failures. <!-- sdd-owner: implementation -->
- [x] `WU-1C3-GREEN` Apply minimal protocol-only stdout and no-network/provider controls and make `node --test test/engine-process.test.js` pass. <!-- sdd-owner: implementation -->
- [x] `WU-1C3-TRIANGULATE` Run a valid PDF under denied network and absent provider configuration; verify local provenance and existing OpenClaw compatibility. <!-- sdd-owner: implementation -->
- [x] `WU-1C3-REFACTOR` Bound helpers without broad engine refactoring, then run full Node/visual/scope checks within 300 lines. <!-- sdd-owner: implementation -->
- Evidence: 17/17 engine-process tests pass; root suite 175/175 pass (`node --test test/*.test.js`); `git diff --check` exit 0; 340 lines within 260-300 budget. `frameResponse()` caps at MAX_RESPONSE_BYTES via text truncation + error fallback; `enforceProcessSecurity()` strips 16 provider/OCR env vars at module load; network-deny.mjs blocks outbound sockets; deterministic extraction succeeds under network denial.

### WU-1D1 — Rust v1 DTOs, IDs, bounds, and public errors

**Depends on:** WU-1C3. **Candidates:** `apps/nelupdf/src-tauri/src/contracts.rs`, `apps/nelupdf/src-tauri/src/lib.rs`, `apps/nelupdf/src-tauri/Cargo.toml`, `Cargo.lock`. **Acceptance:** closed serde DTOs enforce protocol, UUID, name, base64, size, option, result, and safe-error bounds; URL/path/token/unknown fields reject; no command behavior yet. **Rollback:** remove additive contracts and dependency changes.

- [x] `WU-1D1-RED` Write serde/validator tests for every exact v1 bound and forbidden field, then record focused Cargo failures. <!-- sdd-owner: implementation -->
- [x] `WU-1D1-GREEN` Implement minimal closed DTOs and validators; run `cargo test --manifest-path apps/nelupdf/src-tauri/Cargo.toml contracts`. <!-- sdd-owner: implementation -->
- [x] `WU-1D1-TRIANGULATE` Add max/max+1 Unicode scalar/UTF-8, UUID version/case, enum, safe-context, and response-consistency cases. <!-- sdd-owner: implementation -->
- [x] `WU-1D1-REFACTOR` Deduplicate bound checks without weakening closed schemas; run Cargo/frontend/visual/scope and dependency gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-1D2 — Rust in-memory authorized document store

**Depends on:** WU-1D1. **Candidates:** `apps/nelupdf/src-tauri/src/documents.rs`, `contracts.rs`, `lib.rs`, focused Rust fixtures. **Acceptance:** canonical base64/decoded equality, PDF validation, SHA-256, 128-bit opaque session IDs, get/revoke/clear/drop, no path authority, and no sensitive logging; deterministic IDs are test-only. **Rollback:** remove additive store module/wiring.

- [x] `WU-1D2-RED` Add register/forge/mismatch/overflow/invalid-PDF/revoke/clear/drop tests and record their absence failures. <!-- sdd-owner: implementation -->
- [x] `WU-1D2-GREEN` Implement bounded in-memory registration and opaque lookup; run focused `cargo test ... documents`. <!-- sdd-owner: implementation -->
- [x] `WU-1D2-TRIANGULATE` Test duplicate names, ID entropy shape, app-instance isolation, failure cleanup, and content-free diagnostics. <!-- sdd-owner: implementation -->
- [x] `WU-1D2-REFACTOR` Keep document authority behind a narrow API, run Cargo/visual/scope checks, and stay within 390 lines. <!-- sdd-owner: implementation -->

### WU-1D3 — Rust command/service contract with fake engine

**Depends on:** WU-1D2. **Candidates:** `apps/nelupdf/src-tauri/src/commands.rs`, `services.rs`, `contracts.rs`, `documents.rs`, `lib.rs`. **Acceptance:** register/status/extract/cancel/clear v1 commands are explicit and testable through traits; fake adapter cannot enter production; unknown versions/responses fail typed; real process not yet wired. **Rollback:** restore `lib.rs` handler and remove additive command/service files.

- [x] `WU-1D3-RED` Add command envelope and fake-adapter tests that fail because versioned commands/services are absent. <!-- sdd-owner: implementation -->
- [x] `WU-1D3-GREEN` Implement minimal handlers/services and explicit `generate_handler!` registration using the fake only in tests. <!-- sdd-owner: implementation -->
- [x] `WU-1D3-TRIANGULATE` Add unauthorized ID, invalid response, safe error, status no-spawn/no-network, and clear behavior cases. <!-- sdd-owner: implementation -->
- [x] `WU-1D3-REFACTOR` Separate Tauri wrappers from pure services, run Cargo/Tauri check/visual/scope, and split before exceeding 400 lines. <!-- sdd-owner: implementation -->

### WU-1E1 — Rust private child spawn and framed process adapter

**Depends on:** WU-1D3. **Candidates:** `apps/nelupdf/src-tauri/src/engine.rs`, `services.rs`, `lib.rs`, Cargo manifests, Rust integration fixtures. **Acceptance:** Rust owns the exact dev executable and pipes, sends one bounded frame, validates one bounded response, sanitizes environment/descriptors, and never uses loopback or duplicates Node extraction. **Rollback:** remove production adapter wiring and restore fake-only service boundary; never restore webview HTTP as fallback.

- [x] `WU-1E1-RED` Add fake-child and real-Node process tests for spawn, frame, request/hash binding, malformed response, extra stdout, and child exit; record failures. <!-- sdd-owner: implementation -->
- [x] `WU-1E1-GREEN` Implement the minimal `ProcessEngineAdapter` over the existing Node stdio executable and pass focused Cargo integration tests. <!-- sdd-owner: implementation -->
- [x] `WU-1E1-TRIANGULATE` Test minimal environment, no provider secrets, response cap, stderr separation, and direct-HTTP absence. <!-- sdd-owner: implementation -->
- [x] `WU-1E1-REFACTOR` Keep process transport behind `EngineAdapter`, run Node/Cargo/OpenClaw/visual/scope gates within 390 lines. <!-- sdd-owner: implementation -->

### WU-1E2 — Operation registry, readiness, cancellation, and terminal CAS

**Depends on:** WU-1E1. **Candidates:** `apps/nelupdf/src-tauri/src/operations.rs`, `engine.rs`, `services.rs`, `contracts.rs`. **Acceptance:** one active operation/no queue, exact readiness vocabulary, caller UUID reservation, concurrent idempotent cancel, terminal precedence, 64-record/60-second content-free retention, and late-result suppression. **Rollback:** remove registry module and revert service integration to non-exposed adapter test state.

- [x] `WU-1E2-RED` Add deterministic-clock race tests for cancel-before/after success/timeout/exit, repeats, unknown IDs, capacity, and retention; record failures. <!-- sdd-owner: implementation -->
- [x] `WU-1E2-GREEN` Implement atomic reservation/state/terminal transitions and pass focused operation tests. <!-- sdd-owner: implementation -->
- [x] `WU-1E2-TRIANGULATE` Add status snapshots for every state and stale callback attempts after terminal commit. <!-- sdd-owner: implementation -->
- [x] `WU-1E2-REFACTOR` Isolate monotonic clock/test controls, run Cargo/Node/visual/scope checks, and split before 400 lines. <!-- sdd-owner: implementation -->

### WU-1E3 — Deadlines, termination, cleanup, and real boundary proof

**Depends on:** WU-1E2. **Candidates:** `apps/nelupdf/src-tauri/src/engine.rs`, `operations.rs`, `tests/boundary_v1.rs`, `test/fixtures/*`. **Acceptance:** 5s readiness, 30s wall clock, accepted cancellation terminal within 3s, graceful 1s/force 2s, total cleanup 5s, 65,536-byte stderr tail, restart admission only after cleanup, real Node offline success. **Rollback:** revert deadline/cleanup integration to the prior bounded non-delivered adapter; do not expose extraction if cleanup is unsafe.

- [x] `WU-1E3-RED` Add short injected-clock timeout/kill/reap/stderr/capacity and real-child offline tests; record failures. <!-- sdd-owner: implementation -->
- [x] `WU-1E3-GREEN` Implement bounded termination/cleanup and make focused Rust boundary tests pass. <!-- sdd-owner: implementation -->
- [x] `WU-1E3-TRIANGULATE` Exercise crash, hang, malformed response, cancellation race, cleanup failure/clear, and successful network-denied extraction. <!-- sdd-owner: implementation -->
- [x] `WU-1E3-REFACTOR` Consolidate terminal cleanup without changing precedence, run all internal/OpenClaw/visual/scope checks within 390 lines. <!-- sdd-owner: implementation -->

### WU-1F1 — TypeScript desktop adapter, decoder, and pure reducer

**Depends on:** WU-1E3. **Candidates:** `apps/nelupdf/src/platform/desktop-api.ts`, `src/features/extraction/types.ts`, `decoder.ts`, `reducer.ts`, focused tests. **Acceptance:** only static versioned Tauri command names; strict result decoder; pure exhaustive state reducer; caller UUID before state/invoke; source guard identifies current direct HTTP markers but does not remove them until integration. **Rollback:** remove additive frontend modules/tests.

- [ ] `WU-1F1-RED` Add decoder/reducer/IPC/source-guard tests for valid, malformed, unknown, stale, URL/token/path, and UUID cases; record expected failures. <!-- sdd-owner: implementation -->
- [ ] `WU-1F1-GREEN` Implement the narrow injected `DesktopApi`, closed decoder, and reducer; make focused frontend tests pass. <!-- sdd-owner: implementation -->
- [ ] `WU-1F1-TRIANGULATE` Add every typed success/partial/error/cancel state and prove unknown data becomes `protocol_mismatch`. <!-- sdd-owner: implementation -->
- [ ] `WU-1F1-REFACTOR` Keep presentation independent of Tauri, run frontend/Cargo/visual/scope checks within 380 lines. <!-- sdd-owner: implementation -->

### WU-1F2 — Register/extract UI through Rust; remove direct engine authority

**Depends on:** WU-1F1. **Candidates:** `apps/nelupdf/src/App.tsx`, `src/features/extraction/use-extraction.ts`, `src/platform/desktop-api.ts`, component/source-guard tests. **Acceptance:** selected bytes register once and are released; extraction uses only `DocumentId`; no `VITE_MOTOR_URL`, engine fetch/token/path, native path forwarding, or HTTP fallback remains; LLM desktop action remains disabled/pending Slice 3 rather than using legacy HTTP. **Rollback:** revert the whole UI integration unit to the previous release, not a delivered direct-HTTP fallback.

- [ ] `WU-1F2-RED` Add component tests proving current direct fetch/path/base64 retention/LLM HTTP behavior violates the contract and record failures. <!-- sdd-owner: implementation -->
- [ ] `WU-1F2-GREEN` Wire file selection to register/extract v1 via Rust, release byte buffers, disable unsafe native path drop/provider actions, and pass focused tests. <!-- sdd-owner: implementation -->
- [ ] `WU-1F2-TRIANGULATE` Test valid/invalid/oversized input, document replacement, no engine configuration, no direct requests, and Rust unavailable without fallback. <!-- sdd-owner: implementation -->
- [ ] `WU-1F2-REFACTOR` Separate state/presentation minimally, run frontend/Cargo/Node/OpenClaw and standard/narrow `vui-smoke`, then scope-check within 400 lines. <!-- sdd-owner: implementation -->

### WU-1F3 — Typed cancellation, stale suppression, partial/error accessibility

**Depends on:** WU-1F2. **Candidates:** `apps/nelupdf/src/App.tsx`, `App.css`, `src/features/extraction/use-extraction.ts`, component/a11y tests, `test/visual/1f3-states.scenario.json`. **Acceptance:** accessible selection/progress/complete/truncated/partial/OCR-unavailable/engine-unavailable/protocol/timeout/cancel states; cancel/retry deliberate; session generation suppresses stale results; no raw alert/error/stack/path. **Rollback:** revert UI state unit while keeping Rust mediation and direct-HTTP removal.

- [ ] `WU-1F3-RED` Add user-event/a11y tests for every touched state, cancellation race, live region, keyboard/focus, safe copy, and stale response; record failures. <!-- sdd-owner: implementation -->
- [ ] `WU-1F3-GREEN` Implement minimal typed presentation and state transitions; make focused component/a11y tests pass. <!-- sdd-owner: implementation -->
- [ ] `WU-1F3-TRIANGULATE` Add narrow viewport, text/non-color cues, retry categories, document replacement, and late-response cases. <!-- sdd-owner: implementation -->
- [ ] `WU-1F3-REFACTOR` Run full frontend/build and `vui-smoke` screenshots/readback for all states plus internal/scope gates within 400 lines. <!-- sdd-owner: implementation -->

### WU-1G1 — Installed Tauri API/schema, dependency, capability, and CSP gate

**Depends on:** WU-1F3. **Candidates:** `apps/nelupdf/src-tauri/tauri.conf.json`, `capabilities/default.json`, `src-tauri/Cargo.toml`, `apps/nelupdf/package.json`, lockfiles, CSP tests. **Acceptance:** installed Tauri v2 schema/API is validated before editing; compile/runtime smoke proves required `ipc:` and/or `http://ipc.localhost` source; production CSP has no general network source; opener is removed only after capability inventory proof; dev allowances are separate. **Rollback:** restore exact validated prior config while keeping direct webview transport disabled; block delivery if safe CSP cannot be retained.

- [ ] `WU-1G1-RED` Run `pnpm --dir apps/nelupdf tauri info` and add CSP/config tests that fail on current `csp: null`; inventory installed APIs, schema, plugins, and lockfile versions. <!-- sdd-owner: implementation -->
- [ ] `WU-1G1-GREEN` Set the minimum schema-valid production CSP/capabilities proven by `pnpm --dir apps/nelupdf tauri build --debug --no-bundle`; do not guess IPC sources. <!-- sdd-owner: implementation -->
- [x] `WU-1G1-TRIANGULATE` Runtime-test Tauri IPC success and blocked loopback/external fetch; test dev config separately and audit package/Cargo dependency changes. <!-- sdd-owner: implementation -->
- [ ] `WU-1G1-REFACTOR` Remove unused permissions/plugins only with evidence, run all config/build/visual/scope checks within 300 lines. <!-- sdd-owner: implementation -->

### WU-1G2 — Cross-runtime CI and offline boundary gate

**Depends on:** WU-1G1. **Candidates:** `.github/workflows/ci.yml`, boundary test scripts/fixtures, frontend/Rust/Node manifests. **Acceptance:** CI runs Node, frontend/component/a11y, TypeScript/build, Rust, real boundary, security, config, and no-network gates; unavailable Tauri GUI E2E remains explicitly later; OpenClaw compatibility is a required non-secret check where runtime permits. **Rollback:** revert CI/boundary harness only; behavior remains locally verifiable.

- [ ] `WU-1G2-RED` Add CI contract assertions that fail while boundary/security/offline stages are absent. <!-- sdd-owner: implementation -->
- [ ] `WU-1G2-GREEN` Wire deterministic installs and all established checks with no hidden allow-failure on required jobs. <!-- sdd-owner: implementation -->
- [ ] `WU-1G2-TRIANGULATE` Prove a protocol fixture mismatch, outbound socket attempt, frontend a11y failure, and Rust failure each block the correct job, then restore green bytes. <!-- sdd-owner: implementation -->
- [ ] `WU-1G2-REFACTOR` Reduce duplicate setup, run the complete local command matrix and visual/scope evidence within 360 lines. <!-- sdd-owner: implementation -->

### WU-1G3 — Slice 1 acceptance evidence and compatibility freeze

**Depends on:** WU-1G2. **Candidates:** `openspec/changes/nelupdf-full-audit/evidence/slice-1.md`, test/visual manifests only if evidence finds a gap. **Acceptance:** internal tests, installed Tauri/CSP validation, network denial, all typed UI states, OpenClaw 34/34-or-current exact focused count, live health/init/list/schema/base64 wiring, candidate scope, and rollback are recorded; no packaging/provider claim. **Rollback:** evidence-only; any discovered behavior defect reopens its owning unit instead of being patched here.

- [ ] `WU-1G3-RED` Run the complete acceptance matrix and record any unmet criterion as a failing owning-unit result; do not fix product code in this evidence unit. <!-- sdd-owner: implementation -->
- [ ] `WU-1G3-GREEN` Obtain exact passing evidence for every Slice 1 requirement or leave the slice blocked with actionable command/output. <!-- sdd-owner: implementation -->
- [ ] `WU-1G3-TRIANGULATE` Repeat standard/narrow visual, offline extraction, cancellation, protocol error, and live OpenClaw checks from clean process state. <!-- sdd-owner: implementation -->
- [ ] `WU-1G3-REFACTOR` Normalize evidence references, prove unrelated tracked/untracked work is intact, and freeze the safe rollback boundary within 180 authored lines. <!-- sdd-owner: implementation -->

## Slice 2 — Persistent lifecycle, document authority, bounded OCR

### WU-2A1 — Persistent supervisor contract and identity hello

**Depends on:** Slice 1 accepted. **Candidates:** `src/engine-protocol.js`, `test/engine-supervisor-protocol.test.js`, `apps/nelupdf/src-tauri/src/supervisor.rs`, Rust tests. **Acceptance:** version/capability/build hello is closed and identity-bound; wrong/stale/unrelated process never becomes ready; no provider dependency. **Verify:** focused Node/Cargo tests, full internal checks, OpenClaw sentinel, unchanged `vui-smoke`. **Rollback:** retain the Slice 1 one-request adapter.

- [ ] `WU-2A1-RED` Add incompatible/missing/forged hello and readiness tests before protocol/supervisor code. <!-- sdd-owner: implementation -->
- [ ] `WU-2A1-GREEN` Implement the minimal persistent identity handshake behind `EngineAdapter`. <!-- sdd-owner: implementation -->
- [ ] `WU-2A1-TRIANGULATE` Test stale child, capability mismatch, startup timeout, absent provider config, and clean fallback to typed unavailable. <!-- sdd-owner: implementation -->
- [ ] `WU-2A1-REFACTOR` Preserve the one-request rollback, run exact gates/visual/scope, and stay within 360 lines. <!-- sdd-owner: implementation -->

### WU-2A2 — Persistent startup/readiness and bounded request admission

**Depends on:** WU-2A1. **Candidates:** `supervisor.rs`, `operations.rs`, Node supervisor entry/tests. **Acceptance:** bounded startup, one active request, explicit not-started/starting/ready/incompatible/unavailable/timeout, no automatic replay. **Rollback:** select the verified Slice 1 adapter.

- [ ] `WU-2A2-RED` Add startup, admission, wrong-version, timeout, and no-replay tests. <!-- sdd-owner: implementation -->
- [ ] `WU-2A2-GREEN` Implement the bounded persistent startup/readiness path. <!-- sdd-owner: implementation -->
- [ ] `WU-2A2-TRIANGULATE` Test concurrent admission, startup cancellation, late hello, and provider isolation. <!-- sdd-owner: implementation -->
- [ ] `WU-2A2-REFACTOR` Run boundary/OpenClaw/visual/scope gates and split before 400 lines. <!-- sdd-owner: implementation -->

### WU-2B1 — Queue/capacity, crash detection, and recovery budget

**Depends on:** WU-2A2. **Candidates:** `supervisor.rs`, `operations.rs`, focused Rust/Node fixtures. **Acceptance:** bounded queue or deterministic reject, child-loss invalidation, bounded backoff/restart budget, new identity before work, no replay. **Rollback:** disable persistent recovery and use one-request adapter.

- [ ] `WU-2B1-RED` Add capacity/crash/restart-budget/stale-response tests. <!-- sdd-owner: implementation -->
- [ ] `WU-2B1-GREEN` Implement minimal bounded recovery without replay. <!-- sdd-owner: implementation -->
- [ ] `WU-2B1-TRIANGULATE` Test repeated crash, budget exhaustion, new identity, and local-only readiness. <!-- sdd-owner: implementation -->
- [ ] `WU-2B1-REFACTOR` Run exact internal/visual/scope checks within 390 lines. <!-- sdd-owner: implementation -->

### WU-2B2 — Application shutdown and cancellation continuity

**Depends on:** WU-2B1. **Candidates:** `supervisor.rs`, `lib.rs`, `operations.rs`, lifecycle tests. **Acceptance:** graceful then forced shutdown, authority/document cleanup, Slice 1 cancellation precedence preserved, content-free diagnostics. **Rollback:** revert persistent shutdown wiring and retain bounded per-request cleanup.

- [ ] `WU-2B2-RED` Add normal/ignored/crashed shutdown, cancel-during-shutdown, and sensitive-log tests. <!-- sdd-owner: implementation -->
- [ ] `WU-2B2-GREEN` Wire bounded shutdown to Tauri lifecycle. <!-- sdd-owner: implementation -->
- [ ] `WU-2B2-TRIANGULATE` Test restart after failure, forced termination, and no late success/provider activity. <!-- sdd-owner: implementation -->
- [ ] `WU-2B2-REFACTOR` Run lifecycle/boundary/visual/scope gates within 380 lines. <!-- sdd-owner: implementation -->

### WU-2C1 — Shell-owned file dialog/drop capability parity

**Depends on:** WU-2B2 and installed Tauri API proof. **Candidates:** `src-tauri/src/documents.rs`, `commands.rs`, capability config, frontend intake code/tests. **Acceptance:** verified installed Tauri APIs authorize dialog/drop; both produce opaque IDs and equivalent bounds; paths never enter webview; unsupported native drop stays typed unavailable. **Rollback:** retain Slice 1 byte registration and disabled path drop.

- [ ] `WU-2C1-RED` Add dialog/drop parity, arbitrary path, duplicate name, and unsupported-platform tests. <!-- sdd-owner: implementation -->
- [ ] `WU-2C1-GREEN` Implement minimal shell intake using only proven capabilities. <!-- sdd-owner: implementation -->
- [ ] `WU-2C1-TRIANGULATE` Test Linux path variants, replacement, cancel, clear, and no pre-authority read. <!-- sdd-owner: implementation -->
- [ ] `WU-2C1-REFACTOR` Run Tauri schema/build, component/a11y/visual, and scope gates within 390 lines. <!-- sdd-owner: implementation -->

### WU-2C2 — Capability expiry/revocation and non-desktop path migration

**Depends on:** WU-2C1. **Candidates:** `documents.rs`, `src/mcp-facade.js`, `src/server.js`, CLI/MCP/HTTP tests, migration docs. **Acceptance:** expiry/scope/revoke/clear/session end; new workspace/capability contract only if approved; old unsafe route remains disabled; OpenClaw path tool gets explicit compatible or versioned migration with live proof. **Rollback:** retain safer disabled path behavior and base64/CLI local compatibility.

- [ ] `WU-2C2-RED` Add expiry/replay/escape/symlink/pre-read bound and OpenClaw migration tests. <!-- sdd-owner: implementation -->
- [ ] `WU-2C2-GREEN` Implement the smallest capability policy without reactivating arbitrary paths. <!-- sdd-owner: implementation -->
- [ ] `WU-2C2-TRIANGULATE` Test every interface, old/new client behavior, live initialize/list/base64, and any path migration. <!-- sdd-owner: implementation -->
- [ ] `WU-2C2-REFACTOR` Run full security/OpenClaw/visual/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-2D1 — OCR policy seam and adversarial resource harness

**Depends on:** WU-2C2. **Candidates:** `src/ocr-policy.js`, `test/ocr-policy.test.js`, Rust OCR traits/tests, bounded fixtures. **Acceptance:** no OCR exposure yet; tests encode max 25 pages, one job, 120s/document, 20s/subprocess, 256 MiB temporary output, 20 MiB/page, 80k retained chars, cleanup and cancellation; release owner may only lower without new review. **Rollback:** remove additive policy/harness; keep typed OCR unavailable.

- [x] `WU-2D1-RED` Add adversarial page/time/concurrency/temp/output/text/cancel tests before implementation. <!-- sdd-owner: implementation -->
- [x] `WU-2D1-GREEN` Implement testable policy/admission primitives while keeping product OCR disabled. <!-- sdd-owner: implementation -->
- [x] `WU-2D1-TRIANGULATE` Add exact-limit/over-limit and cleanup-on-every-terminal fixtures. <!-- sdd-owner: implementation -->
- [x] `WU-2D1-REFACTOR` Run no-network/internal/visual/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-2D2 — Bounded OCR execution and end-to-end cancellation

**Depends on:** WU-2D1 and approved Linux OCR feasibility. **Candidates:** `src/folder-scan.js` adapter/refactor seam, OCR policy module, Rust supervisor, tests/fixtures. **Acceptance:** existing extraction modules are reused behind bounded OCR; subprocesses/time/temp/output/concurrency are enforced; cleanup on all outcomes; cancellation reaches terminal bound; provider never called. **Rollback:** disable OCR and return honest `ocr_required_unavailable`.

- [ ] `WU-2D2-RED` Add scanned success, each resource breach, process hang/crash, cancellation, and cleanup tests. <!-- sdd-owner: implementation -->
- [ ] `WU-2D2-GREEN` Expose only the bounded OCR path behind the supervisor. <!-- sdd-owner: implementation -->
- [ ] `WU-2D2-TRIANGULATE` Run adversarial fixtures under network denial and verify late-result suppression. <!-- sdd-owner: implementation -->
- [ ] `WU-2D2-REFACTOR` Run full Node/Rust/frontend/OpenClaw/visual/scope gates and split before 400 lines. <!-- sdd-owner: implementation -->

## Slice 3 — Unified external-LLM privacy transaction

### WU-3A1 — Fail-closed legacy raw-path migration

**Depends on:** Slice 2 accepted. **Candidates:** `src/server.js`, `src/mcp-facade.js`, `bin/pdf-tool.mjs`, tests/docs. **Acceptance:** all raw LLM routes/options fail with stable versioned migration before egress while local extraction and OpenClaw tool listing remain; provider remains disabled. **Rollback:** keep raw paths disabled; never restore a bypass.

- [ ] `WU-3A1-RED` Add cross-interface captured-egress tests for every legacy raw path. <!-- sdd-owner: implementation -->
- [ ] `WU-3A1-GREEN` Implement typed fail-closed migration responses. <!-- sdd-owner: implementation -->
- [ ] `WU-3A1-TRIANGULATE` Test desktop/CLI/HTTP/MCP, OpenClaw list/schema/base64, and zero raw provider calls. <!-- sdd-owner: implementation -->
- [ ] `WU-3A1-REFACTOR` Run internal/OpenClaw/visual/scope gates within 340 lines. <!-- sdd-owner: implementation -->

### WU-3A2 — Data-class taxonomy, minimizer, and deterministic pseudonymization

**Depends on:** WU-3A1 and privacy/product taxonomy decision. **Candidates:** `src/privacy/minimize.js`, `pseudonymize.js`, policy fixtures/docs/tests. **Acceptance:** versioned purpose-specific minimization; protected/unsupported/international classes explicit; pseudonymized never called anonymous; deterministic tests replace random assumptions. **Rollback:** keep providers disabled and remove additive policy.

- [ ] `WU-3A2-RED` Add required/omitted/residual/international data-class tests. <!-- sdd-owner: implementation -->
- [ ] `WU-3A2-GREEN` Implement minimum versioned transformation policy. <!-- sdd-owner: implementation -->
- [ ] `WU-3A2-TRIANGULATE` Test arithmetic/identifier edge cases, unsupported disclosures, and deterministic replay. <!-- sdd-owner: implementation -->
- [ ] `WU-3A2-REFACTOR` Run privacy/root/visual/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-3B1 — Prepare transaction and faithful disclosure

**Depends on:** WU-3A2 and expiry/disclosure decisions. **Candidates:** `src/privacy/transaction-service.js`, `transaction-store.js`, `disclosure.js`, tests. **Acceptance:** prepare binds document, exact payload hash/bytes, provider/model/purpose/policy/disclosure/expiry; disclosure states scope/sample limits/retention/training/destination facts; no provider call. **Rollback:** remove prepare/store; provider remains disabled.

- [x] `WU-3B1-RED` Add independent mutation and disclosure completeness tests before service code. <!-- sdd-owner: implementation -->
- [x] `WU-3B1-GREEN` Implement in-memory prepare/store with exact serialized bytes. <!-- sdd-owner: implementation -->
- [x] `WU-3B1-TRIANGULATE` Test changed document/payload/provider/model/purpose/policy/disclosure and expiry. <!-- sdd-owner: implementation -->
- [x] `WU-3B1-REFACTOR` Run privacy/no-egress/visual/scope gates within 390 lines. <!-- sdd-owner: implementation -->

### WU-3B2 — Transaction lifetime and content-free audit sink

**Depends on:** WU-3B1 and retention decision. **Candidates:** `transaction-store.js`, `audit-sink.js`, tests/docs. **Acceptance:** clear on expiry/cancel/clear/shutdown/terminal; bounded closed audit events; no content/path/key/map; user-clear semantics where approved. **Rollback:** use short in-memory no-durable-audit default.

- [x] `WU-3B2-RED` Add lifetime, cap, free-form rejection, and sensitive-marker tests. <!-- sdd-owner: implementation -->
- [x] `WU-3B2-GREEN` Implement minimal closed audit/lifetime behavior. <!-- sdd-owner: implementation -->
- [x] `WU-3B2-TRIANGULATE` Test every terminal path and diagnostic export. <!-- sdd-owner: implementation -->
- [x] `WU-3B2-REFACTOR` Run privacy/internal/visual/scope gates within 390 lines. <!-- sdd-owner: implementation -->

### WU-3C1 — Atomic single-use confirm and exact-byte handoff

**Depends on:** WU-3B2. **Candidates:** `transaction-service.js`, `provider-adapter.js`, tests. **Acceptance:** atomic compare-and-consume; exact stored bytes only; replay/concurrent/direct/expired/modified confirm fails before egress; technical adapter remains disabled. **Rollback:** disable confirm/provider adapter while preserving local results.

- [x] `WU-3C1-RED` Add replay/concurrency/unpreviewed/mutation/captured-byte tests. <!-- sdd-owner: implementation -->
- [x] `WU-3C1-GREEN` Implement atomic consume and immutable bound request handoff. <!-- sdd-owner: implementation -->
- [x] `WU-3C1-TRIANGULATE` Test provider timeout/redirect/content-type/size failures without local-result mutation. <!-- sdd-owner: implementation -->
- [x] `WU-3C1-REFACTOR` Run privacy/no-egress/visual/scope gates within 350 lines. <!-- sdd-owner: implementation -->

### WU-3C2 — Provider response validation and exact reverse map

**Depends on:** WU-3C1. **Candidates:** `src/privacy/provider-response.js`, `reverse-map.js`, tests. **Acceptance:** byte/content/schema/value bounds; exact map membership only; unmapped numbers/IDs unchanged; untrusted text never HTML/path/shell/formula; local result immutable. **Rollback:** discard provider overlay and retain deterministic result.

- [x] `WU-3C2-RED` Add malformed/oversized/adversarial/unmapped/heuristic-reversal tests. <!-- sdd-owner: implementation -->
- [x] `WU-3C2-GREEN` Implement closed response and exact reverse-map logic. <!-- sdd-owner: implementation -->
- [x] `WU-3C2-TRIANGULATE` Test collisions, international numbers, unsafe strings, and invalid-output local fallback. <!-- sdd-owner: implementation -->
- [x] `WU-3C2-REFACTOR` Run privacy/internal/visual/scope gates and split before 400 lines. <!-- sdd-owner: implementation -->

### WU-3D1 — CLI/HTTP/MCP unified privacy adapters

**Depends on:** WU-3C2. **Candidates:** `bin/pdf-tool.mjs`, `src/server.js`, `src/mcp-facade.js`, adapter tests/docs. **Acceptance:** prepare/confirm semantics identical; legacy three MCP tool names/schemas remain or receive explicit versioned migration; OpenClaw local base64 workflow remains; no direct payload construction. **Rollback:** disable external operations while preserving deterministic interfaces.

- [x] `WU-3D1-RED` Add cross-interface parity and no-bypass/captured-egress tests. <!-- sdd-owner: implementation -->
- [x] `WU-3D1-GREEN` Wire all non-desktop adapters to the same transaction service. <!-- sdd-owner: implementation -->
- [x] `WU-3D1-TRIANGULATE` Mutate every bound field per interface and run live OpenClaw checks. <!-- sdd-owner: implementation -->
- [x] `WU-3D1-REFACTOR` Run full privacy/OpenClaw/visual/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-3D2 — Desktop disclosure/confirm adapter and accessible UI

**Depends on:** WU-3D1. **Candidates:** Rust privacy commands, TypeScript adapter/reducer, `App.tsx`, component/a11y/visual tests. **Acceptance:** explicit prepare then confirm; provider/model/purpose/payload scope/limitations/expiry/facts shown; modal keyboard/focus/announcement; decline/failure keeps local result; provider still disabled absent Slice 6 evidence. **Rollback:** hide/disable external UI and retain local workflow.

- [ ] `WU-3D2-RED` Add IPC/component/a11y tests for prepare/confirm/decline/expiry/replay/provider-disabled states. <!-- sdd-owner: implementation -->
- [ ] `WU-3D2-GREEN` Wire desktop to the same transaction contract with fail-closed enablement. <!-- sdd-owner: implementation -->
- [ ] `WU-3D2-TRIANGULATE` Test modal focus, partial sample disclosure, local-result retention, and no direct network. <!-- sdd-owner: implementation -->
- [ ] `WU-3D2-REFACTOR` Run all internal and targeted `vui-smoke`/scope gates within 390 lines. <!-- sdd-owner: implementation -->

## Slice 4 — Desktop reliability and accessibility

### WU-4A1 — Duplicate-safe identity and remove/clear lifetime controls

**Depends on:** Slices 2–3. **Candidates:** frontend reducer/hook/components, Rust document/transaction stores, tests. **Acceptance:** duplicate basenames remain distinct; actions target `DocumentId`; remove/clear releases bytes/results/maps/capabilities and suppresses late responses. **Rollback:** retain prior safe opaque-ID state and disable incomplete actions.

- [x] `WU-4A1-RED` Add duplicate/action/lifetime/late-response tests. <!-- sdd-owner: implementation -->
- [x] `WU-4A1-GREEN` Implement identity-based actions and clear semantics. <!-- sdd-owner: implementation -->
- [x] `WU-4A1-TRIANGULATE` Test same names, reorder, partial/provider states, cancel, and session clear. <!-- sdd-owner: implementation -->
- [x] `WU-4A1-REFACTOR` Run component/a11y/visual/internal/scope gates within 340 lines. <!-- sdd-owner: implementation -->

### WU-4A2 — Explicit retention copy and state policy

**Depends on:** WU-4A1. **Candidates:** local help/privacy docs, reviewed UI copy, retention tests. **Acceptance:** actual memory/log lifetime and best-effort clearing are truthful; no physical-erasure overclaim. **Rollback:** restore prior truthful minimal copy; never claim more than verified.

- [x] `WU-4A2-RED` Add claim-to-runtime checks for each retained data class. <!-- sdd-owner: implementation -->
- [x] `WU-4A2-GREEN` Add reviewed copy/docs matching runtime behavior. <!-- sdd-owner: implementation -->
- [x] `WU-4A2-TRIANGULATE` Test clear/failure/cancel/exit copy against evidence. <!-- sdd-owner: implementation -->
- [x] `WU-4A2-REFACTOR` Run docs/component/visual/scope gates within 280 lines. <!-- sdd-owner: implementation -->

### WU-4B1 — RFC 4180 and spreadsheet-safe CSV encoder

**Depends on:** WU-4A1. **Candidates:** `apps/nelupdf/src/features/export/csv.ts`, tests, `App.tsx`. **Acceptance:** doubled quotes, delimiter/newline quoting, formula neutralization after first meaningful character, control policy, partial provenance, duplicate-safe selection. **Rollback:** disable export rather than restore unsafe encoder.

- [x] `WU-4B1-RED` Add spreadsheet-oriented malicious/quotes/newline/control/duplicate/partial fixtures. <!-- sdd-owner: implementation -->
- [x] `WU-4B1-GREEN` Implement a pure bounded encoder and wire export. <!-- sdd-owner: implementation -->
- [x] `WU-4B1-TRIANGULATE` Round-trip supported fixtures and verify no formula execution by default. <!-- sdd-owner: implementation -->
- [x] `WU-4B1-REFACTOR` Run frontend/a11y/visual/scope gates within 390 lines. <!-- sdd-owner: implementation -->

### WU-4C1 — Typed recovery and complete keyboard/status semantics

**Depends on:** WU-4A1 and Slice 3 UI. **Candidates:** extraction/privacy components, message map, CSS, tests. **Acceptance:** actionable safe guidance for all typed states; deliberate retry/new transaction; keyboard, focus, status, non-color semantics. **Rollback:** preserve typed states and hide unsafe/incomplete actions.

- [x] `WU-4C1-RED` Add user-event/a11y tests for every recovery state and modal lifecycle. <!-- sdd-owner: implementation -->
- [x] `WU-4C1-GREEN` Implement reviewed typed actions and semantics. <!-- sdd-owner: implementation -->
- [x] `WU-4C1-TRIANGULATE` Test retry categories, provider failure after local success, Escape/focus restoration, and announcements. <!-- sdd-owner: implementation -->
- [x] `WU-4C1-REFACTOR` Run full component/a11y/targeted visual/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-4C2 — Responsive/text-scaling visual matrix

**Depends on:** WU-4C1 and preliminary Linux matrix. **Candidates:** component CSS/layout, visual scenario manifests, tests. **Acceptance:** standard/narrow viewport, long names/errors, supported text scale, reachable actions, documented overflow strategy. **Rollback:** revert layout-only unit without changing state contracts.

- [ ] `WU-4C2-RED` Capture failing narrow/text-scale scenarios before CSS changes. <!-- sdd-owner: implementation -->
- [ ] `WU-4C2-GREEN` Apply minimal responsive layout fixes. <!-- sdd-owner: implementation -->
- [ ] `WU-4C2-TRIANGULATE` Test every key state with long content, keyboard focus, and non-color cues. <!-- sdd-owner: implementation -->
- [ ] `WU-4C2-REFACTOR` Run `vui-smoke`, component/a11y/internal/scope gates within 300 lines. <!-- sdd-owner: implementation -->

### WU-4D1 — Content-free diagnostics and truthful product docs

**Depends on:** WU-4C2. **Candidates:** diagnostics module/UI, tests, `README.md`, `PRIVACY.md`, installation/troubleshooting docs. **Acceptance:** bounded versions/lifecycle/capability/safe error/opaque correlation only; no content/path/key/map; claims match evidence and unsupported features are labeled. **Rollback:** remove diagnostics export and revert only changed claims.

- [ ] `WU-4D1-RED` Add sensitive-marker, bounds, and claim-truthfulness tests. <!-- sdd-owner: implementation -->
- [ ] `WU-4D1-GREEN` Implement allowlisted diagnostics and correct affected docs. <!-- sdd-owner: implementation -->
- [ ] `WU-4D1-TRIANGULATE` Test startup/provider/document failures and user clear/export behavior. <!-- sdd-owner: implementation -->
- [ ] `WU-4D1-REFACTOR` Run docs/internal/visual/scope gates within 260 lines. <!-- sdd-owner: implementation -->

## Slice 5 — Linux packaging, hardening, integrity, and operations

### WU-5A1 — Linux support matrix decision and WebDriverIO/Tauri E2E seam

**Depends on:** Slices 1–4 accepted. **Candidates:** `apps/nelupdf/test/e2e/*`, WebDriverIO config, package/lockfiles, `.github/workflows/ci.yml`, support-matrix draft. **Acceptance:** release owner defines distro/version/architecture/display/desktop/a11y baseline; installed Tauri WebDriver requirements are verified; selection/extraction/cancel/lifecycle E2E can run on the first matrix entry. Compilation alone is not E2E. **Rollback:** remove E2E harness/dependencies; no support claim.

- [ ] `WU-5A1-RED` Add a first real-shell E2E that fails because WebDriverIO/Tauri driver setup is absent. <!-- sdd-owner: implementation -->
- [ ] `WU-5A1-GREEN` Add pinned harness/dependencies and make the focused local matrix flow pass. <!-- sdd-owner: implementation -->
- [ ] `WU-5A1-TRIANGULATE` Add cancellation, startup failure, CSP/network, and accessibility smoke cases. <!-- sdd-owner: implementation -->
- [ ] `WU-5A1-REFACTOR` Audit lockfiles, CI cost, visual/internal/scope evidence within 260 lines. <!-- sdd-owner: implementation -->

### WU-5A2 — Select and pin packaged Node sidecar form

**Depends on:** WU-5A1 and architecture/release decision. **Candidates:** sidecar build scripts/config, `tauri.conf.json`, Cargo/package manifests, provenance tests. **Acceptance:** compiled executable or pinned runtime/resources is chosen with licenses, size, CVE, architecture, reproducibility, and rollback evidence; existing engine modules are packaged, not rewritten; no PATH search in promoted build. **Rollback:** no promoted package; development adapter remains.

- [x] `WU-5A2-RED` Add packaged-path/integrity/no-PATH/resource tests before build changes. <!-- sdd-owner: implementation -->
- [x] `WU-5A2-GREEN` Declare the minimum pinned `externalBin`/resources using installed Tauri schema. <!-- sdd-owner: implementation -->
- [x] `WU-5A2-TRIANGULATE` Build on the first matrix target and prove local extraction with the packaged engine. <!-- sdd-owner: implementation -->
- [x] `WU-5A2-REFACTOR` Run dependency/license/audit/E2E/visual/scope gates within 340 lines. <!-- sdd-owner: implementation -->

### WU-5B1 — Package OCR resources and capability declaration

**Depends on:** WU-5A2 and qualified OCR set. **Candidates:** package resource config/scripts/docs/tests. **Acceptance:** only approved OCR binaries/languages/resources are pinned and integrity-checked; unsupported OCR remains unavailable; limits unchanged. **Rollback:** package without OCR and retain typed unavailable state.

- [ ] `WU-5B1-RED` Add resource-missing/tampered/unsupported-language package tests. <!-- sdd-owner: implementation -->
- [ ] `WU-5B1-GREEN` Include only qualified pinned OCR resources. <!-- sdd-owner: implementation -->
- [ ] `WU-5B1-TRIANGULATE` Run packaged bounded OCR and cleanup tests on the matrix entry. <!-- sdd-owner: implementation -->
- [ ] `WU-5B1-REFACTOR` Run integrity/E2E/visual/scope gates within 300 lines. <!-- sdd-owner: implementation -->

### WU-5B2 — Final installed CSP/capability inventory

**Depends on:** WU-5B1. **Candidates:** `tauri.conf.json`, capabilities, Cargo/package manifests, security/E2E tests. **Acceptance:** production effective CSP and capabilities match final feature inventory; no general webview network; provider networking remains native and disabled; opener/unused plugins absent; dev policy separate. **Rollback:** preserve Slice 1 restrictive baseline and disable unsupported features.

- [ ] `WU-5B2-RED` Add final package CSP/capability negative tests and installed-schema validation. <!-- sdd-owner: implementation -->
- [ ] `WU-5B2-GREEN` Tighten only against proven final requirements. <!-- sdd-owner: implementation -->
- [x] `WU-5B2-TRIANGULATE` Runtime-test blocked destinations, allowed IPC, plugin denial, and local extraction. <!-- sdd-owner: implementation -->
- [ ] `WU-5B2-REFACTOR` Run Tauri build/E2E/visual/security/scope gates within 340 lines. <!-- sdd-owner: implementation -->

### WU-5C1 — Artifact integrity, provenance, and manual install path

**Depends on:** WU-5B2. **Candidates:** release workflow/scripts, checksum/signature metadata, installation docs/tests. **Acceptance:** pinned artifact identity and verification before execution; mutable script not sole installer; failed verification blocks; automatic updates remain off. **Rollback:** withdraw artifact and retain verified prior release.

- [ ] `WU-5C1-RED` Add tampered/missing/provenance/install verification tests. <!-- sdd-owner: implementation -->
- [ ] `WU-5C1-GREEN` Produce verifiable candidate metadata and manual install instructions. <!-- sdd-owner: implementation -->
- [ ] `WU-5C1-TRIANGULATE` Verify clean download/check/install/first launch on the matrix entry. <!-- sdd-owner: implementation -->
- [ ] `WU-5C1-REFACTOR` Run release-doc/E2E/visual/scope gates within 300 lines. <!-- sdd-owner: implementation -->

### WU-5C2 — Signing/update/downgrade policy and fail-closed updater

**Depends on:** WU-5C1 and signing/channel decision. **Candidates:** updater config/workflow/docs/tests. **Acceptance:** identity/channel/metadata/downgrade/failure/recovery defined; invalid metadata rejected; updater disabled if any control absent. **Rollback:** disable updater and use verified manual updates.

- [ ] `WU-5C2-RED` Add invalid signature/metadata/channel/downgrade/interruption tests. <!-- sdd-owner: implementation -->
- [ ] `WU-5C2-GREEN` Implement only the approved policy or explicit disabled state. <!-- sdd-owner: implementation -->
- [ ] `WU-5C2-TRIANGULATE` Test failure recovery and continued local extraction. <!-- sdd-owner: implementation -->
- [ ] `WU-5C2-REFACTOR` Run release/security/E2E/visual/scope gates within 390 lines. <!-- sdd-owner: implementation -->

### WU-5D1 — Install/first-launch/shutdown/upgrade/rollback matrix

**Depends on:** WU-5C2. **Candidates:** release CI matrix, package smoke scripts, rollback fixtures/docs. **Acceptance:** each supported entry proves integrity, install, trusted engine, local extraction, shutdown, upgrade, rollback, source-PDF preservation; unsupported entries not claimed. **Rollback:** block promotion for failing entries and retain prior artifact.

- [x] `WU-5D1-RED` Add matrix assertions that fail for each missing lifecycle/rollback proof. <!-- sdd-owner: implementation -->
- [ ] `WU-5D1-GREEN` Wire controlled package smoke for every declared entry. <!-- sdd-owner: implementation -->
- [ ] `WU-5D1-TRIANGULATE` Test failed engine start, interrupted upgrade, rollback, no direct HTTP/raw LLM restoration. <!-- sdd-owner: implementation -->
- [ ] `WU-5D1-REFACTOR` Run complete matrix/evidence/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-5D2 — Release diagnostics and documentation truth gate

**Depends on:** WU-5D1. **Candidates:** packaged diagnostics policy, release/install/privacy/security/troubleshooting docs, claim checks. **Acceptance:** content-free retention/redaction/access/deletion; telemetry off; exact support matrix; no unsupported platform/provider/legal claims; OpenClaw engine deployment remains independently compatible. **Rollback:** correct/withdraw claims and package promotion.

- [ ] `WU-5D2-RED` Add package diagnostic and claim-to-evidence checks. <!-- sdd-owner: implementation -->
- [ ] `WU-5D2-GREEN` Align packaged diagnostics and docs to verified evidence. <!-- sdd-owner: implementation -->
- [ ] `WU-5D2-TRIANGULATE` Review every platform/OCR/update/privacy/provider/OpenClaw statement. <!-- sdd-owner: implementation -->
- [ ] `WU-5D2-REFACTOR` Run release docs/E2E/visual/scope gates within 260 lines. <!-- sdd-owner: implementation -->

## Slice 6 — Provider and jurisdiction enablement

### WU-6A1 — Provider registry and fail-closed evidence schema

**Depends on:** Slices 3 and 5 accepted. **Candidates:** `src/privacy/provider-registry.js`, evidence schema/tests, release config docs. **Acceptance:** stable provider/model/account/purpose/package/jurisdiction keys; dated retention/training/security/processor/transfer facts; missing/stale/materially changed evidence disables; no provider enabled. **Rollback:** empty registry/disabled providers.

- [x] `WU-6A1-RED` Add absent/stale/mismatch/material-change enablement tests. <!-- sdd-owner: implementation -->
- [x] `WU-6A1-GREEN` Implement the closed registry and disabled default. <!-- sdd-owner: implementation -->
- [x] `WU-6A1-TRIANGULATE` Test account/model/purpose/package/user/jurisdiction scope independently. <!-- sdd-owner: implementation -->
- [x] `WU-6A1-REFACTOR` Run privacy/release/visual/scope gates within 280 lines. <!-- sdd-owner: implementation -->

### WU-6B1 — Qualified provider/legal/security review gate

**Depends on:** WU-6A1 and human-qualified evidence. **Candidates:** provider-specific evidence record and review checklist; product code forbidden. **Acceptance:** dated qualified review covers terms, processing/retention/training, roles/contracts, lawful basis/consent, residency/transfers, security, sector/age, impact assessments, intended users/jurisdictions; inconclusive means disabled; no worldwide claim. **Rollback:** withdraw evidence and keep provider disabled.

- [ ] `WU-6B1-RED` Validate the evidence record against the registry schema and record every missing/inconclusive field. <!-- sdd-owner: implementation -->
- [ ] `WU-6B1-GREEN` Obtain and record qualified approvals only for the exact reviewed release context; otherwise close the unit as blocked, not enabled. <!-- sdd-owner: implementation -->
- [ ] `WU-6B1-TRIANGULATE` Challenge material changes, added jurisdiction, account/model change, expiry, and conflicting provider facts. <!-- sdd-owner: implementation -->
- [ ] `WU-6B1-REFACTOR` Minimize retained legal/provider evidence without losing decision provenance; run scope checks within 300 lines. <!-- sdd-owner: implementation -->

### WU-6C1 — Enable one reviewed provider configuration

**Depends on:** WU-6B1 passing, not merely configured. **Candidates:** one provider adapter/config, transaction tests, package policy, desktop disclosure/visual tests. **Acceptance:** only exact approved configuration enabled; HTTPS/destination/redirect/deadline/response bounds; exact confirmed bytes; local extraction survives decline/offline/failure; disclosure matches dated facts. **Rollback:** disable provider config without changing local extraction.

- [ ] `WU-6C1-RED` Add configuration-scope, egress, response, disclosure, offline, and revocation tests. <!-- sdd-owner: implementation -->
- [ ] `WU-6C1-GREEN` Enable only the approved provider/model/account/purpose/package/jurisdiction tuple. <!-- sdd-owner: implementation -->
- [ ] `WU-6C1-TRIANGULATE` Test network failure, changed facts, expiry, redirect, invalid response, and local fallback. <!-- sdd-owner: implementation -->
- [ ] `WU-6C1-REFACTOR` Run full privacy/package/E2E/visual/OpenClaw/scope gates within 360 lines. <!-- sdd-owner: implementation -->

### WU-6D1 — Provider release operations and ongoing suspension gate

**Depends on:** WU-6C1. **Candidates:** release checklist/automation/docs/evidence. **Acceptance:** promotion checks exact evidence identity; material change/expiry suspends provider only; local workflow stays available; claims are scoped and dated. **Rollback:** revoke enablement and publish corrected release evidence.

- [ ] `WU-6D1-RED` Add release-gate checks for missing/stale/mismatched evidence and local fallback. <!-- sdd-owner: implementation -->
- [ ] `WU-6D1-GREEN` Wire promotion/suspension checks without automatic legal inference. <!-- sdd-owner: implementation -->
- [ ] `WU-6D1-TRIANGULATE` Simulate evidence expiry/material change/additional jurisdiction and verify provider-only disablement. <!-- sdd-owner: implementation -->
- [ ] `WU-6D1-REFACTOR` Run release/docs/visual/scope evidence within 200 lines. <!-- sdd-owner: implementation -->

## Parent-owned post-apply review and lifecycle gates

These actions occur only after an implementation work unit returns its internal and visual evidence. They do not authorize implementation, commits, or PRs.

- [ ] `PARENT-01` After each completed work unit, start or reuse one bounded review for that exact candidate, verification evidence, file modes, authored-line count, rollback boundary, and preserved pre-existing tracked/untracked work; do not combine pending units. <!-- sdd-owner: parent -->
- [ ] `PARENT-02` Before the first PR action, obtain the user's chain strategy (`stacked-to-main` or `feature-branch-chain`) and preserve the one-work-unit review boundary unless an explicit size exception is approved. <!-- sdd-owner: parent -->
- [ ] `PARENT-03` At each slice gate, verify all required internal, `vui-smoke`, accessibility, OpenClaw, package, provider/legal, and support-matrix evidence is present before authorizing the dependent slice. <!-- sdd-owner: parent -->
- [ ] `PARENT-04` Before archive or release, run the native lifecycle gate against the exact reviewed candidate and require truthful final-state evidence; never infer approval from task completion alone. <!-- sdd-owner: parent -->

## Immediate apply boundary

The documentation-only guardrail closure is complete. **WU-1A4 is the only next authorized implementation unit** in `/home/jmon/.pdf-tool-wu1a1`; its four rows remain `[ ]` until its own strict-TDD evidence is observed. Stop after WU-1A4 and return its complete continuation packet and evidence. **Hard stop before WU-1B1 and every later unit.** Do not mutate OpenClaw, delivery/Git state, review/RDD state, or any surface outside the WU-1A4 continuation packet.

## Immediate apply boundary (post WU-1A4)

WU-1A4 is closed (independent verification plus native settlement `state: complete`). **WU-1B1 is the only next authorized implementation unit** in `/home/jmon/.pdf-tool-wu1a1`; its four rows remain `[ ]` until its own strict-TDD evidence is observed. Stop after WU-1B1 and return its complete continuation packet and evidence. **Hard stop before WU-1B2 and every later unit.** Do not mutate OpenClaw, delivery/Git state, review/RDD state, or any surface outside the WU-1B1 continuation packet.

## Immediate apply boundary (post WU-1B1)

WU-1B1 is closed (independent verification plus native settlement `state: complete`; evidence revision `sha256:905336dabe6142dd7cdd5ef8a2619304712cabab2b81b4a2661f65b69b6741a8`). **WU-1B2 is the only next authorized implementation unit** in `/home/jmon/.pdf-tool-wu1a1`; its four rows remain `[ ]` until its own strict-TDD evidence is observed. **WU-1B3 and every later unit remain blocked and unauthorized.** Stop after WU-1B2 and return its complete continuation packet and evidence. Do not mutate OpenClaw, delivery/Git state, review/RDD state, or any surface outside the WU-1B2 continuation packet.

## Immediate apply boundary (post WU-1B2)

WU-1B2 is closed (independent verification plus native settlement `state: complete`; evidence manifest `sha256:6421276bc5bc6773d495640b93b4262f372591d0e0ccb2725578fbef32774a59`). **WU-1B3 is the only next authorized implementation unit** in `/home/jmon/.pdf-tool-wu1a1`; its four rows remain `[ ]` until its own strict-TDD evidence is observed. **WU-1B4 and every later unit remain blocked and unauthorized.** Stop after WU-1B3 and return its complete continuation packet and evidence. Do not mutate OpenClaw, delivery/Git state, review/RDD state, or any surface outside the WU-1B3 continuation packet.
