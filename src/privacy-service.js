// Slice 3 — Unified external-LLM privacy transaction service.
//
// This module owns the in-memory transaction lifecycle for the optional
// external-LLM feature. It is the single Node-domain entry point shared by
// the CLI, HTTP, MCP, and desktop adapters (see design §4.7 and spec
// `external-llm-privacy`).
//
// The contract has two operations:
//
//   prepare(...)   — pseudonymize and hash the minimized payload, bind it
//                    to a short-lived in-memory transaction, and return a
//                    disclosure the UI can show. NO upstream call.
//
//   confirm(...)   — atomically consume the unexpired stored transaction
//                    and hand the adapter the exact stored payload bytes.
//                    Replay / expiry / mismatch fail closed before egress.
//
// Audit evidence (allowlisted content-free events) is emitted to an
// injected AuditSink so callers can serialize it where retention is
// approved; the transaction payload and reverse map stay in memory and
// are released on expiry, consumption, cancellation, clear, or shutdown.
//
// Provider enablement lives behind an injected registry: Slice 3 ships
// only a fail-closed default that returns `provider_disabled` for every
// provider. Slice 6 owns the qualified-review release gate.

import { createHash, randomBytes } from "node:crypto";
import { createPseudonymizer } from "./pseudonymize.js";

// === Public constants ====================================================

// 60 seconds: the bound transaction must be confirmed within this window
// or the system rejects it before any provider call.
export const TRANSACTION_TTL_MS = 60_000;

// The audit buffer is bounded; older events are evicted when this cap is
// reached. 256 is a comfortable headroom for a single transaction's
// prepare + attempt + consume + sent cycle and any diagnostics emitted
// alongside.
export const AUDIT_EVENT_CAP = 256;

// Mirror the v1 Rust base64url document ID length so adapters can use the
// same validator.
export const DOC_ID_LEN = 22;

// Default upper bound for the provider response body. Mirrors the v1
// sidecar response cap.
export const RESPONSE_LIMIT_BYTES = 1_048_576;

// JSON is the only payload media type currently bound to the v1 provider
// contract. Bumping this is a contract change.
export const PAYLOAD_MEDIA_TYPE = "application/json";

// Closed vocabulary for `confidence` in a v1 provider response. Anything
// outside this set is rejected as provider_response_invalid — provider
// freedom to rate its own certainty is bounded by a published enum.
export const RESPONSE_CONFIDENCE_VALUES = Object.freeze(["high", "medium", "low"]);

// Maximum number of warning strings per provider response. Keeps a
// misbehaving provider from streaming content through the warnings slot.
const RESPONSE_WARNINGS_MAX = 32;

// Maximum characters per warning string. Content-free by construction —
// warnings are advisory labels, not user-facing diagnostics.
const RESPONSE_WARNING_MAX_CHARS = 1024;

// PII patterns scanned on the inbound response. Mirrors the outbound
// pseudonymizer's allowlist (src/pseudonymize.js) so an unmapped match
// here can be attributed to a provider leak or hallucination, not to the
// original document content.
const RESPONSE_PII_PATTERNS = Object.freeze([
  /[XYZ]?\d{7,8}[A-Z]/g, // ES NIF / DNI / NIE
  /[ABCDEFGHJNPQRSUVW](?:[O0]\d{7}[A-Z0-9]?|\d{7}[A-Z0-9]|\d{8})/g, // ES CIF
  /\b[A-Z]{2}\d{2}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}[ ]?\d{4}\b/g, // IBAN
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, // EMAIL
]);

// Hard cap on every string field in an AuditEvent. Keeps a malicious or
// buggy caller from sneaking document content into an opaque ID slot.
const AUDIT_STRING_FIELD_MAX = 256;

// === Audit event kinds ===================================================

// Closed enum of audit events. Each kind has a fixed set of allowlisted
// fields and a fixed outcome vocabulary; anything outside the schema is
// rejected by AuditSink.emit().
export const AuditEvent = Object.freeze({
  TX_PREPARE: "tx_prepare",
  TX_CONFIRM_ATTEMPT: "tx_confirm_attempt",
  TX_CONFIRM_SENT: "tx_confirm_sent",
  TX_CONFIRM_CONSUMED: "tx_confirm_consumed",
  TX_EXPIRED: "tx_expired",
  TX_CANCELLED: "tx_cancelled",
  TX_MISMATCH: "tx_mismatch",
});

// Per-kind field allowlist. Adding a field is a contract change; adding a
// string field that could carry document content is a privacy regression.
const AUDIT_ALLOWED_FIELDS = Object.freeze({
  [AuditEvent.TX_PREPARE]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "providerId",
    "modelId",
    "purpose",
    "disclosureVersion",
    "transformedPolicyVersion",
    "payloadSha256",
    "outcome",
    "timestamp",
  ]),
  [AuditEvent.TX_CONFIRM_ATTEMPT]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "providerId",
    "modelId",
    "purpose",
    "outcome",
    "timestamp",
  ]),
  [AuditEvent.TX_CONFIRM_SENT]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "outcome",
    "timestamp",
  ]),
  [AuditEvent.TX_CONFIRM_CONSUMED]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "outcome",
    "timestamp",
  ]),
  [AuditEvent.TX_EXPIRED]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "outcome",
    "timestamp",
  ]),
  [AuditEvent.TX_CANCELLED]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "outcome",
    "timestamp",
  ]),
  [AuditEvent.TX_MISMATCH]: Object.freeze([
    "operationCorrelationId",
    "transactionId",
    "outcome",
    "timestamp",
  ]),
});

// Per-kind outcome vocabulary. `outcome` is a structured label — never a
// free-form string — so the support team can group failures without
// needing to read content.
const AUDIT_OUTCOMES = Object.freeze({
  [AuditEvent.TX_PREPARE]: Object.freeze(["prepared"]),
  [AuditEvent.TX_CONFIRM_ATTEMPT]: Object.freeze(["attempted"]),
  [AuditEvent.TX_CONFIRM_SENT]: Object.freeze(["sent"]),
  [AuditEvent.TX_CONFIRM_CONSUMED]: Object.freeze(["consumed"]),
  [AuditEvent.TX_EXPIRED]: Object.freeze(["expired"]),
  [AuditEvent.TX_CANCELLED]: Object.freeze(["cancelled"]),
  [AuditEvent.TX_MISMATCH]: Object.freeze(["mismatch"]),
});

// === Errors ==============================================================

export class PrivacyTransactionError extends Error {
  constructor(message, code) {
    super(`${code}: ${message}`);
    this.name = "PrivacyTransactionError";
    this.code = code;
  }
}

export class ProviderDisabledError extends PrivacyTransactionError {
  constructor(providerId) {
    super(`provider ${providerId} is disabled`, "provider_disabled");
    this.name = "ProviderDisabledError";
    this.providerId = providerId;
  }
}

export class AuditEventError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuditEventError";
  }
}

// === AuditSink ===========================================================

export class AuditSink {
  constructor({ cap = AUDIT_EVENT_CAP } = {}) {
    if (!Number.isInteger(cap) || cap <= 0) {
      throw new AuditEventError("audit cap must be a positive integer");
    }
    this._cap = cap;
    this._events = [];
  }

  // Emit one audit event. Throws AuditEventError if the event does not
  // match the closed schema for its kind. Bounded storage evicts the
  // oldest events when the cap is exceeded.
  emit(event) {
    validateAuditEvent(event);
    this._events.push(event);
    if (this._events.length > this._cap) {
      this._events.splice(0, this._events.length - this._cap);
    }
  }

  // Defensive copy so callers cannot mutate the internal buffer.
  get events() {
    return this._events.slice();
  }

  get size() {
    return this._events.length;
  }

  clear() {
    this._events.length = 0;
  }
}

function validateAuditEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new AuditEventError("audit event must be a non-array object");
  }
  const kind = event.kind;
  const allowed = AUDIT_ALLOWED_FIELDS[kind];
  if (!allowed) {
    throw new AuditEventError(`unknown audit kind: ${String(kind)}`);
  }
  // `kind` is the discriminator and never carries content. Every other
  // key on the event MUST belong to the per-kind allowlist, with no
  // extras and no duplicates. We check membership BEFORE counting so a
  // caller that adds a free-form field gets the more informative error.
  const fieldKeys = Object.keys(event).filter((k) => k !== "kind");
  const seen = new Set();
  for (const key of fieldKeys) {
    if (seen.has(key)) {
      throw new AuditEventError(`audit event ${kind} has duplicate field: ${key}`);
    }
    seen.add(key);
    if (!allowed.includes(key)) {
      throw new AuditEventError(`audit event ${kind} has unknown field: ${key}`);
    }
  }
  if (fieldKeys.length !== allowed.length) {
    throw new AuditEventError(
      `audit event ${kind} has ${fieldKeys.length} fields; expected ${allowed.length}`,
    );
  }
  for (const key of fieldKeys) {
    const value = event[key];
    if (key === "timestamp") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new AuditEventError(`${kind}.timestamp must be a finite number`);
      }
      continue;
    }
    if (key === "outcome") {
      const allowedOutcomes = AUDIT_OUTCOMES[kind];
      if (typeof value !== "string" || !allowedOutcomes.includes(value)) {
        throw new AuditEventError(
          `${kind}.outcome must be one of ${allowedOutcomes.join(",")}`,
        );
      }
      continue;
    }
    // Opaque identifier / metadata string fields.
    if (typeof value !== "string") {
      throw new AuditEventError(`${kind}.${key} must be a string`);
    }
    if (value.length === 0 || value.length > AUDIT_STRING_FIELD_MAX) {
      throw new AuditEventError(
        `${kind}.${key} must be 1..${AUDIT_STRING_FIELD_MAX} chars`,
      );
    }
  }
}

// === Provider registry ===================================================

// Default registry for Slice 3. Every configured provider is disabled
// because the qualified-review release gate (Slice 6) has not approved
// any provider for this codebase yet. Adapters can pass a different
// registry in tests or once a release-gate evidence package lands.
export function createDefaultProviderRegistry() {
  return {
    get(providerId) {
      return { status: "disabled", providerId, reason: "release_gate_pending" };
    },
  };
}

function generateTransactionId() {
  // 16 random bytes -> 22 base64url chars without padding (128 bits of
  // entropy is enough that collisions are not a practical concern over a
  // 60-second window).
  return randomBytes(16).toString("base64url");
}

function isValidBase64urlId(value) {
  return (
    typeof value === "string" &&
    value.length === DOC_ID_LEN &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Canonical JSON serializer used to build the exact outbound payload
// bytes. Keys are sorted alphabetically at every object level. The only
// permitted whitespace is the single space after each colon; the bytes
// are stable and reproducible across runs and platforms.
function canonicalize(value) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("cannot canonicalize non-finite number");
    }
    return JSON.stringify(value);
  }
  if (type === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (type === "object") {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      parts.push(JSON.stringify(key) + ": " + canonicalize(value[key]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new TypeError(`cannot canonicalize value of type ${type}`);
}

// Build the minimized, pseudonymized task payload. Only the structured
// fields the LLM needs for the declared purpose leave the device; the
// raw PDF text, raw bytes, file paths and engine metadata stay local.
// PII identifiers in string fields are replaced by opaque markers and
// numeric amounts are factor-scaled. The reverse map lives in the
// per-transaction pseudonymizer and never crosses any boundary.
function minimizePayload({ documentId, purpose, localExtraction, pseudonymizer }) {
  const invoice =
    localExtraction && typeof localExtraction === "object"
      ? localExtraction.invoice
      : null;
  const fields = {};
  let fieldsMatched = [];
  if (invoice && typeof invoice === "object") {
    if (typeof invoice.invoiceNumber === "string" && invoice.invoiceNumber) {
      fields.invoiceNumber = pseudonymizer.pseudonymize(invoice.invoiceNumber);
    }
    if (typeof invoice.invoiceDate === "string" && invoice.invoiceDate) {
      fields.invoiceDate = invoice.invoiceDate;
    }
    if (
      typeof invoice.simplifiedInvoiceDate === "string" &&
      invoice.simplifiedInvoiceDate
    ) {
      fields.simplifiedInvoiceDate = invoice.simplifiedInvoiceDate;
    }
    if (typeof invoice.taxLabel === "string" && invoice.taxLabel) {
      fields.taxLabel = invoice.taxLabel;
    }
    if (invoice.totals && typeof invoice.totals === "object") {
      const totals = {};
      for (const key of ["subtotal", "tax", "total"]) {
        const value = invoice.totals[key];
        if (typeof value === "string" && value) {
          // The pseudonymizer's amount matcher only fires when the value
          // carries a currency suffix. Totals arrive as bare decimal
          // strings, so we synthesize a transient suffix, pseudonymize,
          // and strip it. The reverse map is populated for the bare
          // decimal as well (because the underlying factor is the same).
          const pseudonymized = pseudonymizer.pseudonymize(`${value} €`);
          totals[key] = pseudonymized.replace(/\s+€$/, "");
        }
      }
      if (Object.keys(totals).length > 0) fields.totals = totals;
    }
    if (Array.isArray(invoice.matched)) {
      fieldsMatched = invoice.matched
        .map((m) => (typeof m === "string" ? m : m.label))
        .slice()
        .sort();
    }
  }
  return {
    schemaVersion: "v1",
    documentId,
    purpose,
    fields,
    fieldsMatched,
  };
}

// Defensive scrub: the privacy service treats every parsed invoice
// string as untrusted, in line with the local extractor's trust
// boundary. If a field somehow carries raw PDF artifacts (a parser bug
// or a hostile document), we replace them with an opaque marker so the
// outbound payload never carries recognisable PDF content while the
// bind still succeeds for legitimate content.
const PDF_MARKER_PATTERNS = [
  // %PDF- magic: cover the canonical "1.4", "1.7" form and the looser
  // form an embedded base64 stream would produce ("%PDF-JVBER...").
  { re: /%PDF-[\w./+=-]+/g, label: "PDF-MAGIC" },
  { re: /%%EOF/g, label: "PDF-EOF" },
  { re: /<x:xmpmeta[^>]*>/g, label: "XMP-META" },
  { re: /<\?xpacket[^?]*\?>/g, label: "XMP-PACKET" },
];

function scrubPdfArtifacts(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const { re, label } of PDF_MARKER_PATTERNS) {
    out = out.replace(re, `[${label}-REDACTED]`);
  }
  return out;
}

function scrubPayloadArtifacts(payload) {
  return JSON.parse(canonicalize(payload), (key, value) => {
    if (typeof value === "string") return scrubPdfArtifacts(value);
    return value;
  });
}

// === Response validation helpers (WU-3C2) ================================

// Derive the closed allowlist of field names the provider is allowed to
// echo back. Built from the same invoice / totals / matched structure
// minimizePayload reads, so anything outside the allowlist is rejected
// as a contract violation before any reverse-mapping is attempted.
function computeLocalFields(localExtraction) {
  const invoice =
    localExtraction && typeof localExtraction === "object"
      ? localExtraction.invoice
      : null;
  const fields = new Set();
  if (invoice && typeof invoice === "object") {
    for (const key of [
      "invoiceNumber",
      "invoiceDate",
      "simplifiedInvoiceDate",
      "taxLabel",
    ]) {
      if (typeof invoice[key] === "string" && invoice[key].length > 0) {
        fields.add(key);
      }
    }
    if (invoice.totals && typeof invoice.totals === "object") {
      for (const key of ["subtotal", "tax", "total"]) {
        if (
          typeof invoice.totals[key] === "string" &&
          invoice.totals[key].length > 0
        ) {
          fields.add(key);
        }
      }
    }
    if (Array.isArray(invoice.matched)) {
      for (const m of invoice.matched) {
        const label = typeof m === "string" ? m : m && m.label;
        if (typeof label === "string" && label.length > 0) fields.add(label);
      }
    }
  }
  return Object.freeze([...fields].sort());
}

// True when the value shape-matches any PII pattern from
// src/pseudonymize.js. Defensive copy of the regex flags (without /g we
// would carry the lastIndex across tests and silently skip matches).
function responseStringMatchesPii(value) {
  for (const pattern of RESPONSE_PII_PATTERNS) {
    // Reset the regex state so /g doesn't leak between calls.
    pattern.lastIndex = 0;
    if (pattern.test(value)) return true;
  }
  return false;
}

// Validate the closed v1 provider response schema. Any deviation from
// the schema — content-type, byte limit, JSON parse, missing field,
// unknown enum value, oversized warning — fails with the unified
// `provider_response_invalid` code.
function validateProviderResponseShape(parsed, expectedRequestId) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PrivacyTransactionError(
      "response body must be a JSON object",
      "provider_response_invalid",
    );
  }
  if (parsed.schemaVersion !== "v1") {
    throw new PrivacyTransactionError(
      `response schemaVersion must be "v1" (got ${JSON.stringify(parsed.schemaVersion)})`,
      "provider_response_invalid",
    );
  }
  if (typeof parsed.requestId !== "string" || parsed.requestId === "") {
    throw new PrivacyTransactionError(
      "response requestId must be a non-empty string",
      "provider_response_invalid",
    );
  }
  if (parsed.requestId !== expectedRequestId) {
    throw new PrivacyTransactionError(
      "response requestId does not match the bound transaction",
      "provider_response_invalid",
    );
  }
  if (
    typeof parsed.confidence !== "string" ||
    !RESPONSE_CONFIDENCE_VALUES.includes(parsed.confidence)
  ) {
    throw new PrivacyTransactionError(
      `response confidence must be one of ${RESPONSE_CONFIDENCE_VALUES.join(",")}`,
      "provider_response_invalid",
    );
  }
  if (
    !parsed.fields ||
    typeof parsed.fields !== "object" ||
    Array.isArray(parsed.fields)
  ) {
    throw new PrivacyTransactionError(
      "response fields must be a non-array object",
      "provider_response_invalid",
    );
  }
  if (!Array.isArray(parsed.warnings)) {
    throw new PrivacyTransactionError(
      "response warnings must be an array",
      "provider_response_invalid",
    );
  }
  if (parsed.warnings.length > RESPONSE_WARNINGS_MAX) {
    throw new PrivacyTransactionError(
      `response warnings must contain at most ${RESPONSE_WARNINGS_MAX} entries`,
      "provider_response_invalid",
    );
  }
  for (let i = 0; i < parsed.warnings.length; i++) {
    const w = parsed.warnings[i];
    if (
      typeof w !== "string" ||
      w.length === 0 ||
      w.length > RESPONSE_WARNING_MAX_CHARS
    ) {
      throw new PrivacyTransactionError(
        `response warnings[${i}] must be a non-empty string of 1..${RESPONSE_WARNING_MAX_CHARS} chars`,
        "provider_response_invalid",
      );
    }
  }
}

// Every key on the response's `fields` object must already be in the
// allowlist derived at prepare time. Anything else is a contract
// violation, not a privacy concern — we still reject it before any
// reverse-map work happens.
function assertResponseFieldsAllowlisted(fields, allowlist) {
  const allowed = new Set(allowlist);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) {
      throw new PrivacyTransactionError(
        `response field "${key}" is not in the bound allowlist`,
        "provider_response_invalid",
      );
    }
  }
}

// Defense-in-depth: after reverse-mapping, scan the values for raw PII
// the provider could only know by leaking source content or by
// hallucinating identifiers. The reverse map is the single source of
// truth — a value shape-matching PII with no matching map entry is
// always rejected, even when the response schema itself is well-formed.
function detectUnmappedSensitiveFields(pseudonymizer, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    if (typeof value === "string") {
      const reversed = pseudonymizer.reversePii(value);
      if (reversed === value && responseStringMatchesPii(value)) {
        throw new PrivacyTransactionError(
          `response field "${key}" contains unmapped PII`,
          "provider_response_invalid",
        );
      }
    }
  }
}

// === Service =============================================================

export class PrivacyTransactionService {
  constructor({
    auditSink,
    providerRegistry,
    transactionTtlMs = TRANSACTION_TTL_MS,
    enableShutdownHooks = false,
  } = {}) {
    if (
      transactionTtlMs != null &&
      (!Number.isFinite(transactionTtlMs) || transactionTtlMs < 0)
    ) {
      throw new TypeError("transactionTtlMs must be a non-negative finite number");
    }
    this._auditSink = auditSink ?? new AuditSink();
    this._providerRegistry = providerRegistry ?? createDefaultProviderRegistry();
    this._transactionTtlMs = transactionTtlMs;
    this._transactions = new Map();
    this._shutdownHandlers = [];
    if (enableShutdownHooks) this._registerShutdownHooks();
  }

  // === Lifecycle hooks ===================================================

  // Clear every in-memory transaction when the process exits so reverse
  // maps, payload bytes and pseudonyms do not survive a clean shutdown.
  // The hooks are best-effort: `exit` cannot await, so we synchronously
  // drop the maps and accept that any audit already emitted is the
  // caller's responsibility to persist before the process goes away.
  //
  // Off by default: production callers opt in via `enableShutdownHooks`
  // so unit tests that build many short-lived services do not leak
  // process listeners.
  _registerShutdownHooks() {
    const onExit = () => {
      try {
        this._transactions.clear();
      } catch {
        /* best effort */
      }
    };
    const onSignal = () => {
      try {
        this._transactions.clear();
      } catch {
        /* best effort */
      }
      // Do not call process.exit() — preserve default signal handling for
      // other listeners and the parent shell.
    };
    process.once("exit", onExit);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    this._shutdownHandlers.push(
      ["exit", onExit],
      ["SIGINT", onSignal],
      ["SIGTERM", onSignal],
    );
  }

  enableShutdownHooks() {
    if (this._shutdownHandlers.length === 0) this._registerShutdownHooks();
  }

  shutdown() {
    for (const [event, handler] of this._shutdownHandlers) {
      try {
        process.removeListener(event, handler);
      } catch {
        /* ignore */
      }
    }
    this._shutdownHandlers.length = 0;
    this._transactions.clear();
  }

  // === Prepare ==========================================================

  prepare({
    documentId,
    localExtraction,
    providerId,
    modelId,
    purpose,
    disclosureVersion,
    transformedPolicyVersion,
    operationCorrelationId,
  } = {}) {
    if (!isValidBase64urlId(documentId)) {
      throw new PrivacyTransactionError(
        "invalid documentId: must be a 22-char base64url opaque ID",
        "invalid_request",
      );
    }
    // content-identity: extract documentSha256 from localExtraction
    const documentSha256 =
      localExtraction?.documentSha256 ?? null;
    if (typeof providerId !== "string" || providerId.length === 0) {
      throw new PrivacyTransactionError("providerId is required", "invalid_request");
    }
    if (typeof modelId !== "string" || modelId.length === 0) {
      throw new PrivacyTransactionError("modelId is required", "invalid_request");
    }
    if (typeof purpose !== "string" || purpose.length === 0) {
      throw new PrivacyTransactionError("purpose is required", "invalid_request");
    }
    if (typeof disclosureVersion !== "string" || disclosureVersion.length === 0) {
      throw new PrivacyTransactionError(
        "disclosureVersion is required",
        "invalid_request",
      );
    }
    if (
      typeof transformedPolicyVersion !== "string" ||
      transformedPolicyVersion.length === 0
    ) {
      throw new PrivacyTransactionError(
        "transformedPolicyVersion is required",
        "invalid_request",
      );
    }
    if (
      operationCorrelationId != null &&
      (typeof operationCorrelationId !== "string" || operationCorrelationId.length === 0)
    ) {
      throw new PrivacyTransactionError(
        "operationCorrelationId must be a non-empty string when provided",
        "invalid_request",
      );
    }

    // Fail-closed provider gate (Slice 3 / Slice 6 release review).
    const providerStatus = this._providerRegistry.get(providerId);
    if (!providerStatus || providerStatus.status !== "enabled") {
      throw new ProviderDisabledError(providerId);
    }

    const transactionId = generateTransactionId();
    const pseudonymizer = createPseudonymizer();

    const payload = minimizePayload({
      documentId,
      purpose,
      localExtraction,
      pseudonymizer,
    });

    // Defense-in-depth: even after pseudonymization, the payload must not
    // carry recognisable PDF artifacts. Replace any that survived with
    // opaque redaction markers. The canonical form is preserved.
    const scrubbed = scrubPayloadArtifacts(payload);

    const exactPayloadBytes = Buffer.from(canonicalize(scrubbed), "utf8");
    const payloadSha256 = sha256Hex(exactPayloadBytes);

    const now = Date.now();
    const expiresAtMs = now + this._transactionTtlMs;
    const expiresAt = new Date(expiresAtMs).toISOString();

    const transaction = {
      transactionId,
      documentId,
      providerId,
      modelId,
      purpose,
      disclosureVersion,
      transformedPolicyVersion,
      payloadBytes: exactPayloadBytes,
      payloadSha256,
      documentSha256,
      pseudonymizer,
      // Closed allowlist of field names the provider is allowed to echo
      // back. Derived from the same invoice/totals/matched structure
      // minimizePayload reads so the response validator never has to
      // keep a parallel schema in sync (WU-3C2).
      localFields: computeLocalFields(localExtraction),
      expiresAtMs,
      consumed: false,
      operationCorrelationId: operationCorrelationId ?? null,
      createdAtMs: now,
    };
    this._transactions.set(transactionId, transaction);

    this._auditSink.emit({
      kind: AuditEvent.TX_PREPARE,
      operationCorrelationId: operationCorrelationId ?? "",
      transactionId,
      providerId,
      modelId,
      purpose,
      disclosureVersion,
      transformedPolicyVersion,
      payloadSha256,
      outcome: "prepared",
      timestamp: now,
    });

    return {
      transactionId,
      payloadSha256,
      providerId,
      modelId,
      purpose,
      disclosure: {
        version: disclosureVersion,
        transformedPolicyVersion,
        providerId,
        modelId,
        purpose,
        documentSha256,
        payloadSha256,
        expiresAt,
      },
      expiresAt,
    };
  }

  // === Confirm ==========================================================

  confirm({
    transactionId,
    requestId,
    providerId,
    modelId,
    purpose,
    documentSha256,
    localExtraction,
  } = {}) {
    if (typeof transactionId !== "string" || transactionId.length === 0) {
      throw new PrivacyTransactionError(
        "transactionId is required",
        "invalid_request",
      );
    }
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new PrivacyTransactionError("requestId is required", "invalid_request");
    }
    for (const [name, value] of [
      ["providerId", providerId],
      ["modelId", modelId],
      ["purpose", purpose],
    ]) {
      if (value != null && (typeof value !== "string" || value.length === 0)) {
        throw new PrivacyTransactionError(
          `${name} must be a non-empty string when provided`,
          "invalid_request",
        );
      }
    }

    const tx = this._transactions.get(transactionId);
    if (!tx) {
      throw new PrivacyTransactionError(
        `unknown transaction ${transactionId}`,
        "tx_unknown",
      );
    }

    // Atomic compare-and-consume: a consumed transaction cannot be
    // re-confirmed under any circumstance. Single-threaded JS makes this
    // check + set naturally atomic — no other code can run between them.
    if (tx.consumed) {
      throw new PrivacyTransactionError(
        `transaction ${transactionId} already consumed`,
        "tx_already_consumed",
      );
    }

    const now = Date.now();
    if (now >= tx.expiresAtMs) {
      this._transactions.delete(transactionId);
      this._auditSink.emit({
        kind: AuditEvent.TX_EXPIRED,
        operationCorrelationId: requestId,
        transactionId,
        outcome: "expired",
        timestamp: now,
      });
      throw new PrivacyTransactionError(
        `transaction ${transactionId} expired`,
        "tx_expired",
      );
    }

    // Integrity check (spec §74): verify the stored payload bytes still hash
    // to the stored sha256. If the in-memory transaction was tampered with
    // after prepare, reject before any provider action.
    if (sha256Hex(tx.payloadBytes) !== tx.payloadSha256) {
      this._transactions.delete(transactionId);
      this._auditSink.emit({
        kind: AuditEvent.TX_MISMATCH,
        operationCorrelationId: requestId,
        transactionId,
        outcome: "mismatch",
        timestamp: now,
      });
      throw new PrivacyTransactionError(
        `transaction ${transactionId} payload integrity mismatch`,
        "tx_mismatch",
      );
    }

    // Mismatch: caller asked to confirm with values that differ from the
    // bound transaction. The transaction is dropped so a second, correct
    // confirm cannot silently reuse it.
    if (
      (providerId != null && providerId !== tx.providerId) ||
      (modelId != null && modelId !== tx.modelId) ||
      (purpose != null && purpose !== tx.purpose)
    ) {
      this._transactions.delete(transactionId);
      this._auditSink.emit({
        kind: AuditEvent.TX_MISMATCH,
        operationCorrelationId: requestId,
        transactionId,
        outcome: "mismatch",
        timestamp: now,
      });
      throw new PrivacyTransactionError(
        `transaction ${transactionId} mismatch`,
        "tx_mismatch",
      );
     }

    // Content-identity binding (spec §74): the document SHA-256 and any
    // local-extraction fields must match what was bound at prepare time.
    // The caller may pass either the raw hash or a fresh local extraction;
    // in the latter case we recompute the payload bytes and compare hashes.
    // Any mutation — even a single changed invoice field — causes tx_mismatch
    // and the transaction is dropped so it cannot be silently reused.
    if (documentSha256 != null) {
      if (typeof documentSha256 !== "string" || documentSha256.length === 0) {
        throw new PrivacyTransactionError(
          "documentSha256 must be a non-empty string when provided",
          "invalid_request",
        );
      }
      if (documentSha256 !== tx.documentSha256) {
        this._transactions.delete(transactionId);
        this._auditSink.emit({
          kind: AuditEvent.TX_MISMATCH,
          operationCorrelationId: requestId,
          transactionId,
          outcome: "mismatch",
          timestamp: now,
        });
        throw new PrivacyTransactionError(
          `transaction ${transactionId} document identity mismatch`,
          "tx_mismatch",
        );
      }
    }
    if (localExtraction != null) {
      const recomputed = minimizePayload({
        documentId: tx.documentId,
        purpose: tx.purpose,
        localExtraction,
        pseudonymizer: tx.pseudonymizer,
      });
      const recomputedBytes = Buffer.from(
        canonicalize(scrubPayloadArtifacts(recomputed)),
        "utf8",
      );
      if (
        sha256Hex(recomputedBytes) !== tx.payloadSha256 ||
        recomputedBytes.length !== tx.payloadBytes.length
      ) {
        this._transactions.delete(transactionId);
        this._auditSink.emit({
          kind: AuditEvent.TX_MISMATCH,
          operationCorrelationId: requestId,
          transactionId,
          outcome: "mismatch",
          timestamp: now,
        });
        throw new PrivacyTransactionError(
          `transaction ${transactionId} content identity mismatch`,
          "tx_mismatch",
        );
      }
    }

    // Atomic consume — single-threaded JS, no `await` between the check
    // and the set, so concurrent confirms cannot both pass.
    tx.consumed = true;
    tx.consumedAtMs = now;
    tx.consumedByRequestId = requestId;

    this._auditSink.emit({
      kind: AuditEvent.TX_CONFIRM_ATTEMPT,
      operationCorrelationId: requestId,
      transactionId,
      providerId: tx.providerId,
      modelId: tx.modelId,
      purpose: tx.purpose,
      outcome: "attempted",
      timestamp: now,
    });
    this._auditSink.emit({
      kind: AuditEvent.TX_CONFIRM_CONSUMED,
      operationCorrelationId: requestId,
      transactionId,
      outcome: "consumed",
      timestamp: now,
    });

    const request = {
      transactionId: tx.transactionId,
      providerId: tx.providerId,
      modelId: tx.modelId,
      purpose: tx.purpose,
      payloadMediaType: PAYLOAD_MEDIA_TYPE,
      exactPayloadBytes: new Uint8Array(tx.payloadBytes),
      payloadSha256: tx.payloadSha256,
      deadlineMs: tx.expiresAtMs,
      responseLimitBytes: RESPONSE_LIMIT_BYTES,
    };

    const onSent = () => {
      this._auditSink.emit({
        kind: AuditEvent.TX_CONFIRM_SENT,
        operationCorrelationId: requestId,
        transactionId,
        outcome: "sent",
        timestamp: Date.now(),
      });
    };

    return { request, onSent };
  }

  // === Validate provider response ======================================

  // Validate the provider response bytes that came back after
  // confirm(). The contract (design §5.5) requires every byte of the
  // response to be:
  //   1. bound to a consumed transaction that the caller actually
  //      confirmed (else no provider call could have happened);
  //   2. inside RESPONSE_LIMIT_BYTES;
  //   3. declared as `application/json`;
  //   4. parseable JSON that matches the closed v1 schema;
  //   5. mapped back to the outbound values via the transaction's
  //      per-transaction reverse map — exact membership only;
  //   6. free of raw PII that no map entry can explain.
  //
  // Any failure surfaces as `provider_response_invalid` so adapters
  // share one error code path; failures in the transaction state itself
  // (missing / not consumed / wrong requestId) keep their existing
  // tx_unknown / tx_mismatch codes so the contract stays observable.
  validateProviderResponse({
    transactionId,
    requestId,
    responseBytes,
    contentType,
  } = {}) {
    if (typeof transactionId !== "string" || transactionId.length === 0) {
      throw new PrivacyTransactionError(
        "transactionId is required",
        "invalid_request",
      );
    }
    if (typeof requestId !== "string" || requestId.length === 0) {
      throw new PrivacyTransactionError(
        "requestId is required",
        "invalid_request",
      );
    }
    if (responseBytes == null) {
      throw new PrivacyTransactionError(
        "responseBytes is required",
        "invalid_request",
      );
    }
    if (
      !(responseBytes instanceof Uint8Array) &&
      !Buffer.isBuffer(responseBytes)
    ) {
      throw new PrivacyTransactionError(
        "responseBytes must be a Uint8Array or Buffer",
        "invalid_request",
      );
    }
    if (typeof contentType !== "string" || contentType === "") {
      throw new PrivacyTransactionError(
        "contentType is required",
        "invalid_request",
      );
    }

    const tx = this._transactions.get(transactionId);
    if (!tx) {
      throw new PrivacyTransactionError(
        `unknown transaction ${transactionId}`,
        "tx_unknown",
      );
    }
    // Provider can only respond after confirm(). A non-consumed
    // transaction here means the caller misordered operations — treat
    // it as a state mismatch so the existing tx_mismatch code path
    // owns this class of bug.
    if (!tx.consumed) {
      throw new PrivacyTransactionError(
        `transaction ${transactionId} was not consumed before validating a provider response`,
        "tx_mismatch",
      );
    }
    if (requestId !== tx.consumedByRequestId) {
      throw new PrivacyTransactionError(
        `requestId ${requestId} does not match the transaction's consumed requestId`,
        "tx_mismatch",
      );
    }

    // Byte guard — every response above RESPONSE_LIMIT_BYTES is a
    // contract violation, not a privacy concern, but we share the same
    // error code so adapters handle one failure path.
    if (responseBytes.length > RESPONSE_LIMIT_BYTES) {
      throw new PrivacyTransactionError(
        `response body exceeds ${RESPONSE_LIMIT_BYTES} bytes`,
        "provider_response_invalid",
      );
    }
    if (contentType !== PAYLOAD_MEDIA_TYPE) {
      throw new PrivacyTransactionError(
        `response contentType must be "${PAYLOAD_MEDIA_TYPE}" (got "${contentType}")`,
        "provider_response_invalid",
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(responseBytes).toString("utf8"));
    } catch (err) {
      throw new PrivacyTransactionError(
        `response body is not valid JSON: ${err && err.message ? err.message : String(err)}`,
        "provider_response_invalid",
      );
    }

    validateProviderResponseShape(parsed, requestId);
    assertResponseFieldsAllowlisted(parsed.fields, tx.localFields);

    // Reverse-map per field. We copy first so an exception thrown by
    // the detection helper doesn't leak the partially-mutated values.
    const reversed = tx.pseudonymizer.reverseDeep(parsed.fields);
    detectUnmappedSensitiveFields(tx.pseudonymizer, parsed.fields);

    return Object.freeze({
      requestId,
      confidence: parsed.confidence,
      fields: Object.freeze(reversed),
      warnings: Object.freeze([...parsed.warnings]),
    });
  }

  // === Cancellation / cleanup ==========================================

  cancelTransaction(transactionId, { operationCorrelationId } = {}) {
    const tx = this._transactions.get(transactionId);
    if (!tx) return false;
    this._transactions.delete(transactionId);
    // The audit schema requires a non-empty operationCorrelationId. If
    // the caller did not pass one, fall back to a synthetic ID derived
    // from the transaction — the audit consumer can still correlate
    // back to the original prepare.
    const correlation = operationCorrelationId || `cancel:${transactionId}`;
    this._auditSink.emit({
      kind: AuditEvent.TX_CANCELLED,
      operationCorrelationId: correlation,
      transactionId,
      outcome: "cancelled",
      timestamp: Date.now(),
    });
    return true;
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [id, tx] of this._transactions) {
      if (now >= tx.expiresAtMs) {
        this._transactions.delete(id);
        if (!tx.consumed) {
          this._auditSink.emit({
            kind: AuditEvent.TX_EXPIRED,
            operationCorrelationId: `auto-cleanup:${id}`,
            transactionId: id,
            outcome: "expired",
            timestamp: now,
          });
        }
        removed += 1;
      }
    }
    return removed;
  }

  clear() {
    this._transactions.clear();
  }

  getTransaction(transactionId) {
    return this._transactions.get(transactionId) ?? null;
  }

  get size() {
    return this._transactions.size;
  }
}
