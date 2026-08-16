# Linux Release Specification

## Purpose

Define Slice 5 Linux-first packaging, hardening, integrity, update, rollback, support claims, and Slice 6 provider-release prerequisites without claiming unsupported platforms or legal certification.

## Requirements

### Requirement: Self-Contained Linux Package

**Delivery:** Slice 5
**Depends on:** Slices 1 through 4
**Traceability:** Proposal outcomes 1 and 7; invariant 15; findings ARC-01 and ARC-07.

The first supported release MUST provide a Linux package that includes or declares every runtime resource required for the approved local workflow, including the trusted engine and any release-exposed OCR capabilities. Installation, first launch, deterministic extraction, and shutdown MUST NOT require the user to manually start or authenticate a separate engine service.

#### Scenario: Fresh supported Linux installation

- GIVEN a clean environment in the declared Linux support matrix
- WHEN the user installs and first launches NeluPDF
- THEN the shell MUST establish its trusted local engine without manual server setup
- AND a valid supported PDF MUST be extractable locally subject to documented capabilities

### Requirement: Explicit Platform Support Matrix

**Delivery:** Slice 5
**Depends on:** Self-contained Linux package
**Traceability:** Proposal primary platform, non-goals, and unresolved assumptions; finding ARC-07.

Release documentation MUST identify the tested Linux distributions, versions, architectures, desktop environments, display/session constraints, accessibility baseline, and OCR availability for the release. macOS, Windows, and unqualified Linux variants MUST NOT be described as supported solely because build configuration contains cross-target entries.

#### Scenario: Platform is not in the qualified matrix

- GIVEN a platform can be built but has no release qualification evidence
- WHEN support claims are published
- THEN that platform MUST be labeled unsupported, experimental, or unqualified as applicable
- AND it MUST NOT be presented as officially supported

### Requirement: Least-Privilege CSP and Desktop Capabilities

**Delivery:** Slice 5, with relevant hardening introduced earlier when touched
**Depends on:** Stable desktop boundary and feature inventory
**Traceability:** Proposal invariants 1, 4, and 10; finding SEC-02.

Production desktop builds MUST enforce a restrictive Content Security Policy and MUST grant only the Tauri/plugin capabilities required by verified product behavior. External network destinations MUST be denied by default and allowed only for an enabled, reviewed provider path. Unused opener or equivalent broad capabilities MUST NOT remain enabled.

#### Scenario: Webview attempts an undeclared external connection

- GIVEN a production desktop build
- WHEN webview content attempts to connect to an undeclared external destination
- THEN the connection MUST be blocked by the effective policy
- AND local deterministic extraction MUST remain unaffected

### Requirement: Artifact Integrity and Provenance

**Delivery:** Slice 5
**Depends on:** Self-contained Linux package
**Traceability:** Proposal scope and program acceptance; finding DOC-06.

Promoted installers, packages, engine resources, OCR resources, and update metadata MUST have verifiable integrity and release provenance. Installation instructions MUST use pinned release artifacts and MUST provide a verification path before privileged or executable actions. Mutable remote scripts MUST NOT be the sole promoted installation mechanism.

#### Scenario: User obtains a promoted installer

- GIVEN a user downloads a release artifact through the documented channel
- WHEN the user follows the documented verification procedure
- THEN the artifact's integrity and release identity MUST be verifiable before installation
- AND a mismatch MUST block the supported installation path

### Requirement: Signing and Update Policy

**Delivery:** Slice 5
**Depends on:** Artifact integrity and provenance
**Traceability:** Proposal unresolved assumptions and rollback strategy.

Before automatic or in-application updates are enabled, the release MUST define trusted signing identity, update channels, metadata authenticity, downgrade policy, failure handling, and supported recovery. If those controls are absent, automatic updates MUST remain disabled and documentation MUST state the supported manual update path.

#### Scenario: Update metadata fails authenticity validation

- GIVEN an installed application checks for an update
- WHEN update metadata or artifact signature cannot be validated
- THEN the update MUST be rejected
- AND the existing local deterministic installation MUST remain usable when otherwise healthy

### Requirement: Verified Upgrade and Rollback

**Delivery:** Slice 5
**Depends on:** Signing and update policy
**Traceability:** Proposal outcome 6 and rollback strategy; finding ARC-07.

A release MUST define and verify rollback behavior for package installation and any enabled updater. Failed upgrade or rollback MUST preserve user-controlled source PDFs and MUST not restore direct webview engine transport or a raw LLM bypass.

#### Scenario: Upgrade cannot start the trusted engine

- GIVEN an update installs but the new trusted engine cannot become ready
- WHEN rollback is initiated under the supported procedure
- THEN the previously supported local deterministic version MUST be recoverable according to the documented policy
- AND user source PDFs MUST remain unmodified

### Requirement: Release Diagnostics and Sensitive Logging Policy

**Delivery:** Slice 5
**Depends on:** Slices 2 and 4
**Traceability:** Proposal invariant 12 and support-user outcome; findings ARC-06 and SEC-07.

Packaged builds MUST define diagnostic collection, retention, redaction, user access, and deletion behavior. Routine logs MUST exclude document contents, transformed payloads, mappings, credentials, and sensitive local paths. Telemetry, if proposed later, MUST remain disabled until separately specified and approved.

#### Scenario: Packaged engine fails during startup

- GIVEN a packaged engine fails before readiness
- WHEN diagnostics are recorded
- THEN logs MUST contain a bounded safe failure category and version context
- AND they MUST exclude credentials, document content, and sensitive path values

### Requirement: Provider Enablement Depends on Release Qualification

**Delivery:** Slice 6
**Depends on:** Slices 3 and 5
**Traceability:** Proposal provider enablement slice and invariant 9.

A provider MAY be enabled only in a release whose package, security controls, diagnostics, platform claims, privacy transaction, and provider/jurisdiction review gates have passed for the intended configuration. Technical availability alone MUST NOT enable the provider.

#### Scenario: Privacy transaction passes but package qualification does not

- GIVEN a provider flow passes transaction tests but the target Linux release lacks required security or packaging evidence
- WHEN provider enablement is evaluated
- THEN the provider MUST remain disabled for that release
- AND local deterministic functionality MUST remain available
