# Desktop Boundary Specification

## Purpose

Define the trusted desktop boundary through which the NeluPDF webview accesses local engine behavior without acquiring engine transport authority. This domain establishes Slice 1 of the approved program.

## Requirements

### Requirement: Typed Rust-Mediated Engine Operations

**Delivery:** Slice 1
**Depends on:** None
**Traceability:** Proposal outcomes 1 and 6; invariants 1, 2, and 10; findings ARC-01, ARC-02, ARC-05, DEF-03, SEC-01.

The desktop application MUST expose a typed webview-to-Rust contract for every desktop engine operation. Rust MUST validate inputs and engine responses at the boundary and MUST return a versioned success or typed failure result without exposing internal stack details.

#### Scenario: Deterministic extraction crosses the trusted boundary

- GIVEN the desktop has a user-authorized PDF
- WHEN the webview requests deterministic extraction
- THEN the request MUST be made through the typed Rust contract
- AND the webview MUST receive a typed result whose protocol version is supported

#### Scenario: Engine response violates the contract

- GIVEN the mediated engine returns an unknown or invalid response shape
- WHEN Rust validates the response
- THEN Rust MUST reject it as a protocol mismatch
- AND the webview MUST NOT receive the unvalidated response as a successful result

### Requirement: No Webview Engine Transport Authority

**Delivery:** Slice 1
**Depends on:** Typed Rust-mediated engine operations
**Traceability:** Proposal outcome 1; invariants 1 and 2; findings ARC-02, DEF-03, SEC-01.

Production webview code and configuration MUST NOT contain, derive, select, or receive an engine URL, loopback port, bearer token, launch secret, or equivalent engine credential. The product MUST NOT provide a direct webview-to-engine compatibility fallback.

#### Scenario: Production desktop extraction

- GIVEN a production desktop build
- WHEN a user performs local extraction
- THEN no webview request MUST be sent directly to an engine network endpoint
- AND no engine credential MUST be observable in webview state, configuration, logs, or messages

#### Scenario: Rust mediation is unavailable

- GIVEN the typed Rust boundary cannot serve a request
- WHEN the webview requests extraction
- THEN the request MUST fail with a typed unavailable state
- AND the webview MUST NOT fall back to direct loopback access

### Requirement: Origin Cannot Confer Desktop Authority

**Delivery:** Slice 1 elimination; maintained in Slice 2 authority hardening
**Depends on:** Typed Rust-mediated engine operations; document authority contract
**Traceability:** Proposal program acceptance for origin/path authority; invariants 1, 2, and 10; current-state permissive CORS and path-reading exposure.

The production desktop MUST eliminate origin-based HTTP as a source of engine or document authority. An HTTP `Origin` value or successful CORS exchange MUST NOT by itself authorize engine use, filesystem paths, or document access. Any transitional origin-based HTTP surface that remains supported MUST allow only an explicit trusted-origin set, MUST reject missing, opaque, `null`, or untrusted origins before an engine or document operation, and MUST independently authenticate and authorize every request. After Rust mediation is active, the desktop MUST NOT expose an origin-based HTTP route that can select or read an arbitrary path or document.

#### Scenario: Untrusted web origin requests local document access

- GIVEN an untrusted, missing, opaque, or `null` web origin targets a local HTTP surface reachable in the desktop environment
- WHEN it requests extraction, an arbitrary path, or document access
- THEN the request MUST be rejected before any document is read or engine operation is authorized
- AND the response MUST NOT grant that origin CORS authority or disclose sensitive path information

#### Scenario: Rust-mediated desktop exposes no origin-based path route

- GIVEN a production desktop build has migrated engine and document operations to the typed Rust boundary
- WHEN its webview-reachable HTTP surfaces are exercised with arbitrary paths and document references
- THEN no origin-based HTTP route MUST authorize or read a document
- AND document access MUST remain reachable only through the typed Rust contract using shell-issued authority

### Requirement: Boundary Operation States

**Delivery:** Slice 1
**Depends on:** Typed Rust-mediated engine operations
**Traceability:** Proposal first-slice acceptance signals; invariants 10 and 15; findings ARC-05 and ARC-08.

The desktop boundary MUST distinguish readiness, operation-in-progress, deterministic success, invalid input, engine unavailable, protocol mismatch, timeout, cancellation, and bounded-resource failure states. Failure results MUST be safe for display and MUST NOT disclose credentials, sensitive paths, document content, or internal stack traces.

#### Scenario: Engine is unavailable

- GIVEN no trusted engine is ready
- WHEN the webview requests extraction
- THEN the boundary MUST return the typed engine-unavailable state
- AND the result MUST include a safe recovery category rather than raw process or transport details

#### Scenario: User cancels an operation

- GIVEN a mediated extraction is in progress
- WHEN cancellation is accepted
- THEN the operation MUST terminate with the typed cancelled state
- AND a late engine response MUST NOT be reported as success for that operation

### Requirement: Local-Only Desktop Core

**Delivery:** Slice 1
**Depends on:** Typed Rust-mediated engine operations
**Traceability:** Proposal outcomes 1 and 2; invariants 3 and 4; findings TST-01 and existing no-network control.

The Rust-mediated deterministic desktop workflow MUST complete without external network access. Opening a document, checking readiness, extracting deterministically, retrying local work, or rendering a result MUST NOT trigger an external provider call.

#### Scenario: Desktop operates with external network denied

- GIVEN the trusted local engine is available and external network access is denied
- WHEN a user selects a valid supported PDF and requests deterministic extraction
- THEN extraction MUST complete through Rust mediation
- AND no external network request MUST be attempted

### Requirement: Additive Consumer Migration

**Delivery:** Slice 1
**Depends on:** Typed Rust-mediated engine operations
**Traceability:** Proposal invariant 13; rollback and compatibility implications.

The migration to Rust mediation MUST preserve supported deterministic result meaning where compatible with the trust boundary. Existing direct webview engine transport MUST be removed or made non-operational; rollback MUST revert the affected slice rather than restore direct webview transport.

#### Scenario: Legacy desktop transport setting is present

- GIVEN a legacy engine URL setting exists in the environment or build configuration
- WHEN the migrated desktop starts
- THEN the webview MUST NOT use that setting for engine access
- AND deterministic behavior MUST be available only through the supported Rust contract
