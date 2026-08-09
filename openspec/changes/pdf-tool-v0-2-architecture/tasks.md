# Tasks: PDF Tool v0.2 Architecture

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350–480 (src ~70–90, tests ~200–250, docs/ops ~110–140) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (contract code + tests: Work Units 1–6) → PR 2 (docs + ops: Work Unit 7) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

## Context (fuente de verdad)

- `proposal.md`, `design.md`, `specs/pdf-extraction-service/spec.md`, `specs/pdf-service-security-operations/spec.md`, `specs/structured-document-fallback/spec.md` are authoritative. Do NOT rewrite them.
- Runtime state verified: 57/57 tests green (`node --test test/*.test.js`). `src/server.js` already has the 4 routes, optional bearer auth (timing-safe), flat `{"error"}` envelope, MiniMax `max_tokens` fix + `thinking: disabled`, strict 6-key `structured` validation, 180 s timeout, and 502/503/504 mapping. `src/mercadona-parser.js` EXISTS and works — integrate, never recreate.
- Known gaps vs the v0.2 contract:
  1. `/extract` envelope (`normalizeResult` in `src/server.js`) lacks `truncation`, `source`, `confidence`.
  2. `/extract-with-llm` envelope lacks `source` and `confidence`.
  3. `extractTextFromPdf` (`src/extract.js`) returns only a boolean `truncated` — no truncation reason, no effective `applied` limits.
  4. `decodeBase64` errors (bad base64, empty data) currently surface as the generic `invalid PDF extraction request` because they lack `publicMessage`; design requires exact messages `data must be a valid base64 string` / `data must not be empty`.
- Prescribed truncation-resolution decision (apply this, do not relitigate): define `truncated` as limit-based — `pageLimitHit || charLimitHit`, where `pageLimitHit = declaredPages > pagesToRead` and `charLimitHit` = char cap engaged (per-page slice, char exhaustion, or final `truncate()`). Unreadable-page skips become best-effort continuation and no longer set `truncated` alone; reason always maps to the enum `maxPages` | `maxChars` | `maxPagesAndMaxChars`. Confirm no existing test pins skip-only `truncated: true`; if one does, update it in the same GREEN commit with a comment.
- Excluded from scope (do not add): consumer migration, MCP, OCR, Python server, continuation IDs, per-field provenance/conflict schemas, server state.

## Work Unit 1 — Protect v0.1 baseline

- [x] Run `node --test test/*.test.js` from `/home/jmon/pdf-tool` and record the green baseline (expected 57/57) plus `npm audit --omit=dev` result in apply-progress before any edit. Verification: both commands exit 0. Rollback: none (read-only). (~0 lines) <!-- sdd-owner: implementation -->

## Work Unit 2 — Truncation metadata (strict TDD: RED → GREEN → TRIANGULATE)

- [x] RED: add tests to `test/server.test.js` asserting the exact `/extract` truncation contract using the injectable `extract` stub of `withServer`:
  - `truncated: true` + `truncation` present with exactly `{ reason, applied, allowed, requiresUserConfirmation }`; `applied` mirrors effective limits, `allowed` is `{"maxPages": 200, "maxChars": 200000}`, `requiresUserConfirmation` is always `true`.
  - reason variants `"maxChars"`, `"maxPages"`, `"maxPagesAndMaxChars"` from stub `truncationReason`.
  - `truncated: false` → `truncation` key absent.
  - response contains no ID/session/expiry/retry-token key anywhere in `truncation`.
  Run the suite and confirm these fail (missing `truncation`/`source` fields). (~70 lines) <!-- sdd-owner: implementation -->
- [x] GREEN: implement in `src/extract.js` and `src/server.js`:
  - `extractTextFromPdf` returns `truncationReason` (one of `maxPages`/`maxChars`/`maxPagesAndMaxChars` or `null`) and `applied: { maxPages, maxChars }` using the already-computed bounded limits; `truncated = pageLimitHit || charLimitHit` per the prescribed decision.
  - `normalizeResult` imports `HARD_MAX_PAGES`/`HARD_MAX_CHARS` from `./extract.js` (already exported), builds `truncation` from `extracted.truncationReason`/`extracted.applied` (fall back to `DEFAULT_MAX_PAGES`/`DEFAULT_MAX_CHARS` when a stub omits them), and includes the object only when `truncated` is true.
  Run the suite: new tests green, baseline stays 57/57 (or the one documented skip-edge update). (~45 lines) <!-- sdd-owner: implementation -->
- [x] TRIANGULATE: add real-pipeline tests in `test/server.test.js` (or a new `test/truncation.test.js`) driving the real `extractTextFromPdf` against an existing PDF fixture: small `maxChars` → `reason: "maxChars"`; `maxPages: 1` on a multi-page fixture → `"maxPages"`; both small → `"maxPagesAndMaxChars"`. Then REFACTOR: extract a single `buildTruncation(extracted)` helper in `src/server.js` and re-run the suite. (~50 lines) <!-- sdd-owner: implementation -->

## Work Unit 3 — source/confidence attribution (strict TDD: RED → GREEN)

- [x] RED: add tests in `test/server.test.js` asserting the flat pair on every success envelope:
  - `/extract` with text that `parseMercadonaLines` scores ≥3 rows → `source: "mercadona-tabular"`, `confidence: "deterministic"`.
  - `/extract` with stub `invoiceFields: { matched: ["Factura"] }` (no tabular rows) → `source: "invoice-fields"`, `confidence: "deterministic"`.
  - `/extract` plain text, `invoiceFields.matched` empty → `source: "plain-text"`, `confidence: "deterministic"`.
  - `/extract-with-llm` (stubbed `fetchImpl` with conforming 6-key response) → `source: "minimax"`, `confidence: "model-derived"`.
  Confirm failure (fields missing). (~65 lines) <!-- sdd-owner: implementation -->
- [x] GREEN: in `src/server.js`, `normalizeResult` computes `source` as `parser === "mercadona-tabular" ? "mercadona-tabular" : (invoiceFields?.matched?.length > 0 ? "invoice-fields" : "plain-text")` with `confidence: "deterministic"`; the `/extract-with-llm` response object gains `source: "minimax"` and `confidence: "model-derived"`. Do NOT touch `src/mercadona-parser.js` or its `test/parser.test.js` logic. Run the suite: new tests green, baseline stays green. (~15 lines) <!-- sdd-owner: implementation -->

## Work Unit 4 — Error/auth contract lock (strict TDD: RED → GREEN)

- [x] RED: extend `test/server.test.js` to lock the exact flat `{"error"}` messages and statuses from `design.md`/`specs/pdf-service-security-operations/spec.md`: array body → 400 `request body must be a JSON object`; malformed JSON → 400 `request body must be valid JSON`; `data: "not base64!"` → 400 `data must be a valid base64 string`; empty `data` → 400 `data must not be empty`; `maxChars: 500000` → 400 `maxChars must be a positive integer no greater than 200000`; no `AUTH_TOKEN` → POST routes open; wrong/missing bearer → 401 `unauthorized`; wrong method/unknown path → 404 empty body; over-limit body → 413 `request body exceeds the size limit`; over-cap response → 413 `response exceeds the size limit`; LLM 502/503/504 messages already locked — keep. Confirm the base64/empty-data assertions fail (generic message today). (~60 lines) <!-- sdd-owner: implementation -->
- [x] GREEN: in `src/server.js`, make `decodeBase64` throw via `requestError("data must be a valid base64 string")` / `requestError("data must not be empty")` (or set `error.publicMessage`) so the design messages surface through the catch path; keep status 400. Re-run the suite. (~5 lines) <!-- sdd-owner: implementation -->

## Work Unit 5 — MiniMax evidence gate: invariants + experimental status

- [x] RED→lock: add invariant tests in `test/extract-with-llm.test.js`:
  - bytes never sent upstream: capture the request body of the stubbed `fetchImpl` and assert it contains no base64 `data` field and no `%PDF-` substring (only extracted text + `name` + `prompt`);
  - no automatic fallback: `POST /extract` with a valid body never invokes `fetchImpl` even when `llmApiKey` is set.
  These may pass immediately — treat them as contract locks and record that in the commit message. (~40 lines) <!-- sdd-owner: implementation -->
- [x] GREEN/docs: mark the route experimental/evidence-gated with no verified-provider claim: README section (or code comment in `src/server.js` above `callLlm`) states the route is experimental until accepted live/authoritative evidence records the exact `choices[0].message` shape and finish reason, and that non-conforming responses are rejected with 502. Grep the change for any claim of verified MiniMax success and remove it. Verification: suite green + grep shows only the evidence-gated wording. (~10 lines) <!-- sdd-owner: implementation -->

## Work Unit 6 — Manual non-Mercadona smoke tests (apply-owned verification)

- [x] Start the server (`node src/server.js` with `AUTH_TOKEN` set, `MINIMAX_API_KEY` unset), then curl real non-Mercadona PDFs (a generic manual + an invoice): assert 200 envelope with `source`/`confidence`, `truncation` appears when forcing small `maxChars` (e.g. 2000), `maxChars` over cap → 400, missing/empty `data` → 400, no token → 401, `POST /extract-with-llm` → 503, `GET /healthz`/`/version` public. Record the smoke results (commands + observed statuses) in apply-progress. (~0 code lines; ~15 doc/evidence lines) <!-- sdd-owner: implementation -->

## Work Unit 7 — Docs and ops (PR 2 slice)

- [x] Update `README.md`: document the four routes, the `/extract` envelope including `truncation` (reason/applied/allowed/`requiresUserConfirmation`, stateless — consumer asks the human and retries within `allowed`), `source`/`confidence` values on both POST routes, the limits table (16 MiB / 12 MiB / 200 pages / 200 000 chars / 4 000 per page / 1 MiB response / 16 000 prompt / 256–16 000 `maxTokens` / 180 s), the flat error table with exact statuses/messages, optional `AUTH_TOKEN` fail-open deployment note, and the MiniMax experimental/evidence-gated note from Work Unit 5. (~100 lines) <!-- sdd-owner: implementation -->
- [x] Update `.env.example` with `AUTH_TOKEN`, `MINIMAX_API_KEY`, `MINIMAX_BASE_URL`, `MINIMAX_MODEL` and a comment that unsetting `MINIMAX_API_KEY` disables the LLM route (503) while `/extract` stays intact; confirm `docker-compose.yml` and `docker-compose.prod.yml` wire the same env vars; run `docker compose config` and fix any config issue. Do not touch `.env` (local secrets). (~20 lines) <!-- sdd-owner: implementation -->
- [x] Update `deploy.sh` (or its doc comment) to state the rollback path: unset `MINIMAX_API_KEY` or redeploy the previous image to disable the LLM route without affecting `/extract`. (~10 lines) <!-- sdd-owner: implementation -->
- [x] Final CI gate run on the whole change: `node --test test/*.test.js`, `npm audit --omit=dev`, and `docker compose config` all exit 0; record results in apply-progress. Verification: three commands green. (~0 lines) <!-- sdd-owner: implementation -->

## Post-apply lifecycle (parent-owned)

- [x] Start or reuse bounded review on the final candidate (single bounded review; verify the review workload forecast was honored — PR 1 = Work Units 1–6, PR 2 = Work Unit 7). <!-- sdd-owner: parent -->
- [x] Validate the delivery lifecycle gates (commit/pre-commit, push/PR) against the approved review receipt and the chosen chain strategy before any publication. <!-- sdd-owner: parent -->
