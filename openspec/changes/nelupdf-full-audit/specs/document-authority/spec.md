# Document Authority Specification

## Purpose

Define how user-selected PDFs become bounded, authorized document capabilities without exposing arbitrary filesystem authority. Baseline selection participates in Slice 1; full capability and parity hardening belongs to Slice 2.

## Requirements

### Requirement: User-Authorized Document Capability

**Delivery:** Slice 1 baseline; Slice 2 hardening
**Depends on:** Slice 1 desktop boundary; full hardening depends on Slice 2 lifecycle
**Traceability:** Proposal scope and invariants 1, 2, and 10; findings SEC-01, SEC-08, ARC-06.

A desktop document operation MUST use authority derived from an explicit user file selection or native drop accepted by the shell. The webview MUST receive only an opaque document reference and display-safe metadata, not a reusable arbitrary-path capability. Authorization MUST be limited to the selected document and intended operation scope.

#### Scenario: User selects a PDF through the file dialog

- GIVEN the user explicitly selects a supported PDF
- WHEN the shell authorizes the selection
- THEN the webview MUST receive an opaque document reference suitable for the supported operation
- AND the reference MUST NOT authorize a different filesystem path

#### Scenario: Webview supplies an arbitrary path

- GIVEN the webview submits a path that was not authorized by the shell
- WHEN a document operation is requested
- THEN the boundary MUST reject it with a typed unauthorized-document state
- AND the engine MUST NOT read the path

### Requirement: Capability Scope, Expiry, and Revocation

**Delivery:** Slice 2
**Depends on:** User-authorized document capability and shell-owned engine identity
**Traceability:** Proposal invariant 12; findings SEC-01 and ARC-06.

A document capability MUST be scoped, non-forgeable at the consumer boundary, and invalid after its documented expiry, explicit removal, application clear/reset, or desktop session end. The system MUST reject replay outside the capability's allowed operation or lifetime.

#### Scenario: Cleared document is reused

- GIVEN a user clears a document from the desktop session
- WHEN an old opaque reference is submitted again
- THEN the system MUST reject it as revoked
- AND no document bytes MUST be read for that request

#### Scenario: Capability is used for another document

- GIVEN a capability was issued for document A
- WHEN it is presented as authority for document B
- THEN the system MUST reject the request
- AND document B MUST remain unread

### Requirement: File-Dialog and Native-Drop Parity

**Delivery:** Slice 2
**Depends on:** User-authorized document capability
**Traceability:** Proposal program acceptance; findings DEF-02 and UX-07.

File-dialog selection and native drag-and-drop MUST produce equivalent authorization, validation, deterministic extraction, cancellation, retention, and later privacy-transaction eligibility. Platform path syntax MUST NOT change the behavior of an otherwise equivalent authorized document.

#### Scenario: Same document enters through both supported gestures

- GIVEN the same valid PDF is selected once by file dialog and once by native drop
- WHEN deterministic extraction is requested for each
- THEN both flows MUST enforce the same document validation and authority rules
- AND both MUST expose equivalent typed outcomes

### Requirement: Restricted Non-Desktop Path Inputs

**Delivery:** Slice 2
**Depends on:** Document authority policy
**Traceability:** Proposal compatibility implications and invariant 10; findings SEC-01 and SEC-08.

Supported CLI, HTTP, and MCP path inputs MUST be restricted to an explicitly authorized workspace or an equivalent bounded capability. A general unauthenticated arbitrary-path read interface MUST NOT remain operational. Security-driven narrowing MUST include observable deprecation or migration behavior for affected consumers.

#### Scenario: Path escapes an authorized workspace

- GIVEN an interface accepts paths within an authorized workspace
- WHEN a caller submits a path that resolves outside that workspace
- THEN the request MUST be rejected before file contents are read
- AND the failure MUST identify the authority violation without exposing sensitive path details

### Requirement: Validation Before Unbounded Read

**Delivery:** Slice 2
**Depends on:** User-authorized document capability
**Traceability:** Proposal invariants 10 and 11; findings SEC-08 and DEF-06.

The system MUST validate authorization and enforce documented input bounds without first loading an unbounded target into memory. File extension alone MUST NOT establish that an input is a valid PDF.

#### Scenario: Authorized target exceeds the input bound

- GIVEN an authorized target exceeds the documented PDF byte limit
- WHEN extraction is requested
- THEN the system MUST reject it with a typed input-too-large state
- AND it MUST NOT fully load the oversized target before enforcing the bound

#### Scenario: Non-PDF content has a PDF filename

- GIVEN an authorized file has a PDF extension but invalid PDF content
- WHEN extraction is requested
- THEN the system MUST reject it as invalid input
- AND the failure MUST NOT expose raw parser internals

### Requirement: Duplicate-Safe Document Identity

**Delivery:** Slice 4
**Depends on:** Slice 2 document capability
**Traceability:** Proposal program acceptance; finding DEF-09.

Each selected document MUST have a stable session identity independent of basename, display label, list position, or platform path format. Results, cancellation, removal, export selection, and privacy actions MUST target exactly that identity.

#### Scenario: Two documents share a basename

- GIVEN two different authorized PDFs have the same basename
- WHEN both are processed in one desktop session
- THEN the system MUST keep their state and results distinct
- AND an action on one document MUST NOT update or remove the other
