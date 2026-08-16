# Engine Lifecycle Specification

## Purpose

Define shell-owned engine identity, lifecycle, readiness, recovery, and shutdown behavior for Slice 2 while preserving the Rust boundary established in Slice 1.

## Requirements

### Requirement: Shell-Owned Engine Identity and Authority

**Delivery:** Slice 2
**Depends on:** Slice 1 desktop boundary
**Traceability:** Proposal invariants 1 and 2; findings ARC-01, ARC-02, DEF-03, SEC-01.

The Rust shell MUST establish and verify the identity and authority of the engine used for desktop operations. A process merely responding at a loopback address or expected route MUST NOT be trusted as the desktop engine. Engine endpoint selection and credentials MUST remain shell-owned.

#### Scenario: Unrelated process occupies an expected endpoint

- GIVEN an unrelated or stale process responds at a candidate local endpoint
- WHEN the shell evaluates engine readiness
- THEN the shell MUST reject that process as untrusted
- AND no document operation MUST be sent to it

### Requirement: Managed Startup and Readiness

**Delivery:** Slice 2
**Depends on:** Shell-owned engine identity and authority
**Traceability:** Proposal outcomes 1 and 5; invariants 2 and 11; findings ARC-01 and ARC-08.

The shell MUST own desktop engine startup and MUST expose readiness only after authenticated identity, supported protocol version, and required local capabilities are confirmed. Startup MUST be bounded and MUST distinguish not-started, starting, ready, incompatible, unavailable, and timed-out outcomes.

#### Scenario: Compatible engine becomes ready

- GIVEN the desktop application is starting
- WHEN the shell starts an engine that proves the expected identity, version, and capabilities within the startup bound
- THEN readiness MUST transition to ready
- AND mediated operations MAY be accepted

#### Scenario: Engine version is unsupported

- GIVEN an engine starts but reports an unsupported protocol version
- WHEN readiness is evaluated
- THEN readiness MUST transition to incompatible
- AND document operations MUST be rejected with a typed protocol-mismatch result

### Requirement: Bounded Request Supervision

**Delivery:** Slice 2
**Depends on:** Managed startup and readiness
**Traceability:** Proposal invariants 2 and 11; findings ARC-08, SEC-03, SEC-08.

The shell MUST supervise mediated engine requests with documented bounds for elapsed time, concurrency, and response size. A timed-out or cancelled request MUST stop consuming desktop request authority and MUST NOT later overwrite a terminal result.

#### Scenario: Request exceeds its elapsed-time bound

- GIVEN a trusted engine accepted a mediated request
- WHEN the request exceeds its documented time bound
- THEN the shell MUST return a typed timeout state
- AND any subsequent response for that request MUST be ignored as a successful completion

#### Scenario: Concurrency capacity is exhausted

- GIVEN the documented concurrent-operation limit is reached
- WHEN another request is submitted
- THEN the shell MUST reject or queue it according to the documented contract
- AND the outcome MUST be typed and deterministic

### Requirement: Crash Detection and Bounded Recovery

**Delivery:** Slice 2
**Depends on:** Managed startup and readiness
**Traceability:** Proposal outcome 5; invariants 11 and 15; findings ARC-01, ARC-08, UX-05.

The shell MUST detect loss of the trusted engine, invalidate its prior authority, and expose a typed unavailable state. Recovery MAY restart the engine only under a documented bounded policy and MUST establish a new verified identity before accepting work. Recovery MUST NOT silently repeat an external-provider action.

#### Scenario: Engine exits during local extraction

- GIVEN deterministic extraction is in progress
- WHEN the trusted engine exits unexpectedly
- THEN the operation MUST fail with a typed engine-lost state
- AND any recovered engine MUST pass identity and readiness checks before new work is accepted

#### Scenario: Recovery budget is exhausted

- GIVEN engine recovery has reached its documented attempt or time bound
- WHEN readiness is requested again
- THEN the shell MUST remain in a typed unavailable state
- AND the user MUST receive a safe actionable recovery path

### Requirement: Graceful and Forced Shutdown

**Delivery:** Slice 2
**Depends on:** Managed startup and readiness
**Traceability:** Proposal scope and rollback strategy; findings ARC-01 and ARC-07.

On normal desktop exit, the shell MUST request graceful engine shutdown, bound the wait, and ensure that shell-created engine resources and credentials are no longer usable. If graceful shutdown exceeds the bound, the shell MUST apply a documented forced-termination policy and report a content-free diagnostic outcome.

#### Scenario: Normal application exit

- GIVEN the shell owns a ready engine
- WHEN the desktop application exits normally
- THEN the engine MUST be asked to shut down
- AND shell-owned credentials and temporary authority MUST be invalidated

#### Scenario: Engine ignores graceful shutdown

- GIVEN the engine does not exit within the shutdown bound
- WHEN the bound expires
- THEN the shell MUST apply the documented forced-shutdown outcome
- AND document contents and credentials MUST NOT be written to diagnostics

### Requirement: Lifecycle Isolation from External Providers

**Delivery:** Slice 2
**Depends on:** Managed startup and readiness
**Traceability:** Proposal invariants 3, 4, and 9.

Engine startup, readiness, health checks, recovery, and shutdown MUST remain local and MUST NOT require or contact an external LLM provider. Provider misconfiguration or disablement MUST NOT prevent local engine readiness.

#### Scenario: Provider configuration is absent

- GIVEN no external provider is configured or enabled
- WHEN the desktop starts and checks engine readiness
- THEN the local engine MUST be able to become ready
- AND no provider network request MUST occur
