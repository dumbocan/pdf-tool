# Proposal: Make NeluPDF a Local-First, Rust-Mediated Desktop Product

**Change:** `nelupdf-full-audit`
**Status:** Proposed
**Artifact store:** Hybrid (OpenSpec + Engram)
**Primary platform:** Linux
**Delivery constraint:** Dependency-ordered slices, each within a 400 changed-line review budget where feasible

## Decision summary

NeluPDF will become a Linux-first desktop product whose webview communicates only with the Tauri/Rust shell. Rust will mediate every desktop-to-engine operation and will own the engine trust boundary; the webview will neither call loopback HTTP directly nor receive engine credentials. Deterministic local extraction will remain the default.

External LLM use will be optional, disabled unless its privacy and release gates are satisfied, and governed by one enforceable contract across desktop, CLI, HTTP, and MCP. No raw-text bypass will remain. Each external request must use a minimized or pseudonymized payload and an explicit, informed, content-bound authorization transaction covering the document, outbound payload, provider, model, and expiry.

Delivery will be incremental. The first implementable slice establishes trustworthy test seams, the Rust-mediated desktop boundary, and deterministic local extraction. External LLM integration and final packaging/release remain later, bounded slices.

## Objective

Correct the product-lifecycle, trust-boundary, privacy, and verification gaps identified by the full audit so NeluPDF can evolve from an early webview plus separately managed engine into a dependable desktop product.

The change is intended to:

- provide a coherent local desktop workflow without exposing loopback transport or engine credentials to webview code;
- preserve bounded, deterministic PDF extraction as the safe default;
- make external processing an exceptional, informed, auditable action rather than an alternate raw-data path;
- give maintainers testable contracts for startup, document authority, extraction, privacy, failure handling, and later packaging;
- reconcile product behavior and documentation with what the software can actually guarantee.

This proposal defines product direction and release gates. It does **not** certify legal compliance in any jurisdiction.

## Current-state problem

The repository contains a capable bounded Node.js extraction engine and an early Tauri/React client, but they do not yet form a self-contained desktop product.

- The React webview calls a configurable loopback URL directly and assumes an engine already exists on a fixed port.
- Rust does not own engine startup, readiness, authentication, recovery, shutdown, or packaging.
- Optional authentication breaks current desktop requests because the webview sends no credential; disabling authentication leaves an unsafe local boundary.
- Loopback HTTP currently combines permissive CORS, optional authentication, and path-reading endpoints.
- Native drag-and-drop, duplicate-file identity, CSV safety, failure states, accessibility, and retention behavior have confirmed defects or gaps.
- Desktop, Rust, lifecycle, accessibility, and end-to-end test seams are absent from CI.
- LLM privacy behavior is inconsistent: some flows pseudonymize, while CLI, direct HTTP, and MCP paths can transmit raw extracted text.
- Existing preview and confirmation calls are not bound to the same document bytes, transformed payload, provider, model, or expiry.
- Privacy and product documentation overstate parts of current behavior.
- The baseline Node suite has one known randomized failure, weakening regression attribution.

These are trust and product-lifecycle failures, not merely UI polish issues.

## Target users and situations

### Primary users

- Linux desktop users who process invoices or similar PDFs locally and expect the application to work without manually operating a server.
- Privacy-conscious users and organizations that need predictable local processing and a clear boundary before any external transfer.
- Users handling malformed, scanned, partial, duplicate-named, or otherwise unusual PDFs who need actionable and non-destructive failure handling.

### Operational users

- Maintainers who need deterministic tests, explicit process ownership, bounded resource use, and reviewable release slices.
- Security, privacy, and legal reviewers who need accurate data-flow documentation and enforceable release gates.
- Support and release teams who need diagnosable failures without collecting document contents, credentials, or sensitive local paths.

## Product and business outcomes

After the change:

1. A user can perform deterministic extraction through the Linux desktop application without configuring or contacting a loopback service from the webview.
2. Local processing is visibly and technically the default; no network is required for the core extraction workflow.
3. Every external LLM entry point applies the same policy and cannot bypass minimization, pseudonymization, disclosure, and explicit confirmation.
4. Users can understand exactly which provider/model and transformed payload are authorized for one time-bounded transaction.
5. Unsupported, unavailable, or non-compliant provider configurations fail closed without blocking local extraction.
6. Desktop, engine, and privacy behavior can be changed in small, independently tested and rollback-friendly slices.
7. Product and privacy claims describe verified behavior rather than roadmap intent.

Expected business benefits are reduced setup friction, fewer privacy surprises, lower support burden, a clearer enterprise review story, and a credible path to a supported Linux release.

## Scope

### In scope for the change program

- A Rust-mediated contract for all webview-to-engine operations.
- Rust ownership of desktop engine identity, credentials, readiness, request mediation, and lifecycle policy.
- Authorized document handling that does not expose a general arbitrary-path capability to the webview.
- Deterministic local extraction, including bounded input and failure semantics.
- Test harnesses and CI coverage appropriate to React, Rust/Tauri, Node integration, accessibility, and later desktop flows.
- One external-LLM privacy contract shared by desktop, CLI, HTTP, and MCP.
- A content-bound, expiring confirmation transaction for external processing.
- Removal, restriction, or migration of raw LLM bypasses so no supported interface can transmit raw document content outside the unified contract.
- Provider disclosure and enablement gates covering processing, retention, training use, security posture, and lawful transfer mechanisms.
- Desktop behavior corrections needed for reliable file identity, safe export, state retention, accessibility, and actionable failures.
- Linux packaging, installer integrity, release verification, rollback evidence, and user/support documentation in later slices.
- Reconciliation of privacy, security, installation, and product documentation with implemented behavior.

### First implementable slice

The first slice is deliberately narrower than the full audit remediation:

- establish frontend, Rust, and boundary-level test seams plus CI commands for the touched behavior;
- define and implement the webview-to-Rust request contract;
- route deterministic local extraction through Rust mediation;
- ensure the webview has no direct engine URL, bearer token, or equivalent engine credential;
- prove local extraction requires no external network access;
- provide typed states for readiness, deterministic extraction success, invalid input, engine unavailability, and bounded failure;
- preserve existing product/source changes unrelated to this slice.

This slice does not enable external LLM processing and does not claim release-ready packaging.

## Non-goals

- Worldwide or jurisdiction-specific legal certification.
- Enabling an external provider before its documentation, contractual, transfer, security, and product-review gates pass.
- Supporting macOS or Windows in the first official release.
- Completing LLM integration in the first implementable slice.
- Producing final signed installers, updater infrastructure, or store submissions in the first implementable slice.
- Building hosted processing, accounts, payments, licensing, inventory, Facturae/Factur-X, or unrelated roadmap features.
- Redesigning deterministic invoice parsing unless required to preserve bounded local extraction behavior.
- Treating loopback reachability, CORS, obscurity, or a webview-held secret as an authentication boundary.
- Retaining a legacy raw LLM route for compatibility.
- Refactoring unrelated existing product code or discarding pre-existing tracked/untracked work.

## Product and architecture invariants

These constraints apply to every release slice:

1. **Rust mediation:** The desktop webview must invoke a typed Tauri/Rust interface for every engine operation. It must not call loopback HTTP directly, select the engine endpoint, or hold engine credentials.
2. **Shell-owned authority:** Rust must establish the identity and authority of the engine it mediates. A process merely answering on a loopback port is not trusted.
3. **Local-first default:** Deterministic extraction must work without external network access and remain the default path in desktop, CLI, HTTP, and MCP.
4. **Explicit external action:** No external provider call may occur from an implicit fallback, document open, preview-only action, retry, or default configuration.
5. **No raw bypass:** Every supported LLM entry point must enforce the same privacy contract. Legacy direct/raw paths must be disabled until migrated, then removed or explicitly deprecated without retaining an operational bypass.
6. **Bound transaction:** External authorization must bind the exact document identity, exact outbound transformed payload, provider, model, and expiry. Confirmation must not silently recompute or substitute any of them and must be single-use.
7. **Data minimization:** Only fields or text needed for the declared provider task may leave the device. The outbound payload must be minimized and pseudonymized according to a documented, tested transformation policy.
8. **Honest disclosure:** The user must see material payload coverage, transformation limitations, provider/model, purpose, retention/training disclosures, destination/transfer implications, and expiry before confirmation. A short sample must not be represented as the entire payload.
9. **Fail closed:** External LLM use remains disabled when provider processing, retention, training, security, processor terms, lawful basis, or transfer mechanisms cannot be demonstrated for the intended release context.
10. **Untrusted inputs:** PDF content, local file metadata, engine responses, provider responses, and generated spreadsheet cells are untrusted and must be validated or safely encoded at their boundaries.
11. **Bounded resources:** Existing PDF size/page/text/provider limits must not regress. OCR and lifecycle work must add explicit timeout, cancellation, concurrency, temporary-storage, and output bounds before release exposure.
12. **Minimal retention:** Document bytes, extracted text, transformed payloads, file paths, mappings, and transaction state must have documented in-memory and log lifetimes and explicit clearing behavior. Sensitive contents and credentials must not enter routine logs.
13. **Additive compatibility where safe:** Deterministic CLI/HTTP/MCP behavior should remain compatible where it does not violate these invariants. Privacy or security conflicts take precedence and require an explicit migration path.
14. **Evidence per slice:** Every applicable slice must include internal automated tests and visual/accessibility verification. A slice is not complete on implementation evidence alone.
15. **Release truthfulness:** Documentation and UI claims must not exceed verified runtime behavior or qualified legal review.

## Unified external-LLM privacy contract

The contract applies uniformly to desktop, CLI, HTTP, and MCP:

1. The caller requests an optional external operation; local deterministic output remains available independently.
2. The system validates document authority and derives a content identity without exposing raw document content externally.
3. The system builds the minimum task-specific outbound payload and applies the documented pseudonymization policy.
4. A transaction is created that binds document identity, outbound-payload hash, provider, model, declared purpose, disclosure version, expiry, and one-time state.
5. The user receives an informed disclosure and a faithful representation of payload scope and transformation limitations.
6. Explicit confirmation authorizes only that transaction. Expired, replayed, changed, or independently constructed confirmations are rejected.
7. Provider invocation uses the already-bound payload; it may not re-extract or recompute a different payload after confirmation.
8. Provider output is treated as untrusted, schema-validated, and reversed only through exact transaction mappings. Numeric or identifier values outside the map must not be transformed opportunistically.
9. The transaction records bounded, non-content audit evidence sufficient to explain provider/model, consent version, payload identity, time, and outcome without retaining raw document contents.
10. If any enablement or transaction condition fails, the external operation remains unavailable and the local deterministic workflow continues.

“Pseudonymized” must never be presented as “anonymous.” The exact protected data classes, residual disclosure, international formats, and transformation limits must be specified and tested before provider enablement.

## Regulatory and policy rationale

The privacy architecture is based on conservative product and security principles informed by official sources; these references are rationale, not a claim of certification:

- GDPR Recital 26 and Articles 5, 6, 28, and 44 support treating re-identifiable pseudonymized data as personal data and retaining minimization, lawful-basis, processor-contract, and international-transfer obligations: <https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng>.
- The EDPB transfer guide explains that transfer conditions are additional to lawful basis, security, minimization, and processor obligations: <https://www.edpb.europa.eu/sme-data-protection-guide/international-data-transfers_en>.
- Canadian privacy commissioners' generative-AI principles emphasize legal authority or meaningful consent, transparency, accountability, and impact assessments: <https://www.priv.gc.ca/en/privacy-topics/technology/artificial-intelligence/gd_principles_ai/>.
- The OAIC guidance emphasizes privacy by design and consent that is valid, current, and specific rather than broad: <https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/guidance-on-privacy-and-developing-and-training-generative-ai-models>.
- Brazil's ANPD describes mechanisms for international data transfers: <https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados>.
- China's PIPL Articles 38–39 require an applicable transfer mechanism, recipient disclosure, and separate consent for cross-border provision: <https://en.spp.gov.cn/2021-12/29/c_948419_2.htm>.

A qualified jurisdiction and provider review is a mandatory release gate before any external LLM is enabled. Review must cover the intended users and locations, provider/account terms, processor roles, lawful basis, consent requirements, data residency and transfers, retention and training practices, security controls, age/sector constraints, and required impact assessments. If the review is absent, inconclusive, or cannot demonstrate the required conditions, external LLM use remains disabled.

## Release slices and chained delivery forecast

The program is expected to exceed 400 changed lines and must use dependency-ordered chained delivery. Each slice should target no more than 400 changed lines where feasible; if a slice forecasts more, tasks must subdivide it before apply rather than relying on a broad exception.

| Slice | Outcome | Depends on | Review and evidence focus |
| --- | --- | --- | --- |
| 1. Harness, Rust boundary, local extraction | Test seams exist; webview uses a typed Rust command; deterministic extraction works locally without engine credentials in JavaScript | None | Frontend/Rust contract tests, Node integration checks, no-network proof, internal and visual failure-state checks |
| 2. Engine lifecycle and document authority | Rust owns engine identity, startup/readiness, authorized file access, bounded requests, cancellation, recovery, and shutdown | Slice 1 | Lifecycle and hostile-boundary tests, port/process identity, path authority, OCR/resource bounds |
| 3. Unified privacy transaction | Desktop, CLI, HTTP, and MCP share one no-bypass, minimized, pseudonymized, content-bound flow | Slices 1–2 | Cross-interface contract tests, preview/confirm binding, replay/expiry rejection, no raw egress, exact reverse-map behavior |
| 4. Desktop reliability and accessibility | Duplicate-safe identity, clear retention controls, safe CSV, typed recovery, keyboard/modal/screen-reader/responsive behavior | Slices 1–2; privacy UI portions depend on 3 | Component, accessibility, visual, and integration tests |
| 5. Linux packaging and operations | A self-contained Linux package has declared engine/OCR resources, CSP/capabilities, integrity, diagnostics, rollback, and CI smoke evidence | Slices 1–4 | Package/install smoke tests, security checks, upgrade/rollback evidence, release documentation |
| 6. Provider enablement | An approved provider can be enabled only after product, security, privacy, and jurisdiction review | Slices 3 and 5 | Provider-specific contract evidence, disclosure review, transfer/retention/training/security gates |

The task phase must refine these boundaries using actual changed-line forecasts and preserve a review path that does not mix unrelated trust-boundary, privacy, UX, and release concerns.

## Acceptance signals

### First-slice acceptance signals

- Automated tests fail when the webview attempts direct HTTP engine access or depends on an engine credential and pass when it invokes the Rust boundary.
- No production webview configuration or code contains an engine URL, bearer token, or equivalent engine authority.
- A selected valid PDF can complete deterministic extraction through the desktop boundary on Linux without external network access.
- Invalid PDF, oversized input, unavailable engine, protocol mismatch, timeout, and cancellation produce typed, non-sensitive states rather than raw alerts or stack details.
- The test harness covers the new frontend/Rust boundary and is invoked by CI for the touched scope.
- Internal tests and applicable visual/accessibility checks pass for the slice.
- Existing unrelated source and user changes remain intact.

### Program acceptance signals

- Desktop, CLI, HTTP, and MCP have contract tests proving there is no supported raw LLM bypass.
- Confirmation is rejected for a changed document, payload, provider, model, expired transaction, replayed transaction, or direct unpreviewed request.
- Captured/mock provider requests prove that only the confirmed minimized/pseudonymized payload can leave the system.
- Local deterministic extraction remains functional when provider support is disabled, offline, misconfigured, declined, or legally unapproved.
- Provider responses and reverse mappings cannot alter values that were not part of the transaction map.
- Security tests cover origin/path authority, engine identity/authentication, untrusted responses, OCR bounds, CSP/capabilities, and sensitive logging.
- Desktop tests cover drag/drop and dialog parity, duplicate basenames, clear/reset, safe CSV, keyboard access, modal focus, status announcements, and actionable recovery.
- Linux packaging smoke tests prove installation, first launch, local extraction, shutdown, and rollback on the supported distribution matrix.
- Privacy, security, installation, and product documentation match verified runtime behavior.
- Qualified release review approves each enabled provider for the intended release jurisdictions; otherwise the feature remains disabled.
- The known randomized Node test is stabilized or explicitly isolated before new regression claims rely on a green baseline.

## Rollback and compatibility implications

### Rollback strategy

- Land additive contracts and tests before removing old desktop calls or legacy provider paths.
- Keep each slice independently revertable and preserve deterministic local extraction throughout migration.
- Gate incomplete desktop paths and all provider use off by default.
- If Rust lifecycle or mediation fails in a delivered slice, roll back that slice rather than restoring direct webview-to-loopback access.
- If privacy-transaction or provider review fails, disable external LLM use while retaining local deterministic functionality.
- Packaging and update work must define artifact rollback before a release is promoted.

### Compatibility implications

- Existing deterministic CLI, HTTP, and MCP contracts should remain additive and stable unless a security boundary requires change.
- Direct/raw LLM routes and CLI behavior are unsafe compatibility commitments and must not be preserved as operational bypasses. They require explicit deprecation/error behavior and migration documentation toward the unified transaction contract.
- Desktop builds that depend on `VITE_MOTOR_URL` or direct loopback fetches will migrate to the Rust command contract; compatibility must not expose a fallback URL.
- Path-reading interfaces may narrow to authorized-file capabilities or bounded workspaces. Callers that rely on arbitrary paths will need a documented migration.
- Response and failure shapes may become versioned typed contracts. Consumers must receive clear protocol-mismatch errors rather than silent coercion.
- Linux is the only officially supported platform in the first release. Existing cross-target configuration must not be represented as tested support; macOS and Windows remain future qualification work.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Rust mediation becomes a thin proxy over an unauthenticated arbitrary loopback endpoint | Preserves the original local attack surface | Require shell-owned process identity, credentials, endpoint selection, typed commands, and hostile-boundary tests |
| First slice grows into lifecycle, privacy, UX, and packaging simultaneously | Exceeds review capacity and weakens rollback | Enforce the slice boundary and 400-line forecast before apply; chain by dependency |
| Legacy raw LLM behavior remains reachable for compatibility | Invalidates the unified privacy promise | Fail closed, deprecate explicitly, and prove no-bypass across all interfaces |
| Pseudonymization is mistaken for anonymization | Misleads users and reviewers | Document residual risk and exact coverage; require informed disclosure and qualified review |
| Provider policy or transfer claims become stale | Creates privacy, contractual, and representation risk | Use provider-specific dated evidence and re-review gates; disable on uncertainty |
| Rust/Node/OCR packaging is only partially bundled | Produces a larger but still non-functional application | Keep final packaging in a later bounded slice with install, launch, shutdown, and rollback smoke evidence |
| OCR remains unbounded | Malicious scans can exhaust CPU, memory, or disk | Specify and test time, page, concurrency, output, cancellation, and temporary-storage limits before exposure |
| Existing flaky baseline masks regressions | Reduces confidence in TDD evidence | Stabilize or isolate the randomized test before relying on a green baseline |
| Existing untracked/in-progress work is overwritten | Causes user data/work loss | Restrict each phase to declared files, inspect candidate scope, and preserve unrelated changes |
| Visual/accessibility verification is deferred as “polish” | Ships unusable failure and consent flows | Require internal and visual/accessibility evidence at every applicable slice |
| Legal review is treated as a one-time universal approval | Enables unsupported jurisdictions or providers | Make review provider-, account-, purpose-, and jurisdiction-specific and repeat it when material facts change |

## Unresolved legal and product assumptions

These assumptions must be resolved in specs/design/tasks or at the named release gate; this proposal does not silently decide them:

- Which Linux distributions, architectures, desktop environments, and accessibility baselines form the first support matrix.
- Whether the Node engine is packaged as a sidecar/runtime resource or replaced behind the Rust contract; either choice must preserve the webview boundary and bounded behavior.
- The exact authorized-file capability model and whether CLI/HTTP/MCP path inputs remain workspace-bound or move to short-lived capabilities.
- The full data-class taxonomy for minimization and pseudonymization, including names, addresses, identifiers, international amounts, line items, and free text.
- How a user reviews the full scope of outbound content without forcing unnecessary display or retention of sensitive text.
- Transaction expiry, replay policy, consent/audit retention, deletion/export semantics, and organization-admin policy needs.
- Which provider, model, task purpose, account terms, hosting region, and jurisdictions—if any—will be reviewed for the first external integration.
- The lawful basis and consent model for each intended deployment context; explicit product confirmation is necessary but may not itself be a sufficient legal basis.
- Controller/processor roles, required contracts, transfer mechanisms, impact assessments, sector rules, and whether separate consent is required in each target jurisdiction.
- Whether editing extracted fields is part of the first supported desktop release or a later product slice.
- Signing, update channel, telemetry policy, support-diagnostics contents, and release rollback service levels.

Until these assumptions are resolved, they must not be converted into public claims. In particular, no provider enablement or “compliant worldwide” statement is permitted.

## Proposal question round record

The proposal question round is considered answered for this phase by the user-approved decisions supplied with the delegated task: Rust-only desktop mediation, local deterministic default, one no-bypass external-LLM privacy contract, Linux-first support, incremental tested delivery, the defined first slice, and the 400-line chained-review budget.

The unresolved assumptions above remain explicit review items. They do not block writing the next specification, but provider enablement, packaging release, and jurisdictional claims remain blocked until their relevant decisions and qualified reviews are complete.

## Success criteria for the proposal phase

- The objective, current gap, users, outcomes, scope, non-goals, invariants, slices, acceptance signals, rollback, compatibility, risks, and assumptions are explicit.
- The first implementable slice is bounded to harness, Rust mediation, and deterministic local extraction.
- External LLM use is later, optional, fail-closed, and governed by a single content-bound contract without raw bypass.
- Linux-first support and the 400 changed-line chained delivery forecast are recorded.
- Regulatory sources are cited only as architectural rationale, with qualified jurisdiction/provider review required as a release gate.
- The next phase can derive RFC 2119 requirements and Given/When/Then scenarios without inventing product direction.
