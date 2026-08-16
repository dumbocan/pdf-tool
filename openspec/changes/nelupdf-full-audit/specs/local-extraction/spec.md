# Local Extraction Specification

## Purpose

Preserve bounded deterministic PDF extraction as the safe, local default in Slice 1 and add explicit OCR and operational limits in Slice 2.

## Requirements

### Requirement: Deterministic Local Extraction Is the Default

**Delivery:** Slice 1
**Depends on:** Slice 1 desktop boundary for desktop use
**Traceability:** Proposal outcomes 1, 2, and 5; invariants 3, 4, and 9; existing no-network control.

Desktop, CLI, HTTP, and MCP MUST provide deterministic extraction as the default supported behavior. Deterministic extraction MUST NOT require provider configuration, provider availability, user consent to external processing, or external network access.

#### Scenario: Provider support is unavailable

- GIVEN external provider support is disabled, declined, offline, misconfigured, or unapproved
- WHEN a user requests deterministic extraction of a valid supported PDF
- THEN local extraction MUST remain available
- AND no provider request MUST be attempted

### Requirement: Bounded Deterministic Inputs and Outputs

**Delivery:** Slice 1
**Depends on:** None for engine interfaces; desktop use depends on desktop boundary
**Traceability:** Proposal invariants 10 and 11; findings DEF-06 and SEC-08.

The system MUST enforce documented ceilings for decoded PDF bytes, request bytes, page count, per-page text, total extracted text, and response size. Effective transport limits MUST permit the documented decoded PDF maximum or the public limit MUST state the lower effective maximum. A limit breach MUST produce a deterministic typed failure before uncontrolled resource use.

#### Scenario: PDF exceeds a documented limit

- GIVEN a PDF exceeds a documented extraction limit
- WHEN deterministic extraction is requested
- THEN the system MUST return the corresponding typed bounded-resource failure
- AND it MUST NOT return a partial result as an unqualified full success

#### Scenario: Transport and decoded-size limits differ

- GIVEN request encoding adds overhead to a PDF at the documented decoded-size maximum
- WHEN the request is accepted through a supported transport
- THEN the effective transport contract MUST either accept it within its documented overhead policy
- OR MUST clearly expose the lower effective input limit before processing

### Requirement: Deterministic Result Provenance and Partial Status

**Delivery:** Slice 1
**Depends on:** Bounded deterministic inputs and outputs
**Traceability:** Proposal first-slice acceptance; invariants 10 and 15.

A successful deterministic result MUST identify its local deterministic provenance and MUST distinguish complete, truncated, partial, and OCR-derived outcomes where applicable. Untrusted document content MUST NOT be treated as instructions or trusted markup.

#### Scenario: Text is truncated by a configured bound

- GIVEN extraction reaches a documented text limit
- WHEN a bounded result can still be produced
- THEN the result MUST be marked truncated or partial
- AND the desktop MUST NOT present it as a complete extraction

### Requirement: Typed Extraction Failures

**Delivery:** Slice 1 core states; Slice 2 OCR-specific states
**Depends on:** Bounded deterministic inputs and outputs
**Traceability:** Proposal first-slice signals; finding ARC-08.

Extraction MUST distinguish at least invalid PDF, input too large, page limit, unavailable engine, protocol mismatch, timeout, cancellation, OCR unavailable, OCR bounded-resource failure, and internal failure. Consumer-facing failures MUST include a stable category and safe actionable meaning without document content, credentials, stack traces, or unnecessary local paths.

#### Scenario: Malformed PDF is submitted

- GIVEN an authorized input is malformed or unsupported
- WHEN extraction is attempted
- THEN the system MUST return the typed invalid-PDF state
- AND the result MUST NOT include a parser stack trace

#### Scenario: OCR dependency is unavailable

- GIVEN a scanned PDF requires OCR but the required local OCR capability is unavailable
- WHEN extraction reaches the OCR decision
- THEN the system MUST return the typed OCR-unavailable or partial state defined by the contract
- AND it MUST NOT silently invoke an external service

### Requirement: Bounded OCR

**Delivery:** Slice 2
**Depends on:** Slice 2 lifecycle and document authority
**Traceability:** Proposal invariant 11; findings SEC-03 and TST-04.

Before OCR is release-exposed, it MUST enforce documented limits for pages rendered, elapsed time, concurrent OCR jobs, CPU or work budget, temporary storage, generated image/output size, and retained text. Temporary artifacts MUST be removed on success, failure, timeout, and cancellation.

#### Scenario: Scanned PDF exceeds the OCR page bound

- GIVEN a scanned PDF requires more pages than the documented OCR limit
- WHEN OCR is requested
- THEN OCR MUST stop at or before the limit
- AND the result MUST be a typed bounded-resource failure or explicitly partial result

#### Scenario: OCR times out

- GIVEN OCR exceeds its documented elapsed-time bound
- WHEN the timeout is reached
- THEN OCR MUST be cancelled or terminated
- AND its temporary artifacts MUST be removed according to the documented lifetime contract

### Requirement: End-to-End Cancellation

**Delivery:** Slice 2
**Depends on:** Slice 2 lifecycle and document authority
**Traceability:** Proposal invariants 11 and 12; findings ARC-08 and UX-05.

A supported cancellation request MUST propagate across the consumer boundary, shell supervision, extraction, OCR, and temporary-resource cleanup. Cancellation MUST be idempotent and MUST leave the document eligible for a deliberate new local request.

#### Scenario: User cancels during OCR

- GIVEN OCR is processing an authorized document
- WHEN the user cancels the operation
- THEN the operation MUST reach a typed cancelled state within a documented bound
- AND no late success result MUST replace that state

### Requirement: Deterministic Cross-Interface Compatibility and Versioned Security Migration

**Delivery:** Introduced in Slice 1 and maintained in every affected slice
**Depends on:** Deterministic local extraction is the default; applicable document-authority and privacy contracts
**Traceability:** Proposal invariant 13 and rollback and compatibility implications.

Supported CLI, HTTP, and MCP deterministic local operations MUST preserve documented request acceptance and result meaning through additive changes whenever the existing behavior satisfies the current authority, privacy, and resource invariants. When security or privacy requires a breaking change, the affected interface MUST expose an explicit versioned transition with a stable typed deprecation or error result and migration guidance to the safe contract. It MUST NOT silently reinterpret requests, coerce incompatible results, fall back to external processing, or keep a raw or direct LLM path operational for compatibility.

#### Scenario: Safe deterministic consumer remains compatible

- GIVEN a supported CLI, HTTP, or MCP consumer uses a documented deterministic operation that satisfies the current security and privacy invariants
- WHEN an affected release processes the same valid local input
- THEN request acceptance and deterministic result meaning MUST remain compatible or change only through a documented additive versioned contract
- AND no external provider request MUST occur

#### Scenario: Security-required break is explicit

- GIVEN an existing CLI, HTTP, or MCP request relies on an unsafe authority or obsolete contract
- WHEN a secured release can no longer honor that request safely
- THEN the interface MUST return the documented versioned deprecation or typed error with migration guidance
- AND it MUST NOT silently process the request, transmit raw document content, or route it to an external LLM

### Requirement: Offline Invariant

**Delivery:** Slice 1 and all later slices
**Depends on:** Deterministic local extraction is the default
**Traceability:** Proposal outcomes 2 and 5; invariants 3, 4, and 9.

Core local extraction MUST remain functional with external networking blocked. No later privacy, desktop, packaging, or provider slice MAY weaken this invariant.

#### Scenario: External network is denied after later features are installed

- GIVEN a build includes optional external-provider features but external networking is blocked
- WHEN a user performs deterministic extraction
- THEN the operation MUST complete locally subject only to local capabilities and bounds
- AND provider unavailability MUST NOT convert local extraction into a failure
