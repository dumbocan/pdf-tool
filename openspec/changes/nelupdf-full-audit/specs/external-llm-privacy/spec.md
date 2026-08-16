# External LLM Privacy Specification

## Purpose

Define one fail-closed, content-bound external-LLM transaction for desktop, CLI, HTTP, and MCP. This domain belongs to Slice 3; actual provider enablement belongs to Slice 6 after Slice 5 release controls and qualified review.

## Requirements

### Requirement: One Privacy Contract Across Every Supported Interface

**Delivery:** Slice 3
**Depends on:** Slices 1 and 2
**Traceability:** Proposal outcomes 3 through 5; invariants 3 through 9; findings DEF-01, ARC-04, SEC-04, DOC-01.

Desktop, CLI, HTTP, and MCP MUST enforce the same external-LLM privacy transaction semantics. No supported interface MAY transmit raw extracted document content through a direct, legacy, compatibility, hidden, or independently constructed provider path.

#### Scenario: Legacy raw route is invoked

- GIVEN a caller invokes a legacy raw LLM route or option
- WHEN that route has not been migrated to the unified transaction
- THEN the system MUST reject it with explicit deprecation or migration guidance
- AND no document content MUST be sent to a provider

#### Scenario: Each supported interface invokes external processing

- GIVEN equivalent authorized input, provider, model, purpose, and policy
- WHEN external processing is requested through desktop, CLI, HTTP, or MCP
- THEN each interface MUST require the same transaction validation and confirmation conditions
- AND none MAY bypass minimization or pseudonymization

### Requirement: Explicit Optional External Action

**Delivery:** Slice 3
**Depends on:** One privacy contract
**Traceability:** Proposal invariants 3, 4, and 9.

External processing MUST be optional and separate from deterministic local output. It MUST NOT occur because of document open, deterministic extraction, preview generation, implicit fallback, retry, startup, health check, or default configuration. Decline or failure MUST leave local deterministic output available.

#### Scenario: Local extraction lacks a desired field

- GIVEN deterministic extraction returns a missing or partial field
- WHEN the user has not explicitly requested and confirmed an external transaction
- THEN the system MUST NOT invoke an external provider
- AND the local result MUST remain available with its accurate status

### Requirement: Minimized and Pseudonymized Outbound Payload

**Delivery:** Slice 3
**Depends on:** One privacy contract
**Traceability:** Proposal invariants 7, 8, and 10; findings SEC-05 and TST-05.

Before transaction confirmation, the system MUST build the minimum payload required for the declared task and apply a documented, versioned, tested pseudonymization policy. The policy MUST identify protected data classes, unsupported or residual disclosures, international-format limitations, and payload coverage. Product language MUST describe transformed data as pseudonymized, not anonymous.

#### Scenario: Payload contains data outside the declared task need

- GIVEN extracted content contains fields not required for the declared provider purpose
- WHEN the outbound payload is built
- THEN unnecessary fields or text MUST be omitted
- AND the transaction MUST bind only the resulting minimized payload

#### Scenario: A data class is not protected by the policy

- GIVEN the outbound payload contains a data class that the active transformation policy does not protect
- WHEN disclosure is prepared
- THEN that limitation MUST be disclosed before confirmation
- AND the system MUST NOT represent the payload as anonymous or fully de-identified

### Requirement: Exact Content-Bound Transaction

**Delivery:** Slice 3
**Depends on:** Minimized and pseudonymized outbound payload
**Traceability:** Proposal invariant 6 and unified privacy contract; finding ARC-03.

A transaction MUST bind the exact authorized document identity, exact outbound-payload identity, provider, model, declared purpose, disclosure version, transformation-policy version, expiry, and one-time state. Confirmation MUST authorize only that bound transaction and MUST NOT re-extract, recompute, substitute, append to, or otherwise change its outbound payload.

#### Scenario: Document changes after preview

- GIVEN a transaction was prepared for specific document content
- WHEN confirmation is attempted after the document identity changes
- THEN confirmation MUST be rejected
- AND no provider request MUST occur

#### Scenario: Provider or model changes after preview

- GIVEN a transaction binds provider A and model X
- WHEN confirmation requests provider B or model Y
- THEN confirmation MUST be rejected
- AND no payload MUST be sent

#### Scenario: Bound request is confirmed

- GIVEN a non-expired transaction is unconsumed and every bound value is unchanged
- WHEN the user explicitly confirms it
- THEN provider invocation MUST use the already-bound outbound payload exactly
- AND the transaction MUST become consumed at most once

### Requirement: Faithful Informed Disclosure

**Delivery:** Slice 3
**Depends on:** Exact content-bound transaction
**Traceability:** Proposal invariant 8; findings SEC-05, SEC-09, DOC-01.

Before confirmation, the system MUST disclose the provider, model, purpose, material payload scope, transformation coverage and limitations, whether any displayed sample is partial, transaction expiry, relevant provider retention and training statements, processing destination or transfer implications known for the reviewed configuration, and the fact that pseudonymization is not anonymity. A short sample MUST NOT be represented as the complete outbound payload.

#### Scenario: UI shows only a payload sample

- GIVEN the outbound payload is larger than the displayed sample
- WHEN the disclosure is presented
- THEN the system MUST clearly identify the display as partial
- AND MUST faithfully communicate the scope of content not shown

### Requirement: Replay, Expiry, and Unpreviewed Requests Fail Closed

**Delivery:** Slice 3
**Depends on:** Exact content-bound transaction
**Traceability:** Proposal invariant 6; finding ARC-03.

The system MUST reject expired, consumed, replayed, unknown, modified, or directly constructed confirmations. Rejection MUST be atomic with respect to provider invocation so concurrent confirmations cannot produce multiple sends.

#### Scenario: Confirmed transaction is replayed

- GIVEN a transaction has already been consumed
- WHEN any interface attempts to confirm it again
- THEN the system MUST reject the replay
- AND a second provider request MUST NOT occur

#### Scenario: Confirmation has no prepared transaction

- GIVEN a caller constructs a confirmation without a valid prepared transaction
- WHEN confirmation is attempted
- THEN the system MUST reject it
- AND no provider request MUST occur

### Requirement: Untrusted Provider Output and Exact Reverse Mapping

**Delivery:** Slice 3
**Depends on:** Exact content-bound transaction
**Traceability:** Proposal unified privacy contract steps 8 and 9; invariants 6 and 10; finding DEF-04.

Provider output MUST be treated as untrusted and MUST be validated against the declared response contract. Reverse mapping MUST transform only exact pseudonyms present in that transaction's mapping; numeric strings, identifiers, or values absent from the map MUST remain unchanged. Invalid output MUST NOT overwrite deterministic local results.

#### Scenario: Provider returns an unmapped numeric value

- GIVEN provider output contains a numeric or identifier value not present in the transaction mapping
- WHEN reverse mapping is applied
- THEN that value MUST remain unchanged
- AND no arithmetic or heuristic reversal MUST be applied to it

#### Scenario: Provider output violates the response contract

- GIVEN a provider response has an unexpected shape or unsafe value
- WHEN it is validated
- THEN the external operation MUST fail with a typed provider-response error
- AND the deterministic local result MUST remain intact

### Requirement: Content-Free Audit Evidence and Minimal Lifetime

**Delivery:** Slice 3
**Depends on:** Exact content-bound transaction
**Traceability:** Proposal invariants 6 and 12; unified privacy contract step 9; findings ARC-06 and SEC-07.

The system MUST retain only bounded, non-content evidence needed to explain transaction identity, provider, model, purpose, disclosure and policy versions, timing, outcome, and payload identity. Routine logs and audit evidence MUST NOT contain document bytes, extracted text, transformed payload text, exact reverse mappings, credentials, or sensitive local paths. Transaction payloads and mappings MUST have documented clearing behavior.

#### Scenario: Support reviews a failed provider transaction

- GIVEN an external transaction failed
- WHEN support diagnostics are generated
- THEN they MUST identify the safe transaction outcome and policy/provider metadata
- AND they MUST NOT include document or payload content, credentials, mappings, or sensitive paths

### Requirement: Provider and Jurisdiction Release Gate

**Delivery:** Slice 6
**Depends on:** Slices 3 and 5
**Traceability:** Proposal invariant 9, regulatory rationale, unresolved assumptions, and program acceptance.

An external provider/model configuration MUST remain disabled until a qualified, dated review approves the intended provider account, model, purpose, users, and release jurisdictions. The gate MUST cover processing and retention terms, training use, processor roles and contracts, lawful basis, consent requirements, data residency and transfers, security controls, sector or age constraints, and required impact assessments. Absence, uncertainty, expiry, or material change in that evidence MUST fail closed. Passing this gate MUST NOT be represented as worldwide or jurisdiction-independent legal certification.

#### Scenario: Qualified review is missing or inconclusive

- GIVEN a provider is technically configured but qualified review evidence is absent or inconclusive for the intended release context
- WHEN provider enablement is evaluated
- THEN the provider MUST remain disabled
- AND local deterministic extraction MUST remain available

#### Scenario: Reviewed provider facts materially change

- GIVEN an enabled provider changes material model, account, retention, training, security, processing-location, or transfer terms
- WHEN the release gate is reevaluated
- THEN enablement MUST be suspended until qualified review is renewed
- AND the product MUST NOT claim continued approval by inference
