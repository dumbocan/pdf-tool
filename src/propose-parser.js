// Phase 2 of llm-assisted-parser-anonymized.
//
// `proposeParserV1` operation handler. It sits behind the same fail-closed
// provider gate as every other privacy-bound operation:
//   1. Validate the request envelope.
//   2. Check the provider registry (default disabled) → `provider_disabled`.
//   3. Re-sanitize the token stream (defense-in-depth) → `sanitization_incomplete`
//      if the re-scan still sees PII.
//   4. Emit an audit event for the egress attempt.
//   5. Invoke the LLM adapter (default: disabled / mock in tests).
//   6. Validate the suggestion entries → `provider_response_invalid`.
//   7. Emit the response audit event and return the success envelope.
//
// Nothing here ever receives raw invoice bytes with PII; callers MUST have
// already passed the stream through `sanitizeTokensForLLM`, and the module
// re-runs sanitization as a boundary check before egress.

import { sanitizeTokensForLLM, auditSanitizedPayload } from "./llm-sanitize.js";
import { ProviderDisabledError } from "./privacy-service.js";

export const MAX_SUGGESTION_ENTRIES = 16;
export const MAX_TOKEN_TEXT_CHARS = 256;
export const MAX_ANONYMIZED_TOKENS = 16_384;
export const MAX_EGRESS_PAYLOAD_BYTES = 2 * 1024 * 1024;

const KNOWN_FIELDS = new Set([
  "invoiceDate",
  "invoiceNumber",
  "subtotal",
  "tax",
  "total",
  "taxLabel",
]);
const KNOWN_LABEL_LANGUAGES = new Set(["es", "en", "es-en"]);
const KNOWN_EVIDENCE_SHAPES = new Set(["date", "amount", "alphanumeric_ref"]);
const KNOWN_EXTRACTION_MODES = new Set(["DIGITAL_TEXT", "OCR"]);
const KNOWN_ENTRY_KEYS = new Set(["field", "regex", "labelLanguage", "evidenceShape"]);

export class ProposeParserError extends Error {
  constructor(message, code = "internal") {
    super(`${code}: ${message}`);
    this.name = "ProposeParserError";
    this.code = code;
  }
}

function requireObject(value, what) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProposeParserError(`${what} must be an object`, "invalid_request");
  }
}

function requireString(value, what, { max = 1024, pattern = null } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ProposeParserError(`${what} must be a string of 1..${max} chars`, "invalid_request");
  }
  if (pattern && !pattern.test(value)) {
    throw new ProposeParserError(`${what} has an invalid format`, "invalid_request");
  }
}

function requireUuid(value, what) {
  requireString(value, what, { pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i });
}

function requireOpaqueDocumentId(value) {
  // Same contract as `assertDocumentId` in invoice-evidence.js: 22 chars of
  // base64url-ish characters.
  requireString(value, "documentId", { pattern: /^[A-Za-z0-9_-]{22}$/ });
}

/**
 * Validate a REQUEST envelope for `proposeParserV1`.
 * Throws ProposeParserError with a typed code on failure.
 */
export function validateProposeParserV1Request(request) {
  requireObject(request, "request");
  requireUuid(request.requestId, "requestId");
  requireOpaqueDocumentId(request.documentId);
  requireString(request.documentSha256, "documentSha256", {
    pattern: /^[0-9a-f]{64}$/,
  });
  if (!KNOWN_EXTRACTION_MODES.has(request.extractionMode)) {
    throw new ProposeParserError("extractionMode must be DIGITAL_TEXT or OCR", "invalid_request");
  }
  requireObject(request.anonymizedTokenStream, "anonymizedTokenStream");

  const { tokens, pageWidth, pageHeight } = request.anonymizedTokenStream;
  if (!Number.isFinite(Number(pageWidth)) || !Number.isFinite(Number(pageHeight))) {
    throw new ProposeParserError("pageWidth/pageHeight must be finite", "invalid_request");
  }
  if (!Array.isArray(tokens) || tokens.length > MAX_ANONYMIZED_TOKENS) {
    throw new ProposeParserError(
      `tokens must be an array of at most ${MAX_ANONYMIZED_TOKENS}`,
      "invalid_request",
    );
  }
  for (const t of tokens) {
    if (!t || typeof t.text !== "string" || t.text.length > MAX_TOKEN_TEXT_CHARS) {
      throw new ProposeParserError(`token text must be a string of <= ${MAX_TOKEN_TEXT_CHARS}`, "invalid_request");
    }
    if (!t.bbox || !Number.isFinite(Number(t.bbox.x))) {
      throw new ProposeParserError("token bbox.x must be finite", "invalid_request");
    }
  }
  requireObject(request.currentScalarLabels, "currentScalarLabels");
  requireString(request.purpose, "purpose", { pattern: /^[a-z][a-z0-9_]{0,63}$/ });
  return true;
}

/**
 * Validate the suggestion entries returned by the LLM.
 * Throws ProposeParserError with code `provider_response_invalid` on failure.
 */
export function validateSuggestionEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_SUGGESTION_ENTRIES) {
    throw new ProposeParserError(
      `suggestion entries must be an array of 1..${MAX_SUGGESTION_ENTRIES}`,
      "provider_response_invalid",
    );
  }
  for (const entry of entries) {
    requireObject(entry, "suggestion entry");
    for (const key of Object.keys(entry)) {
      if (!KNOWN_ENTRY_KEYS.has(key)) {
        throw new ProposeParserError(`unknown entry key: ${key}`, "provider_response_invalid");
      }
    }
    if (!KNOWN_FIELDS.has(entry.field)) {
      throw new ProposeParserError(`unknown field: ${entry.field}`, "provider_response_invalid");
    }
    requireString(entry.regex, "entry.regex", { max: 1024 });
    try {
      // Compile the regex to prove it's a valid JavaScript pattern. We use a
      // deliberately conservative character set guard below so the accepted
      // regex cannot carry catastrophic-backtracking constructs.
      new RegExp(entry.regex, "i");
    } catch {
      throw new ProposeParserError(`invalid regex: ${entry.regex}`, "provider_response_invalid");
    }
    // Allowed character set: ASCII letters/digits/punct plus Spanish º ° accented
    // letters needed by real label regexes (e.g. `nº`, `fecha facturación`).
    if (!/^[A-Za-z0-9\s\[\]\(\)\.\|\^$*+?{},\-\\/\\\]ÁÉÍÓÚÜÑáéíóúüñº°]+$/u.test(entry.regex)) {
      throw new ProposeParserError("regex contains characters outside the allowed set", "provider_response_invalid");
    }
    // Guard against catastrophic backtracking: nested quantifiers inside a
    // group are a classic ReDoS vector (`(a+)+`, `(a*)*`, `(a|a?)*`). A cheap
    // conservative check rejects a quantifier right after a closing paren that
    // is itself inside another group with its own quantifier.
    if (/(\([^()]*[*+{][^()]*\))+[*+{]/.test(entry.regex) || /(\*|\+|\{\d,\d*\})\(/.test(entry.regex) || /\([^)]*\(/.test(entry.regex) && /\{\d,\d*\}|\*|\+/.test(entry.regex)) {
      throw new ProposeParserError("regex contains a nesting pattern that risks catastrophic backtracking", "provider_response_invalid");
    }
    if (!KNOWN_LABEL_LANGUAGES.has(entry.labelLanguage)) {
      throw new ProposeParserError(`unknown labelLanguage: ${entry.labelLanguage}`, "provider_response_invalid");
    }
    if (!KNOWN_EVIDENCE_SHAPES.has(entry.evidenceShape)) {
      throw new ProposeParserError(`unknown evidenceShape: ${entry.evidenceShape}`, "provider_response_invalid");
    }
  }
  return true;
}

/**
 * Default LLM adapter. Returns null for a disabled provider (fail-closed).
 * Real adapters injected by the runtime return `{ suggestion: { kind,
 * entries } }` or throw.
 */
export async function defaultProposeParserAdapter() {
  return null; // disabled by default — nothing leaves the device.
}

/**
 * Handle a `proposeParserV1` request. This is the module-level, testable core.
 *
 * @param {Object} request — the validated REQUEST envelope
 * @param {Object} deps — `{ providerStatus, sanitize?, adapter?, audit? }`
 * @returns {Object} a `{ status, data | error }` envelope
 */
export async function handleProposeParserCore(request, deps) {
  const {
    providerStatus = { status: "disabled", reason: "release_gate_pending" },
    sanitize = sanitizeTokensForLLM,
    adapter = defaultProposeParserAdapter,
    audit = null,
  } = deps || {};

  const emit = (kind, fields) => {
    if (audit && typeof audit.emit === "function") {
      try {
        audit.emit({ kind, ...fields });
      } catch {
        // Audit sink failure never blocks the operation.
      }
    }
  };

  // 1. Validate.
  try {
    validateProposeParserV1Request(request);
  } catch (err) {
    return { status: "error", error: { code: err.code, message: err.message } };
  }

  // 2. Provider gate (fail-closed).
  if (!providerStatus || providerStatus.status !== "enabled") {
    const disabled = new ProviderDisabledError(request.providerId ?? "default");
    emit("proposeParserV1_registry_state", {
      providerId: request.providerId ?? "default",
      status: providerStatus?.status ?? "missing",
    });
    return { status: "error", error: { code: disabled.code, message: disabled.message } };
  }
  emit("proposeParserV1_registry_state", {
    providerId: request.providerId,
    status: "enabled",
  });

  // 3. Re-sanitize (defense-in-depth). Even if the caller pre-sanitized, the
  //    engine re-runs and re-audits before anything could egress.
  let sanitized;
  try {
    sanitized = sanitize(request.anonymizedTokenStream.tokens, {
      pageWidth: request.anonymizedTokenStream.pageWidth,
      pageHeight: request.anonymizedTokenStream.pageHeight,
    });
  } catch (err) {
    return { status: "error", error: { code: "internal", message: String(err?.message ?? err) } };
  }
  const reAudit = auditSanitizedPayload(sanitized.tokens);
  emit("proposeParserV1_sanitization_call", {
    tokenCount: request.anonymizedTokenStream.tokens.length,
    placeholderCount: sanitized.audit.placeholderCount,
    piiAfter: reAudit.piiRegexMatches,
  });
  if (reAudit.piiRegexMatches > 0) {
    return {
      status: "error",
      error: {
        code: "sanitization_incomplete",
        message: `re-scan found ${reAudit.piiRegexMatches} PII matches; egress refused`,
      },
    };
  }

  // 4. Build egress payload.
  const egressPayload = {
    providerId: request.providerId,
    modelId: request.modelId,
    purpose: request.purpose,
    anonymizedTokenStream: {
      pageWidth: request.anonymizedTokenStream.pageWidth,
      pageHeight: request.anonymizedTokenStream.pageHeight,
      tokens: sanitized.tokens,
    },
    currentScalarLabels: request.currentScalarLabels,
  };
  const byteCount = JSON.stringify(egressPayload).length;
  if (byteCount > MAX_EGRESS_PAYLOAD_BYTES) {
    return {
      status: "error",
      error: { code: "bounded_resource", message: `egress payload exceeds ${MAX_EGRESS_PAYLOAD_BYTES} bytes` },
    };
  }
  emit("proposeParserV1_egress_attempt", {
    providerId: request.providerId,
    byteCount,
  });

  // 5. Invoke adapter.
  let adapterResult;
  try {
    adapterResult = await adapter(egressPayload);
  } catch (err) {
    const code = err?.code === "provider_unavailable" ? "provider_unavailable" : "provider_response_invalid";
    return { status: "error", error: { code, message: String(err?.message ?? err) } };
  }
  if (!adapterResult || !adapterResult.suggestion || !Array.isArray(adapterResult.suggestion.entries)) {
    return {
      status: "error",
      error: { code: "provider_response_invalid", message: "adapter returned no suggestion entries" },
    };
  }

  // 6. Validate response.
  let validated;
  try {
    validateSuggestionEntries(adapterResult.suggestion.entries);
    validated = adapterResult.suggestion.entries;
  } catch (err) {
    emit("proposeParserV1_egress_response", {
      suggestionEntryCount: adapterResult.suggestion.entries.length,
      validationOutcome: err.code,
    });
    return { status: "error", error: { code: err.code, message: err.message } };
  }
  emit("proposeParserV1_egress_response", {
    suggestionEntryCount: validated.length,
    validationOutcome: "ok",
  });

  // 7. Success.
  return {
    status: "ok",
    data: {
      providerId: request.providerId,
      modelId: request.modelId,
      policyVersion: "1",
      disclosureVersion: "1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      suggestion: {
        kind: "regex_table_extension",
        entries: validated,
      },
    },
  };
}
