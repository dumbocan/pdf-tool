# Apply Progress — PDF Tool v0.2 Architecture (PR 1: Work Units 1–6 + PR 2: Work Unit 7)

Change: `pdf-tool-v0-2-architecture` — Repo: `/home/jmon/pdf-tool` — Store: hybrid (openspec + Engram topic `sdd/pdf-tool-v0-2-architecture/apply-progress`, project `pdf-tool`)

## Structured status consumed

```yaml
schemaName: spec-driven
changeName: pdf-tool-v0-2-architecture
artifactStore: both            # openspec/ exists → authoritative (no resolve-via-engram)
artifacts: { proposal: done, specs: done, design: done, tasks: done, applyProgress: missing (first batch) }
applyState: ready
dependencies: { apply: ready }
actionContext:
  mode: repo-local
  workspaceRoot: /home/jmon/pdf-tool
  allowedEditRoots: [/home/jmon/pdf-tool]   # parent-delegated apply with explicit file targets
  warnings: []
nextRecommended: apply (PR 1 slice = Work Units 1–6; PR 2 = Work Unit 7, parent-owned)
```

Delivery decision (from parent, resolving the Review Workload Gate `Decision needed before apply: Yes` / `Chained PRs recommended: Yes` / `400-line budget risk: High`): **ask-on-risk resolved → split in 2 PRs**. PR 1 = Work Units 1–6 (contract code + tests). PR 2 = Work Unit 7 (docs/ops) — NOT touched here.

## Work Unit 1 — Baseline (read-only)

- `node --test test/*.test.js` → **57/57 pass, 0 fail** (recorded before any edit).
- `npm audit --omit=dev` → **found 0 vulnerabilities**, exit 0.

## Work Unit 2 — Truncation metadata (strict TDD: RED → GREEN → TRIANGULATE → REFACTOR)

- **RED** (before impl): added 6 tests to `test/server.test.js` (exact envelope shape; reason variants `maxChars`/`maxPages`/`maxPagesAndMaxChars` from stub `truncationReason`; `truncated:false` → key absent; stateless key check). Run: **5 of 6 new tests fail** (`truncation` field missing; the `truncated:false` absence test passed trivially). Baseline 57 unaffected.
- **GREEN** (minimal change): `src/extract.js` now tracks `pageLimitHit` (`declaredPages > pagesToRead`) and `charLimitHit` (per-page slice, char exhaustion, final `truncate()`) and returns `truncationReason` (`maxPages`|`maxChars`|`maxPagesAndMaxChars`|`null`) + `applied: { maxPages, maxChars }`; unreadable-page skips are best-effort continuation and no longer set `truncated` alone (prescribed decision; **no existing test pinned skip-only `truncated: true`** — verified by grep before changing). `src/server.js` builds the `truncation` object in `normalizeResult` with `allowed` from `HARD_MAX_PAGES`/`HARD_MAX_CHARS` and applied fallback to `DEFAULT_MAX_PAGES`/`DEFAULT_MAX_CHARS`. Suite: **63/63**.
- **TRIANGULATE**: new `test/truncation.test.js` (4 tests) driving the real `extractTextFromPdf` on generated multi-page PDFs: small `maxChars` → `"maxChars"`; `maxPages: 1` multi-page → `"maxPages"`; both → `"maxPagesAndMaxChars"`; untruncated → `null`. **All green** (67/67).
- **REFACTOR**: extracted single `buildTruncation(extracted)` helper in `src/server.js`; re-ran suite → **67/67 green**.

## Work Unit 3 — source/confidence attribution (strict TDD)

- **RED**: added 4 tests in `test/server.test.js` (mercadona-tabular; invoice-fields; plain-text; minimax on `/extract-with-llm`).
- **Process correction**: my WU2 GREEN rewrite of `normalizeResult` had already introduced `source`/`confidence` one step early, so the WU3 RED initially passed immediately. Under strict TDD I **rolled back those additive lines**, confirmed the genuine RED (**4 fail**), then re-applied them as the WU3 GREEN. Suite: **71/71**.
- **GREEN** (exact formula from tasks/design): `source = parser === "mercadona-tabular" ? "mercadona-tabular" : (invoiceFields?.matched?.length > 0 ? "invoice-fields" : "plain-text")`, `confidence: "deterministic"` on `/extract`; `/extract-with-llm` gains `source: "minimax"`, `confidence: "model-derived"`. `src/mercadona-parser.js` and `test/parser.test.js` untouched.

## Work Unit 4 — Error/auth contract lock (strict TDD)

- **RED**: added 10 tests in `test/server.test.js` locking exact flat `{"error"}` messages + statuses (array body, malformed JSON, invalid base64, empty data, `maxChars` over cap, open without `AUTH_TOKEN`, wrong bearer 401, unknown path/wrong method 404 empty, 413 request body, 413 response cap). **2 fail exactly as predicted**: `data must be a valid base64 string` and `data must not be empty` surfaced as the generic `invalid PDF extraction request` (plain `Error` without `publicMessage`). The other 8 locked already-correct behavior.
- **GREEN**: `decodeBase64` now throws via `requestError(...)` (sets `status` + `publicMessage`) — empty string → `data must not be empty`; invalid/non-string → `data must be a valid base64 string`; status stays 400. Suite: **81/81**.

## Work Unit 5 — MiniMax evidence gate (RED→lock + docs)

- **RED→lock**: added 2 invariant tests in `test/extract-with-llm.test.js` — (a) upstream request body contains no `data` field, no `%PDF-` substring, no base64 payload; (b) `POST /extract` never invokes `fetchImpl` even with `llmApiKey` set. **Both passed immediately — contract locks for already-correct behavior** (recorded as locks, not failures, per task).
- **GREEN/docs**: added the experimental/evidence-gated comment in `src/server.js` above `callLlm` (README section deferred to WU7/PR2): route accepts only the strict 6-key `structured` contract, rejects non-conforming responses with 502, no verified-provider claim until accepted evidence records `choices[0].message` shape and finish reason. **Grep evidence**: `grep -rniE "verified|producci[oó]n|production-ready|experimental" README.md deploy.sh docker-compose*.yml Dockerfile` → no matches; `src/` contains only the new evidence-gated wording + legitimate config/env references. Suite: **83/83**.

## Work Unit 6 — Manual non-Mercadona smoke tests (apply-owned verification)

Server: `PORT=3199 AUTH_TOKEN=smoke-secret MINIMAX_API_KEY= node src/server.js` (background, log `/tmp/pdf-tool-smoke.log`). Real non-Mercadona PDFs: `/home/jmon/apppdf/test_relleno.pdf` (generic filled form, 83 chars), `/home/jmon/apppdf/modelo_036_relleno.pdf` (real 4-page Spanish tax form "DECLARACIÓN CENSAL", 14,019 chars extracted), synthetic-but-real `/tmp/pdf-tool-invoice.pdf` (invoice labels). Observed:

| # | Command shape | Observed |
|---|---|---|
| 1 | `GET /healthz` (no auth) | 200 `ok` |
| 2 | `GET /version` (no auth) | 200 `{"name":"pdf-tool","version":"0.2.0"}` |
| 3 | `POST /extract` test_relleno (Bearer) | 200, `source: plain-text`, `confidence: deterministic`, `truncated: false`, no `truncation` key |
| 4 | `POST /extract` invoice.pdf (Bearer) | 200, `source: invoice-fields`, `confidence: deterministic`, `matched: ["invoiceDate","subtotal","taxLabel","tax","total"]`, `totals.total: "121.00"` |
| 5 | `POST /extract` modelo_036 default limits | 200, `truncated: true`, `reason: maxChars` (per-page 4000 cap engaged on real 14k-char doc), `applied: {maxPages:100,maxChars:80000}`, `allowed: {maxPages:200,maxChars:200000}`, `requiresUserConfirmation: true`, 4 pages |
| 6 | `POST /extract` modelo_036 `maxChars:2000` | 200, `truncated: true`, `reason: maxChars`, `applied: {maxPages:100,maxChars:2000}`, `text.length === 2000` |
| 7 | `POST /extract` `maxChars:500000` | 400 `{"error":"maxChars must be a positive integer no greater than 200000"}` |
| 8 | `POST /extract` `{}` (missing data) | 400 `{"error":"data must be a valid base64 string"}` |
| 9 | `POST /extract` `{"data":""}` | 400 `{"error":"data must not be empty"}` |
| 10 | `POST /extract` no Authorization | 401 `{"error":"unauthorized"}` |
| 11 | `POST /extract-with-llm` (MINIMAX_API_KEY unset) | 503 `{"error":"LLM service is not configured"}` |

Smoke server stopped after the matrix (`pkill -f "node src/server.js"`); temp bodies/PDFs under `/tmp` only (no repo artifacts).

## Files changed (PR 1 slice)

- `src/extract.js` — limit-based truncation decision; returns `truncationReason` + `applied`; skip-only pages no longer set `truncated`.
- `src/server.js` — `buildTruncation` helper; `normalizeResult` gains `truncation` (only when truncated) + `source`/`confidence`; `/extract-with-llm` gains `source: "minimax"`/`confidence: "model-derived"`; `decodeBase64` exact-message errors via `requestError`; experimental/evidence-gated comment above `callLlm`.
- `test/server.test.js` — +23 tests (truncation 6, source/confidence 4, error/auth 10, plus helper consts).
- `test/truncation.test.js` — new, 4 real-pipeline triangulation tests.
- `test/extract-with-llm.test.js` — +2 MiniMax invariant lock tests.
- `openspec/changes/pdf-tool-v0-2-architecture/tasks.md` — checkboxes WU1–WU6 marked `[x]` (11 implementation tasks).
- `openspec/changes/pdf-tool-v0-2-architecture/apply-progress.md` — this file.

## Deviations / notes

- **WU3 RED correction**: source/confidence initially landed one step early inside the WU2 GREEN; rolled back, demonstrated genuine RED (4 fails), re-applied as WU3 GREEN. Documented here for the review receipt.
- **Synthetic manual PDF quirk**: pdfjs returns only ~110–160 chars for a single long `Tj` literal string on synthetic base-font PDFs (clipped when font metrics are absent). Smoke used REAL non-Mercadona PDFs from `/home/jmon/apppdf` for the generic + truncation cases; the generated invoice PDF extracts fully (short lines).
- **Pre-existing working-tree changes NOT made by this apply**: `README.md`, `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `package.json` (version 0.2.0) were already modified before this session (v0.2 preparation). They overlap WU7 content; PR 1 must NOT include them in its commit boundary. `src/mercadona-parser.js`, `test/parser.test.js`, `test/extract-with-llm.test.js`, `test/fixtures/`, `openspec/` are untracked (never committed in the initial commit) — part of the overall candidate.
- No `.env` touched; no commit/push made; `src/mercadona-parser.js` logic untouched.

## Test commands run

- `node --test test/*.test.js` → baseline 57/57; after WU2 GREEN 63/63; after TRIANGULATE+REFACTOR 67/67; after WU3 GREEN 71/71; after WU4 GREEN 81/81; **final 83/83 pass, 0 fail**.
- `npm audit --omit=dev` → **0 vulnerabilities** (baseline + final).
- `node --check` on all changed files → syntax OK.
- Smoke: live-server curl matrix (see WU6 table).

## TDD Cycle Evidence

| Task | RED test (failed) | Minimal GREEN change | Suite after |
|---|---|---|---|
| WU2 truncation | 5 fail: `truncation` absent on `/extract` envelope | `extract.js` reason/applied + `normalizeResult` builds `truncation` | 63/63 |
| WU2 triangulate | 3 real-pipeline reason tests (new) | none needed — real impl already correct | 67/67 |
| WU2 refactor | n/a (behavior-preserving) | `buildTruncation` helper extracted | 67/67 |
| WU3 source/confidence | 4 fail after honest rollback | `source` formula + `confidence` in `normalizeResult` and LLM route | 71/71 |
| WU4 errors/auth | 2 fail: base64/empty-data generic message | `decodeBase64` throws via `requestError` with exact messages | 81/81 |
| WU5 locks | 0 fail — passed immediately (contract locks) | evidence-gated comment above `callLlm`; grep clean | 83/83 |
| WU6 smoke | n/a (manual) | n/a | 83/83 (post-smoke) |

## Remaining tasks (PR 2 + parent)

Unchecked in `tasks.md` (all WU7, implementation-owned, PR 2 slice — intentionally NOT touched):

- `- [ ] Update README.md: document the four routes, ... (~100 lines)`
- `- [ ] Update .env.example ... confirm docker-compose.yml and docker-compose.prod.yml wire the same env vars; run docker compose config ... (~20 lines)`
- `- [ ] Update deploy.sh ... rollback path ... (~10 lines)`
- `- [ ] Final CI gate run on the whole change: node --test, npm audit --omit=dev, docker compose config ... (~0 lines)`

Deferred parent-owned lifecycle actions:

- `- [ ] Start or reuse bounded review on the final candidate (single bounded review; ...)`
- `- [ ] Validate the delivery lifecycle gates (commit/pre-commit, push/PR) ...`

## Workload / PR boundary

PR 1 (this apply): src ~50 changed lines, tests ~450 added lines (23 in server.test.js + 70 truncation.test.js + 40 in extract-with-llm.test.js), 0 docs/ops lines. Estimated changed lines for PR 1: ~480 (exceeds 400 — size exception implicit in the parent-approved 2-PR split; PR 1 is the contract slice). PR 2 = WU7 docs/ops (~140 lines) must exclude the pre-existing README/compose/.env working-tree edits from PR 1's commit.

---

# PR 2 — Work Unit 7 (docs/ops) — apply-progress (merged, second batch)

## Structured status consumed

```yaml
schemaName: spec-driven
changeName: pdf-tool-v0-2-architecture
artifactStore: both            # openspec/ exists → authoritative (no resolve-via-engram)
artifacts: { proposal: done, specs: done, design: done, tasks: done, applyProgress: done (PR 1), reviewReceipt: [] }
applyState: ready
nextRecommended: apply (PR 2 slice = Work Unit 7; PR 1 slice already applied and recorded above)
blockedReasons: []
actionContext:
  mode: repo-local
  workspaceRoot: /home/jmon/pdf-tool
  allowedEditRoots: [/home/jmon/pdf-tool]   # docs/ops files only (README.md, .env.example, docker-compose*.yml, deploy.sh)
  warnings: ["native read/edit tools block the .env.example path; explicit parent task authorizes editing the committed template; .env (secrets) untouched"]
```

Delivery decision honored: ask-on-risk → 2-PR split; this batch implements ONLY Work Unit 7 (docs/ops). No `src/`, `test/`, or `openspec/` planning files were modified by this apply.

## Files changed (PR 2 slice)

- `README.md` — documented the four routes; `/extract` request contract (no `name` — not part of the contract; `name` removed from curl/Node examples too); canonical response envelope with `truncation` (reason/applied/allowed/`requiresUserConfirmation`, stateless, consumer asks the human and retries within `allowed`, absent when not truncated), `source`/`confidence` attribution for all three `/extract` outcomes and the LLM pair (`minimax`/`model-derived`); Limits table (16 MiB body / 12 MiB PDF / 200 pages / 200 000 chars / 4 000 per page / 1 MiB response / 16 000 prompt / 256–16 000 `maxTokens` / 180 s); flat Errors table with exact statuses and messages (400/401/404/413/502/503/504); optional `AUTH_TOKEN` fail-open deployment note; MiniMax experimental/evidence-gated note (no verified-provider claim until accepted `choices[0].message` shape + finish reason evidence; non-conforming → 502; no key → 503 while `/extract` intact).
- `.env.example` — comments documenting `AUTH_TOKEN` (fail-open policy) and the MiniMax block: unsetting `MINIMAX_API_KEY` disables `/extract-with-llm` (503) while `/extract` stays intact. Existing vars preserved; `MINIMAX_*` lines pre-existed this session and were kept.
- `docker-compose.yml` — NO edit by this apply: already wires PORT, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, AUTH_TOKEN, LOG_LEVEL, MINIMAX_API_KEY, MINIMAX_BASE_URL, MINIMAX_MODEL (pre-existing v0.2 prep). Verified by `docker compose config`.
- `docker-compose.prod.yml` — alignment fix: `MINIMAX_API_KEY` changed from `${MINIMAX_API_KEY:?...required}` to `${MINIMAX_API_KEY:-}` (+ comment). Rationale: the spec's `LLM disable rollback` scenario requires unsetting the key to produce 503 while `/extract` keeps working; a hard `:?` requirement would break the documented rollback path and block `docker compose config` without a key. `AUTH_TOKEN` stays required in prod (fail-closed deployment policy).
- `deploy.sh` — added doc comment stating the rollback path (unset `MINIMAX_API_KEY` + redeploy, or redeploy previous image; `/extract` never depends on the LLM route). Behavior unchanged; `bash -n` OK.

## Verification evidence (WU7 final CI gate)

| Command | Result |
|---|---|
| `node --test test/*.test.js` | **83/83 pass, 0 fail** (unchanged from PR 1 — docs broke nothing) |
| `npm audit --omit=dev` | **found 0 vulnerabilities**, exit 0 |
| `docker compose config` (base) | exit 0, config valid |
| `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` with `AUTH_TOKEN=ci-test` and NO `MINIMAX_API_KEY` | exit 0 — proves the rollback path (unset key) still yields a valid stack |
| `bash -n deploy.sh` | exit 0 |
| `grep -rniE "verified.*minimax|minimax.*verified" README.md .env.example docker-compose*.yml deploy.sh` | only match is the README evidence-gated wording ("no verified-provider claim is made … until … evidence") — no false verified claim |

## TDD Cycle Evidence (WU7)

Docs/ops are non-code, so strict TDD applies as contract-lock verification: no production code changed; the full suite ran BEFORE this batch (83/83, PR 1 final) and AFTER (83/83) with zero failures, proving the documentation cannot mask or alter runtime behavior. `docker compose config` + `bash -n` validated the ops files. The MiniMax evidence-gated wording is the only "experimental/verified" statement in the change (grep-checked).

## Deviations / alignment decisions (PR 2)

- **docker-compose.prod.yml `MINIMAX_API_KEY` `:?` → `:-`**: the pre-session prep made the key required in prod, which contradicts the spec's `LLM disable rollback` scenario and the WU7 deploy.sh rollback text. Aligned with the contract; flagged for the reviewer.
- **`.env.example` tooling block**: the native read/edit tools refuse the path; the parent task explicitly authorized editing this committed template (never `.env`). Written via shell with template placeholders only; `.env` untouched (still gitignored, not listed in status).
- **`/extract` request example**: removed the pre-existing `name` field — design/spec declare `name` is NOT part of the `/extract` request contract (LLM route only). Also removed from curl/Node examples for consistency.

## Remaining tasks

All implementation-owned tasks (WU1–WU7, 15 checkboxes) are `[x]` in `tasks.md`. Remaining unchecked lines are parent-owned lifecycle actions only:

- `- [ ] Start or reuse bounded review on the final candidate (single bounded review; verify the review workload forecast was honored — PR 1 = Work Units 1–6, PR 2 = Work Unit 7). <!-- sdd-owner: parent -->`
- `- [ ] Validate the delivery lifecycle gates (commit/pre-commit, push/PR) against the approved review receipt and the chosen chain strategy before any publication. <!-- sdd-owner: parent -->`

## Workload / PR boundary (final)

PR 2 (this apply): README.md ~150 lines, .env.example ~10, docker-compose.prod.yml ~4, deploy.sh ~11 → ~175 changed lines (under the 400-line budget; no exception needed for PR 2). PR 1 (previous batch) ~480 lines (approved 2-PR split). Pre-existing working-tree edits (README/.env.example/compose/package.json v0.2.0 prep) belong to the PR 2 boundary, never PR 1's commit.
