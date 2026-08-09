# Archive Report — PDF Tool v0.2 Architecture

Change: `pdf-tool-v0-2-architecture` — Repo: `/home/jmon/pdf-tool` — Store: hybrid (openspec + Engram topic `sdd/pdf-tool-v0-2-architecture/archive-report`, project `pdf-tool`)
Date: 2026-08-09 — Executor phase: `sdd-archive`

## Archive Status

**PASS (change complete and published).** Partial archive per explicit parent scope: this run writes `archive-report.md` and persists it to Engram only. No canonical spec sync, no folder move, and no edit to any other artifact was performed — the parent prompt explicitly scoped this phase to report + Engram persistence ("NO tocar código ni otros artefactos").

- Native review of the change: **approved** (4-lens bounded review, lineage `review-7ccd17739285f41a`, receipt materialized in the runtime ledger).
- Delivery: commit `93a5aba95dc7080013e74c85814c795a6f1bacea` pushed to `origin` (`github.com/dumbocan/pdf-tool`, branch `main`).
- Review mode for this repo: **off** (clone-local) — delivery follows ordinary git policy; nothing was silently approved.

## Artifacts Read

| Artifact | Path | Status |
|---|---|---|
| Proposal | `openspec/changes/pdf-tool-v0-2-architecture/proposal.md` | done |
| Spec 1 | `openspec/changes/pdf-tool-v0-2-architecture/specs/pdf-extraction-service/spec.md` | done |
| Spec 2 | `openspec/changes/pdf-tool-v0-2-architecture/specs/pdf-service-security-operations/spec.md` | done |
| Spec 3 | `openspec/changes/pdf-tool-v0-2-architecture/specs/structured-document-fallback/spec.md` | done |
| Design | `openspec/changes/pdf-tool-v0-2-architecture/design.md` | done |
| Tasks | `openspec/changes/pdf-tool-v0-2-architecture/tasks.md` | done |
| Apply progress | `openspec/changes/pdf-tool-v0-2-architecture/apply-progress.md` | done |
| Verify report | `openspec/changes/pdf-tool-v0-2-architecture/verify-report.md` | done (PASS) |
| Sync report | — | absent (no canonical sync run; see Domains Synced) |
| Config | `openspec/config.yaml` | present (`schema: spec-driven`, `strict_tdd: true`; no `rules.archive` defined) |

## Final State per Artifact

- **Proposal**: complete. Minimal additive v0.2 contract over the published v0.1 runtime; MiniMax kept explicit and evidence-gated; success criteria all met.
- **Specs**: 3 domain specs, 17 requirements total — **17 PASS / 0 FAIL / 0 CRITICAL**.
- **Design**: complete; all architecture decisions implemented (optional bearer auth, stateless truncation metadata, fixed bounds, simple source/confidence attribution, evidence-gated MiniMax, untrusted-content boundary).
- **Tasks**: **17/17 checkboxes `[x]`** (15 implementation-owned WU1–WU7 + 2 parent-owned lifecycle actions: bounded review + delivery gates). **0 unchecked `- [ ]` lines remain** (re-verified by direct grep at archive time, exit 1 no matches).
- **Apply progress**: TDD evidence for PR1 + PR2 recorded (RED → GREEN → TRIANGULATE cycles, WU6 smoke matrix, final CI gate run).
- **Verify report**: PASS 17/17 after reconciliation. The 2 WARNINGs (CI missing `docker compose config`; README `max_completion_tokens` vs code `max_tokens`) were reconciled post-verification and are **confirmed resolved in the delivered tree**: `.github/workflows/ci.yml` now includes `docker compose config`, and `README.md:105` now documents `max_tokens`. Suite 83/83 pass, `npm audit --omit=dev` 0 vulnerabilities, `docker compose config` (base + prod) exit 0, `bash -n deploy.sh` OK.

## Delivery Evidence

- Commit: `93a5aba95dc7080013e74c85814c795a6f1bacea` — `feat: pdf-tool v0.2 - truncation metadata, source/confidence, evidence-gated MiniMax, exact error contract` (Author: jmon, 2026-08-09).
- Remote: `origin https://github.com/dumbocan/pdf-tool.git` (fetch/push); commit present at HEAD of local `main` and pushed (per parent-confirmed final state; review receipt lineage `review-7ccd17739285f41a` approved).
- PR split honored: PR 1 = Work Units 1–6 (contract code + tests, `src/` + `test/`), PR 2 = Work Unit 7 (docs/ops: `README.md`, `.env.example`, `docker-compose.prod.yml`, `deploy.sh`, CI).
- Review decision: **review mode off for pdf-tool (clone-local)** — recorded as the delivery decision for this repo; delivery under ordinary repository policy (hooks/tests/CI).

## Domains Synced

**None.** No canonical spec sync was performed in this run and no `sync-report.md` exists:

- `openspec/specs/` (canonical layer) does **not exist** in the repo.
- The 3 change specs remain at `openspec/changes/pdf-tool-v0-2-architecture/specs/{domain}/spec.md`.
- Archive-time sync fallback was **not** authorized by the parent prompt, which explicitly restricted this phase to report + Engram persistence.

Requirement inventory (all ADDED relative to v0.1; sync would create new canonical domain specs, not merge into existing ones):

- `pdf-extraction-service`: Deterministic extraction endpoint; Canonical response envelope; Stateless truncation metadata; Specialized Mercadona recognizer; Deterministic Spanish invoice fields; Untrusted content boundary.
- `pdf-service-security-operations`: Routes, methods, and public endpoints; Optional bearer authentication; Bounds and limit enforcement; Error envelope and status mapping; Untrusted content and secrets; Deployment and evidence.
- `structured-document-fallback`: Explicit LLM route only; Strict structured-response contract; Honest provider failures; MiniMax evidence gate; LLM input bounds and untrusted content.

## Active Same-Domain Change Warnings

None. Native status reports `sameDomainActiveChanges: []` — no other active change touches these domains.

## Task Completion Check (Final Gate)

- Re-read persisted `tasks.md` immediately before writing this report.
- Unchecked implementation task lines: **none** (grep `^\s*- \[ \]` → no matches).
- Parent-owned lifecycle actions: **both complete** (`[x]`, `<!-- sdd-owner: parent -->`): bounded review started/reused and delivery lifecycle gates validated — consistent with the approved review receipt and published commit.

## Structured Status and ActionContext Findings

Native `gentle-ai sdd-status` (authoritative, store `openspec` on disk):

```yaml
schemaName: gentle-ai.sdd-status
schemaVersion: 1
changeName: pdf-tool-v0-2-architecture
artifactStore: openspec        # real session store: both (hybrid)
artifactPaths: { proposal: done, specs: done, design: done, tasks: done, applyProgress: done, verifyReport: done, reviewArtifacts: missing-from-openspec }
taskProgress: { total: 17, completed: 17, pending: 0, allComplete: true }
applyState: all_done
actionContext:
  mode: repo-local
  workspaceRoot: /home/jmon/pdf-tool
  allowedEditRoots: [/home/jmon/pdf-tool]
  warnings: []
nextRecommended: remediate
```

- `nextRecommended: remediate` + `blockedReasons`: the native runtime ledger requires a fenced-YAML `gentle-ai.verify-result/v1` envelope as the first non-empty content of `verify-report.md` to settle verify evidence under unmanaged remediation (receipt-driven review disabled → bounded by native attempt budget). This is a **mechanical ledger/format finding, not a verification-content failure**: the verify report itself is PASS 17/17 with no unresolved FAIL/BLOCKED/CRITICAL, and the parent launch prompt explicitly confirmed final verify state and publication. Per the archive final-state handoff contract, explicit final-state facts in the launch prompt outrank stale snapshot claims; the envelope fix is left to the parent/verify phase and was **not** applied here (out of scope — no other artifacts may be edited).
- `reviewGate`: structurally absent for this candidate (no review was started under a persisted openspec review bundle; the 4-lens review ran under the runtime ledger, lineage `review-7ccd17739285f41a`); delivery proceeds under ordinary repository policy with review mode off (clone-local), which the parent confirmed.
- `actionContext.mode: repo-local` with `allowedEditRoots: [/home/jmon/pdf-tool]` — all report writes stay inside the workspace.

## Destructive Merge / Sync Approvals

N/A — no canonical sync or destructive merge was performed in this run (no `openspec/specs/` target, no REMOVED/MODIFIED canonical blocks touched).

## Partial-Archive Exception (parent-scoped, explicit)

This archive run is intentionally partial per the parent prompt:

- Scope: write `archive-report.md` + persist `sdd/pdf-tool-v0-2-architecture/archive-report` in Engram; **no other file changes**.
- Not performed (pending parent decision, recorded for the record):
  1. Canonical spec sync (`openspec/specs/{domain}/spec.md` creation from the 3 change specs) — requires a `sync-report.md` and/or explicit parent approval.
  2. Physical archive move (`openspec/changes/pdf-tool-v0-2-architecture/` → `openspec/changes/archive/2026-08-09-pdf-tool-v0-2-architecture/`).
  3. Native verify-evidence envelope settlement (`gentle-ai.verify-result/v1` fenced YAML in `verify-report.md`) — verify-phase remediation, out of archive scope.

## MiniMax Evidence Gate Note

MiniMax (`POST /extract-with-llm`) remains **experimental and evidence-gated** per spec 3.4: it is not presented as verified until accepted live or authoritative evidence records the exact `choices[0].message` shape and finish reason. No verified-provider claim exists in code, docs, or tests (grep verified). Design open question remains open: "Obtain accepted MiniMax metadata-only live or authoritative evidence for the exact `choices[0].message` shape and finish reason to move the route out of experimental status." This change does **not** move MiniMax to verified — the gate stays closed.

## Archived Path

- Original change root (unchanged, no move performed): `openspec/changes/pdf-tool-v0-2-architecture/`
- Planned archive destination (pending parent approval): `openspec/changes/archive/2026-08-09-pdf-tool-v0-2-architecture/`

## Memory Persistence

- Engram observation saved with `topic_key: sdd/pdf-tool-v0-2-architecture/archive-report`, `project: pdf-tool`, `type: architecture`, `capture_prompt: false`. Observation ID: **2814** (confirmed `status: saved`).
