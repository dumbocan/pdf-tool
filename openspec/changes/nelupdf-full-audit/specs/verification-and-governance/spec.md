# Verification and Governance Specification

## Purpose

Define evidence, strict-TDD, CI, adversarial testing, documentation, legal/provider gates, and dependency-ordered delivery requirements across all slices. Slice 1 establishes the missing test seams.

## Requirements

### Requirement: Slice 1 Test Seams and Strict TDD

**Delivery:** Slice 1
**Depends on:** None
**Traceability:** Proposal first implementable slice and invariant 14; findings TST-01, TST-02, TST-07.

Before Slice 1 product behavior is implemented, executable test seams MUST exist for the frontend, Rust boundary, and mediated engine contract. Every behavior change in this program MUST follow strict red-green-refactor TDD with a test that demonstrably fails for the missing or defective behavior before implementation. The known randomized Node baseline failure MUST be stabilized or explicitly isolated before a green baseline is used as regression evidence.

#### Scenario: Rust boundary behavior is introduced

- GIVEN the typed Rust boundary behavior does not yet exist
- WHEN Slice 1 implementation begins
- THEN an executable boundary test MUST first fail for the expected reason
- AND the implementation MUST not be accepted until that test and relevant regression tests pass

#### Scenario: Baseline randomized test remains unstable

- GIVEN the known pseudonymization test can fail without a product regression
- WHEN slice evidence is evaluated
- THEN it MUST NOT be counted as a trustworthy green baseline until stabilized or explicitly isolated
- AND any isolation MUST remain visible in the evidence and follow-up work

### Requirement: Evidence Per Applicable Slice

**Delivery:** All slices
**Depends on:** Slice 1 test seams
**Traceability:** Proposal invariants 14 and 15; program acceptance.

Each slice MUST provide internal automated evidence for its requirements and visual/accessibility evidence for every affected user-facing state. Evidence MUST identify the exact tested behavior and platform context; implementation completion alone MUST NOT satisfy slice acceptance.

#### Scenario: Slice changes a user-visible error state

- GIVEN a slice changes an error state shown in the desktop
- WHEN the slice is evaluated for completion
- THEN automated behavior evidence MUST verify the typed state
- AND visual and accessibility evidence MUST verify its usable presentation

### Requirement: CI Covers Each Owned Runtime and Boundary

**Delivery:** Slice 1 baseline; expanded with each later slice
**Depends on:** Relevant test seams
**Traceability:** Proposal scope; findings TST-02 and TST-06.

CI MUST run the applicable Node, frontend, TypeScript, Rust/Tauri, boundary-integration, accessibility, security, and package checks for changed and release-critical behavior. Release CI MUST cover the declared Linux support matrix and MUST validate each dependency graph rather than relying on the root Node audit alone.

#### Scenario: Desktop boundary changes

- GIVEN a change affects the webview-to-Rust-to-engine contract
- WHEN CI evaluates the change
- THEN CI MUST execute tests for all affected sides of that contract
- AND a failure in any required side MUST block acceptance

### Requirement: No-Network and No-Raw-Egress Evidence

**Delivery:** Slice 1 no-network proof; Slice 3 no-raw-egress proof
**Depends on:** Slice 1 local workflow; Slice 3 privacy transaction
**Traceability:** Proposal outcomes 2 and 3; invariants 3 through 7; findings DEF-01, ARC-04, SEC-04.

Automated tests MUST prove deterministic extraction performs no external network access. When Slice 3 is introduced, captured or controlled provider-bound requests MUST prove that desktop, CLI, HTTP, and MCP can send only the exact confirmed minimized and pseudonymized payload and that raw or unconfirmed paths fail closed.

#### Scenario: Deterministic workflow runs under network denial

- GIVEN external network access is denied and no provider transaction is confirmed
- WHEN deterministic extraction runs through each applicable supported interface
- THEN it MUST complete without an external request
- AND any attempted provider egress MUST fail the test

#### Scenario: Supported interfaces attempt raw LLM access

- GIVEN test inputs contain detectable raw sensitive markers
- WHEN desktop, CLI, HTTP, and MCP external paths are exercised
- THEN captured provider requests MUST contain only the exact confirmed transformed payload
- AND any raw, changed, or unconfirmed egress MUST fail the suite

### Requirement: Adversarial Boundary and Resource Tests

**Delivery:** Slice 2 and maintained thereafter
**Depends on:** Engine lifecycle, document authority, and bounded extraction
**Traceability:** Proposal program acceptance; findings SEC-01, SEC-03, SEC-08, TST-03, TST-04.

Automated tests MUST cover hostile or stale engine identity, endpoint collision, trusted and untrusted HTTP origin handling, CORS authority, the absence of origin-based desktop arbitrary-path or document access after Rust mediation, unauthorized and escaping paths, malformed and oversized PDFs, OCR page/time/concurrency/temp-storage/output bounds, cancellation, untrusted engine responses, sensitive logging, and cleanup after failure. Tests MUST assert observable outcomes rather than implementation call sequences.

#### Scenario: Adversarial OCR fixture exceeds a resource bound

- GIVEN a controlled scanned-PDF fixture is designed to exceed one documented OCR bound
- WHEN OCR is exercised
- THEN the corresponding typed bounded failure MUST occur within the test bound
- AND temporary resources MUST be cleaned without external network access

#### Scenario: Origin authority regression is challenged

- GIVEN security tests represent trusted, untrusted, missing, opaque, and `null` web origins and arbitrary path or document requests
- WHEN every local HTTP surface reachable in the desktop environment is exercised
- THEN unsupported origins MUST be rejected before engine or document authority is granted
- AND the tests MUST prove that the Rust-mediated production desktop exposes no origin-based HTTP route for arbitrary path or document access

### Requirement: Privacy Transaction Adversarial Tests

**Delivery:** Slice 3
**Depends on:** Unified privacy transaction
**Traceability:** Proposal program acceptance; findings ARC-03, DEF-04, SEC-05, TST-05.

Automated cross-interface tests MUST reject changed document identity, changed payload, changed provider, changed model, expiry, replay, concurrent duplicate confirmation, and direct unpreviewed confirmation. Tests MUST cover data-class and international-format policy limits, exact reverse-map membership, provider response validation, content-free audit evidence, and local fallback when any gate fails.

#### Scenario: Every bound attribute is mutated independently

- GIVEN a valid prepared transaction
- WHEN each bound attribute is changed in an otherwise valid confirmation
- THEN every changed case MUST be rejected before provider invocation
- AND the original local result MUST remain available

### Requirement: Visual and Accessibility Verification Matrix

**Delivery:** Slice 1 for touched states; expanded in Slices 3 and 4
**Depends on:** Applicable desktop UI
**Traceability:** Proposal invariant 14; findings UX-01 through UX-06.

The verification matrix MUST cover keyboard operation, focus order and restoration, modal behavior, status announcements, non-color state communication, text scaling, narrow and standard viewports, empty/loading/partial/error/success states, duplicate names, and supported Linux accessibility conditions. Automated accessibility checks SHOULD be combined with documented visual and assistive-technology verification where automation is insufficient.

#### Scenario: Consent and failure states are release candidates

- GIVEN a release candidate includes privacy consent and typed recovery UI
- WHEN accessibility and visual verification runs
- THEN keyboard, focus, announcement, viewport, and non-color requirements MUST be evidenced
- AND unresolved critical accessibility failures MUST block the affected release

### Requirement: Package, Install, Upgrade, and Rollback Evidence

**Delivery:** Slice 5
**Depends on:** Linux release specification
**Traceability:** Proposal program acceptance; findings ARC-07 and TST-06.

Release CI or controlled release verification MUST prove package integrity, clean installation, first launch, trusted engine readiness, local extraction, shutdown, supported upgrade, and rollback across the declared Linux matrix. Evidence MUST identify exact artifacts and MUST NOT infer support from compilation alone.

#### Scenario: Linux release candidate is promoted

- GIVEN a signed or otherwise integrity-verifiable release candidate exists
- WHEN release qualification runs on each supported matrix entry
- THEN installation, first launch, local extraction, shutdown, and rollback checks MUST pass
- AND failures MUST block promotion for the affected support claim

### Requirement: Documentation Truthfulness Gate

**Delivery:** Updated in every applicable slice; comprehensive by Slice 5
**Depends on:** Verified behavior
**Traceability:** Proposal outcome 7 and invariant 15; findings DOC-01 through DOC-07.

Privacy, security, installation, troubleshooting, platform, test-count, and product documentation MUST match verified runtime behavior and current evidence. Roadmap behavior MUST be labeled as planned, generated evidence SHOULD be used where feasible, and pseudonymization MUST NOT be described as anonymity. Documentation MUST NOT claim worldwide compliance, complete legal approval, unsupported platforms, or provider guarantees beyond dated reviewed facts.

#### Scenario: Documentation claims a protection not covered by tests

- GIVEN documentation states that a data class is pseudonymized or a platform is supported
- WHEN release documentation is checked against evidence
- THEN the claim MUST be backed by current transformation or platform qualification evidence
- OR it MUST be corrected or qualified before release

### Requirement: Qualified Provider and Jurisdiction Review Evidence

**Delivery:** Slice 6
**Depends on:** Slices 3 and 5
**Traceability:** Proposal regulatory rationale and invariant 9.

Provider release evidence MUST include a qualified, dated, provider-, account-, model-, purpose-, and jurisdiction-specific review covering the legal and policy topics defined by the privacy specification. This review is a release gate, not a software test or legal certification. Missing, inconclusive, stale, or materially inapplicable evidence MUST block provider enablement only, while preserving local extraction.

#### Scenario: Release targets an additional jurisdiction

- GIVEN a provider was reviewed for one set of release jurisdictions
- WHEN a new jurisdiction is added
- THEN provider enablement for that jurisdiction MUST remain blocked until qualified review covers it
- AND existing local deterministic functionality MUST remain available

### Requirement: Dependency-Ordered Chained Delivery Budget

**Delivery:** All slices
**Depends on:** Proposal-approved slice order
**Traceability:** Proposal release slices, outcome 6, and 400-line delivery constraint.

Implementation MUST be delivered in dependency order: Slice 1 boundary and harness; Slice 2 lifecycle, document authority, and operational bounds; Slice 3 privacy transaction; Slice 4 desktop reliability and accessibility; Slice 5 Linux packaging; Slice 6 provider enablement. Each review slice SHOULD forecast no more than 400 changed lines; a forecast above that budget MUST be subdivided before apply where feasible. Unrelated trust-boundary, privacy, UX, and release concerns MUST NOT be combined merely to reduce the number of reviews.

#### Scenario: Planned slice exceeds the review budget

- GIVEN a task forecast exceeds 400 changed lines
- WHEN work is prepared for apply
- THEN the task plan MUST subdivide it along dependency-coherent boundaries where feasible
- AND implementation MUST NOT rely on an unreviewed broad exception by default

#### Scenario: Later slice is ready before its dependency

- GIVEN Slice 3 privacy work is proposed before required Slice 1 or Slice 2 contracts are verified
- WHEN delivery readiness is evaluated
- THEN the later slice MUST remain blocked
- AND the dependency MUST be completed or explicitly re-specified first

### Requirement: Candidate Scope and Unrelated User Work Preservation

**Delivery:** All slices
**Depends on:** Declared bounded slice scope
**Traceability:** Proposal first-slice acceptance, non-goals, and risk mitigation for pre-existing tracked and untracked work.

Before and after each bounded slice, delivery evidence MUST identify the intended candidate paths and compare them with the pre-existing tracked and untracked repository state. A slice MUST NOT delete, overwrite, stage, revert, or otherwise modify unrelated pre-existing user work. Candidate scope drift MUST block slice acceptance until the candidate is corrected or the scope is explicitly re-approved.

#### Scenario: Repository contains unrelated pre-existing work

- GIVEN tracked or untracked user work outside the declared slice exists before work begins
- WHEN the bounded slice candidate is prepared for acceptance
- THEN scope evidence MUST show that only declared candidate paths and modes changed for the slice
- AND unrelated pre-existing work MUST remain intact, with any detected drift blocking acceptance
