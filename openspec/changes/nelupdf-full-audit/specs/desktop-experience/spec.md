# Desktop Experience Specification

## Purpose

Define Slice 4 desktop reliability, data lifetime, export safety, accessibility, responsive behavior, recovery, and support diagnostics. Privacy-dialog portions depend on Slice 3.

## Requirements

### Requirement: Explicit Desktop Data Lifetime Controls

**Delivery:** Slice 4
**Depends on:** Slices 1 and 2
**Traceability:** Proposal invariants 12 and 15; findings ARC-06, SEC-07, UX-07.

The desktop MUST document and enforce the lifetime of document bytes, extracted text, transformed payloads, reverse mappings, display results, file metadata, and transaction state. Users MUST be able to remove one document and clear the session. Clear, removal, session end, failure, and cancellation MUST revoke applicable capabilities and release sensitive in-memory state according to that contract.

#### Scenario: User clears the session

- GIVEN one or more processed documents are displayed
- WHEN the user activates clear/reset
- THEN document capabilities and sensitive in-memory state MUST be released according to the documented lifetime
- AND cleared content MUST NOT remain available through ordinary UI recovery or logs

### Requirement: Safe and Well-Formed CSV Export

**Delivery:** Slice 4
**Depends on:** Deterministic result contract and duplicate-safe identity
**Traceability:** Proposal invariant 10; finding DEF-05.

CSV export MUST encode delimiters, quotes, line breaks, and character data correctly and MUST neutralize spreadsheet formula interpretation for cells beginning with formula-triggering content. Export MUST preserve explicit partial or uncertain result meaning and MUST NOT silently combine different document identities.

#### Scenario: Extracted cell begins with a formula trigger

- GIVEN an untrusted extracted or provider-derived cell begins with `=`, `+`, `-`, or `@`
- WHEN CSV is exported
- THEN the cell MUST be encoded so a supported spreadsheet does not execute it as a formula by default
- AND the underlying value MUST remain recoverable as data

#### Scenario: Cell contains quotes and line breaks

- GIVEN an exported value contains delimiters, quotes, or line breaks
- WHEN CSV is generated
- THEN the output MUST remain a valid CSV record
- AND adjacent columns and rows MUST not be corrupted

### Requirement: Accessible Interaction and Status

**Delivery:** Slice 4; privacy dialog behavior depends on Slice 3
**Depends on:** Slices 1 and 2; Slice 3 for consent UI
**Traceability:** Proposal invariant 14; findings UX-01, UX-02, UX-03, UX-06.

All supported document, extraction, cancellation, retry, clear, export, and privacy-confirmation actions MUST be operable by keyboard and conveyed to assistive technology. Dialogs MUST have an accessible name, modal semantics, focus entry and containment, Escape behavior where safe, and focus restoration. Progress and terminal states MUST be announced without relying only on color.

#### Scenario: Keyboard user selects and extracts a document

- GIVEN a user navigates without a pointer
- WHEN the user reaches the primary document control and activates it
- THEN the file selection flow MUST be available
- AND extraction, cancellation, and result status MUST be keyboard operable and programmatically conveyed

#### Scenario: Privacy dialog opens and closes

- GIVEN an external transaction disclosure is opened
- WHEN the dialog becomes active and is later cancelled
- THEN focus MUST enter and remain within the modal interaction while open
- AND focus MUST return to an appropriate triggering control after close

### Requirement: Responsive and Visually Stable States

**Delivery:** Slice 4
**Depends on:** Slice 1 typed boundary states
**Traceability:** Proposal invariant 14; finding UX-04.

The desktop MUST present selection, loading, progress, success, empty, partial, cancellation, and error states without clipped critical actions, unintended overlap, or dependence on a fixed wide viewport. The verified support matrix MUST include documented narrow and standard viewport sizes, text scaling, and relevant Linux desktop conditions.

#### Scenario: Results are viewed in a narrow window

- GIVEN multiple results include long filenames and actionable errors
- WHEN the application is displayed at the narrowest supported viewport and text scale
- THEN critical status and actions MUST remain reachable and understandable
- AND horizontal overflow MUST follow a documented usable strategy

### Requirement: Actionable Typed Recovery

**Delivery:** Slice 4
**Depends on:** Slices 1 and 2 typed failures
**Traceability:** Proposal outcomes 5 and 7; findings ARC-08 and UX-05.

For engine unavailable, protocol mismatch, invalid PDF, input limit, OCR unavailable, timeout, cancellation, offline provider, provider-disabled, and partial-result states, the desktop MUST show safe actionable guidance appropriate to the typed condition. Retry MUST require a deliberate action and MUST NOT silently repeat an external transaction.

#### Scenario: Local engine is unavailable

- GIVEN the shell reports a typed engine-unavailable state
- WHEN the desktop renders the failure
- THEN it MUST present a safe local recovery action or support path
- AND it MUST NOT expose credentials, raw process output, or a direct engine URL

#### Scenario: External request fails after local success

- GIVEN deterministic local extraction succeeded and an explicitly confirmed external request fails
- WHEN the failure is shown
- THEN the local result MUST remain available
- AND retry MUST require a new valid transaction when the original cannot safely be reused

### Requirement: Content-Free Support Diagnostics

**Delivery:** Slice 4; package integration in Slice 5
**Depends on:** Slices 1 and 2
**Traceability:** Proposal target support users and invariant 12; findings SEC-07 and ARC-08.

The desktop SHOULD provide exportable or copyable support diagnostics containing bounded version, lifecycle state, capability status, safe failure category, platform qualification, and opaque correlation data. Diagnostics MUST exclude document bytes or text, transformed payload text, credentials, exact mappings, and sensitive local paths unless a separately specified explicit disclosure flow is approved.

#### Scenario: User gathers diagnostics for a startup failure

- GIVEN engine startup failed
- WHEN the user requests support diagnostics
- THEN the diagnostics MUST include safe version and lifecycle evidence sufficient to distinguish major startup categories
- AND they MUST not include document content, credentials, or sensitive path values

### Requirement: Honest User-Facing Claims

**Delivery:** Slice 4 and maintained in later slices
**Depends on:** Verified behavior of each applicable slice
**Traceability:** Proposal invariant 15; findings DOC-04 and DOC-05.

Desktop copy MUST distinguish verified current behavior from planned behavior and MUST NOT claim editability, confidence, privacy protection, platform support, packaging completeness, or legal compliance beyond available evidence.

#### Scenario: A planned capability is not implemented

- GIVEN product material describes a capability that is not verified in the current build
- WHEN the desktop or bundled help presents that capability
- THEN it MUST be labeled as unavailable or planned rather than current behavior
- AND release acceptance MUST reject contradictory claims
