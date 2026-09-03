import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { validateOperation } from "./invoice-learning-contract.js";

// Closed learned-loop resource limits (design §§2.3, 3.2, 4.1).
export const MAX_FRAME_BYTES = 20_971_520;
export const MAX_FRAME_PAYLOAD_BYTES = MAX_FRAME_BYTES - 4;
export const MAX_REQUEST_BYTES = 17_825_792; // legacy request cap; frame cap remains MAX_FRAME_BYTES
export const MAX_PDF_BYTES = 12_582_912;
export const MAX_BASE64_LENGTH = 16_777_216;
export const MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_OPERATION_DEADLINE_MS = 60_000;
export const MAX_STDERR_BYTES = 4_096;
export const LEARNED_LIMITS = Object.freeze({
  maxPdfBytes: MAX_PDF_BYTES,
  maxPages: 100,
  maxCharacters: 80_000,
  maxRows: 500,
  maxEvidenceFragments: 16_384,
  maxSerializedResultBytes: MAX_RESPONSE_BYTES,
});

// Canonical UUID v4: 8-4-4-4-12 lowercase hex, version=4, variant=8/9/a/b
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/;

const ALLOWED_TOP = new Set(["protocolVersion", "kind", "requestId", "document", "limits"]);
const ALLOWED_DOC = new Set(["name", "byteLength", "sha256", "pdfBase64"]);
const ALLOWED_LIMIT = new Set(["maxPages", "maxChars"]);
const MAX_PAGES = 100;
const MAX_CHARS = 80_000;
export const LEARNED_OPERATIONS = Object.freeze([
  "extractInvoiceV1",
  "replayTemplateV1",
  "renderPageV1",
  "proposalPrepareV1",
  "proposalSubmitV1",
  "proposalCancelV1",
]);
const LEARNED_KINDS = new Set(LEARNED_OPERATIONS);
const CONTRACT_DIGEST = JSON.parse(readFileSync(new URL("../contracts/invoice-learning/v1/manifest.json", import.meta.url), "utf8")).contractDigest;
const SAFE_ERROR_CODES = new Set(["schema_invalid", "bounded_resource", "invalid_request"]);
const ERROR_CODES = new Set([
  "invalid_request", "schema_invalid", "semantic_invalid", "unsupported_input", "evidence_missing",
  "low_confidence", "layout_mismatch", "template_invalid", "protocol_mismatch", "engine_unavailable",
  "engine_lost", "timeout", "cancelled", "bounded_resource", "persistence_failure", "provider_disabled",
  "provider_unavailable", "provider_response_invalid", "transaction_unknown", "transaction_expired",
  "transaction_consumed", "transaction_mismatch", "internal",
]);
const CORRELATION_RE = /^cor_[0-9a-f]{32}$/;

function ownKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

function assertExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw protocolError("schema_invalid");
  const expected = new Set(keys);
  if (ownKeys(value).length !== expected.size || ownKeys(value).some((key) => !expected.has(key))) {
    throw protocolError("schema_invalid");
  }
}

function assertIdentity(value, { kind, response = false } = {}) {
  if (value.protocolVersion !== 1 || value.kind !== kind || typeof value.requestId !== "string" || !UUID_V4_RE.test(value.requestId)) {
    throw protocolError("protocol_mismatch");
  }
  if (!response && value.operationCorrelationId !== undefined && !CORRELATION_RE.test(value.operationCorrelationId)) {
    throw protocolError("protocol_mismatch");
  }
}

function assertVersion(value, field) {
  if (value[field] !== "1") throw protocolError("protocol_mismatch");
}

function validateSafeContext(value) {
  if (value === null) return;
  assertExactKeys(value, ["limit", "unit", "capability"]);
  if (value.limit !== null && (!Number.isSafeInteger(value.limit) || value.limit < 0 || value.limit > 20_971_520)) throw protocolError("schema_invalid");
  if (value.unit !== null && !new Set(["bytes", "pages", "characters", "rows", "fragments", "tokens", "relationships"]).has(value.unit)) throw protocolError("schema_invalid");
  if (value.capability !== null && (typeof value.capability !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(value.capability))) throw protocolError("schema_invalid");
}

function validateError(error) {
  assertExactKeys(error, ["code", "messageKey", "retry", "safeContext"]);
  if (!ERROR_CODES.has(error.code) || typeof error.messageKey !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(error.messageKey)) throw protocolError("schema_invalid");
  if (!["never", "user_action", "new_transaction", "restart_app"].includes(error.retry)) throw protocolError("schema_invalid");
  validateSafeContext(error.safeContext);
}

function learnedVersionFields(kind) {
  if (kind === "extractInvoiceV1") return ["capability", "invoiceEvidenceSchemaVersion"];
  if (kind === "replayTemplateV1") return ["capability", "invoiceEvidenceSchemaVersion", "templateSchemaVersion", "executionPolicyVersion"];
  if (kind === "renderPageV1") return ["capability"];
  return ["capability", "proposalResponseSchemaVersion"];
}

export function validateNegotiationRequest(request) {
  assertExactKeys(request, ["protocolVersion", "kind", "requestId", "operationCorrelationId"]);
  assertIdentity(request, { kind: "negotiateInvoiceLearning" });
  if (!CORRELATION_RE.test(request.operationCorrelationId)) throw protocolError("protocol_mismatch");
  return true;
}

export function validateNegotiationResponse(response) {
  const status = response?.status;
  if (status === "ok") {
    assertExactKeys(response, ["protocolVersion", "kind", "requestId", "status", "capability", "invoiceEvidenceSchemaVersion", "templateSchemaVersion", "executionPolicyVersion", "projectionSchemaVersion", "proposalResponseSchemaVersion", "operations", "limits", "contractDigest"]);
    assertIdentity(response, { kind: "negotiateInvoiceLearningResponse", response: true });
    for (const field of ["invoiceEvidenceSchemaVersion", "templateSchemaVersion", "executionPolicyVersion", "projectionSchemaVersion", "proposalResponseSchemaVersion"]) assertVersion(response, field);
    if (response.capability !== "invoice_learning_v1" || JSON.stringify(response.operations) !== JSON.stringify(LEARNED_OPERATIONS)) throw protocolError("protocol_mismatch");
    if (JSON.stringify(Object.keys(response.limits).sort()) !== JSON.stringify(Object.keys(LEARNED_LIMITS).sort()) || Object.entries(LEARNED_LIMITS).some(([key, value]) => response.limits[key] !== value)) throw protocolError("schema_invalid");
    if (!SHA256_HEX_RE.test(response.contractDigest) || response.contractDigest !== CONTRACT_DIGEST) throw protocolError("protocol_mismatch");
    return true;
  }
  if (status === "error") {
    assertExactKeys(response, ["protocolVersion", "kind", "requestId", "status", "capability", "invoiceEvidenceSchemaVersion", "templateSchemaVersion", "executionPolicyVersion", "projectionSchemaVersion", "proposalResponseSchemaVersion", "error"]);
    assertIdentity(response, { kind: "negotiateInvoiceLearningResponse", response: true });
    for (const field of ["invoiceEvidenceSchemaVersion", "templateSchemaVersion", "executionPolicyVersion", "projectionSchemaVersion", "proposalResponseSchemaVersion"]) assertVersion(response, field);
    if (response.capability !== "invoice_learning_v1") throw protocolError("protocol_mismatch");
    validateError(response.error);
    return true;
  }
  throw protocolError("schema_invalid");
}

export function createNegotiationResponse(request) {
  validateNegotiationRequest(request);
  const response = {
    protocolVersion: 1,
    kind: "negotiateInvoiceLearningResponse",
    requestId: request.requestId,
    status: "ok",
    capability: "invoice_learning_v1",
    invoiceEvidenceSchemaVersion: "1",
    templateSchemaVersion: "1",
    executionPolicyVersion: "1",
    projectionSchemaVersion: "1",
    proposalResponseSchemaVersion: "1",
    operations: [...LEARNED_OPERATIONS],
    limits: { ...LEARNED_LIMITS },
    contractDigest: CONTRACT_DIGEST,
  };
  validateNegotiationResponse(response);
  return response;
}

export function protocolMismatchResponse(request) {
  const isNegotiation = request?.kind === "negotiateInvoiceLearning" || (typeof request?.kind === "string" && request.kind.startsWith("negotiateInvoiceLearning"));
  if (isNegotiation) {
    return {
      protocolVersion: 1,
      kind: "negotiateInvoiceLearningResponse",
      requestId: typeof request?.requestId === "string" && UUID_V4_RE.test(request.requestId) ? request.requestId : null,
      status: "error",
      capability: "invoice_learning_v1",
      invoiceEvidenceSchemaVersion: "1",
      templateSchemaVersion: "1",
      executionPolicyVersion: "1",
      projectionSchemaVersion: "1",
      proposalResponseSchemaVersion: "1",
      error: { code: "protocol_mismatch", messageKey: "protocol_mismatch", retry: "never", safeContext: null },
    };
  }
  return {
    protocolVersion: 1,
    kind: LEARNED_KINDS.has(request?.kind) ? request.kind : "extractInvoiceV1",
    requestId: typeof request?.requestId === "string" && UUID_V4_RE.test(request.requestId) ? request.requestId : null,
    status: "error",
    error: { code: "protocol_mismatch", messageKey: "protocol_mismatch", retry: "never", safeContext: null },
  };
}

export function operationErrorResponse(request, code = "unsupported_input") {
  const errorCode = ERROR_CODES.has(code) ? code : "internal";
  return {
    protocolVersion: 1,
    kind: LEARNED_KINDS.has(request?.kind) ? request.kind : "extractInvoiceV1",
    requestId: typeof request?.requestId === "string" && UUID_V4_RE.test(request.requestId) ? request.requestId : null,
    status: "error",
    error: { code: errorCode, messageKey: errorCode, retry: "user_action", safeContext: null },
  };
}

export function validateLearnedRequest(request) {
  if (!LEARNED_KINDS.has(request?.kind)) throw protocolError("protocol_mismatch");
  const requiredVersions = learnedVersionFields(request.kind);
  for (const field of requiredVersions) {
    if (field === "capability" && request[field] !== "invoice_learning_v1") throw protocolError("protocol_mismatch");
    if (field !== "capability") assertVersion(request, field);
  }
  assertIdentity(request, { kind: request.kind });
  validateOperation(request);
  return true;
}

export function validateLearnedResponse(response) {
  if (!LEARNED_KINDS.has(response?.kind)) throw protocolError("protocol_mismatch");
  assertIdentity(response, { kind: response.kind, response: true });
  validateOperation(response);
  return true;
}


function err(code) { return new Error(code); }

// ---- Frame layer (parseFrame) — 32-bit BE length prefix + UTF-8 JSON ----

function protocolError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function skipWhitespace(text, index) {
  while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1;
  return index;
}

// Scan raw JSON before JSON.parse: JSON.parse silently overwrites duplicate keys.
// This scanner only records object-key identity and never materializes semantic data.
function assertNoDuplicateKeys(text) {
  let index = 0;
  const parseString = () => {
    const start = index;
    if (text[index++] !== '"') throw protocolError("invalid_json");
    while (index < text.length) {
      const char = text[index++];
      if (char === "\\") index += 1;
      else if (char === '"') return JSON.parse(text.slice(start, index));
      else if (char < " ") throw protocolError("invalid_json");
    }
    throw protocolError("invalid_json");
  };
  const parseValue = (depth = 0) => {
    if (depth > 256) throw protocolError("invalid_json");
    index = skipWhitespace(text, index);
    if (text[index] === '"') { parseString(); return; }
    if (text[index] === "{") {
      index += 1;
      const keys = new Set();
      index = skipWhitespace(text, index);
      if (text[index] === "}") { index += 1; return; }
      while (index < text.length) {
        index = skipWhitespace(text, index);
        const key = parseString();
        if (keys.has(key)) throw protocolError("duplicate_keys");
        keys.add(key);
        index = skipWhitespace(text, index);
        if (text[index++] !== ":") throw protocolError("invalid_json");
        parseValue(depth + 1);
        index = skipWhitespace(text, index);
        if (text[index] === "}") { index += 1; return; }
        if (text[index++] !== ",") throw protocolError("invalid_json");
      }
      throw protocolError("invalid_json");
    }
    if (text[index] === "[") {
      index += 1;
      index = skipWhitespace(text, index);
      if (text[index] === "]") { index += 1; return; }
      while (index < text.length) {
        parseValue(depth + 1);
        index = skipWhitespace(text, index);
        if (text[index] === "]") { index += 1; return; }
        if (text[index++] !== ",") throw protocolError("invalid_json");
      }
      throw protocolError("invalid_json");
    }
    const primitive = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!primitive) throw protocolError("invalid_json");
    index += primitive[0].length;
  };
  parseValue();
  if (skipWhitespace(text, index) !== text.length) throw protocolError("invalid_json");
}

export function parseFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) throw protocolError("empty_frame");
  const length = buffer.readUInt32BE(0);
  if (length === 0) throw protocolError("empty_frame");
  if (length > MAX_FRAME_PAYLOAD_BYTES) throw protocolError("frame_too_large");
  if (buffer.length < 4 + length) throw protocolError("truncated_frame");
  if (buffer.length > 4 + length) throw protocolError("trailing_data");

  const payload = buffer.subarray(4, 4 + length);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(payload); }
  catch { throw protocolError("invalid_json"); }
  assertNoDuplicateKeys(text);
  let value;
  try { value = JSON.parse(text); } catch { throw protocolError("invalid_json"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw protocolError("single_json_value");
  return { json: value, bytes: length };
}

// ---- Frame layer (frameResponse) — encode a JSON object as a 32-bit BE
// length-prefixed UTF-8 payload, capped at MAX_RESPONSE_BYTES.
// If serialization would exceed the cap, the `text` field is truncated
// in-place on a shallow copy. If the payload still exceeds the cap, a
// bounded error envelope is returned instead. (design §5.3)

function encodeFrame(payload) {
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32BE(payload.length, 0);
  payload.copy(buf, 4);
  return buf;
}

export function frameResponse(obj) {
  let payload = Buffer.from(JSON.stringify(obj), "utf8");

  if (payload.length <= MAX_RESPONSE_BYTES) {
    return encodeFrame(payload);
  }

  // Payload exceeds cap: truncate the `text` field (typically the largest).
  const copy = { ...obj };
  if (typeof copy.text === "string" && copy.text.length > 0) {
    const textBytes = Buffer.byteLength(copy.text, "utf8");
    const overhead = payload.length - textBytes;
    // Budget for text: leave 64 bytes of safety margin for JSON structure.
    const maxTextBytes = Math.max(0, MAX_RESPONSE_BYTES - overhead - 64);

    if (maxTextBytes > 0) {
      // Binary search for the largest UTF-8-safe prefix that fits.
      let lo = 0, hi = copy.text.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (Buffer.byteLength(copy.text.slice(0, mid), "utf8") <= maxTextBytes) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      copy.text = copy.text.slice(0, lo);
    } else {
      copy.text = "";
    }

    copy.truncated = true;
    copy.truncation = { reason: "response_capped" };

    payload = Buffer.from(JSON.stringify(copy), "utf8");
    if (payload.length <= MAX_RESPONSE_BYTES) {
      return encodeFrame(payload);
    }
  }

  // Even after truncation the payload exceeds the cap — return a bounded
  // error envelope whose size is guaranteed well under the limit.
  const errObj = {
    protocolVersion: 1,
    kind: "extractLocal",
    requestId: typeof obj.requestId === "string" ? obj.requestId : null,
    status: "error",
    error: "response_exceeds_limit",
    message: "response capped at MAX_RESPONSE_BYTES",
  };
  return encodeFrame(Buffer.from(JSON.stringify(errObj), "utf8"));
}

function boundedFailure(code, unit = null, count = null, limit = null) {
  const error = protocolError(code);
  error.unit = unit;
  error.count = count;
  error.limit = limit;
  return error;
}

function boundNumber(value, unit, limit) {
  if (!Number.isInteger(value) || value < 0) throw protocolError("schema_invalid");
  if (value > limit) throw boundedFailure("bounded_resource", unit, value, limit);
}

function validateJsonValue(value, seen = new Set(), depth = 0) {
  if (depth > 256) throw protocolError("schema_invalid");
  if (value === null) return;
  if (value === undefined || ["bigint", "function", "symbol"].includes(typeof value)) throw protocolError("schema_invalid");
  if (typeof value === "number" && (!Number.isFinite(value) || !Number.isSafeInteger(value))) throw protocolError("schema_invalid");
  if (typeof value === "string") {
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdfff && !(code >= 0xd800 && code <= 0xdbff && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff)) throw protocolError("schema_invalid");
          if (code >= 0xdc00 && code <= 0xdfff && !(value.charCodeAt(i - 1) >= 0xd800 && value.charCodeAt(i - 1) <= 0xdbff)) throw protocolError("schema_invalid");
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw protocolError("schema_invalid");
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) validateJsonValue(child, seen, depth + 1);
  seen.delete(value);
}

function countEvidence(value, state, depth = 0) {
  if (depth > 256) throw protocolError("schema_invalid");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) countEvidence(item, state, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "evidence") {
      if (!Array.isArray(child)) throw protocolError("schema_invalid");
      if (child.length > 8) throw boundedFailure("bounded_resource", "fragments", child.length, 8);
      state.total += child.length;
      if (state.total > LEARNED_LIMITS.maxEvidenceFragments) {
        throw boundedFailure("bounded_resource", "fragments", state.total, LEARNED_LIMITS.maxEvidenceFragments);
      }
    }
    countEvidence(child, state, depth + 1);
  }
}

export function validateLearnedBounds(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw protocolError("schema_invalid");
  validateJsonValue(result);
  const evidence = result.invoiceEvidence ?? result;
  const pageCount = evidence.pageCount ?? result.pages;
  if (pageCount !== undefined) boundNumber(pageCount, "pages", LEARNED_LIMITS.maxPages);
  const characters = evidence.extractedCharacterCount ??
    (typeof evidence.text === "string" ? evidence.text.length : undefined);
  if (characters !== undefined) boundNumber(characters, "characters", LEARNED_LIMITS.maxCharacters);
  const rows = evidence.record?.lineItems ?? evidence.lineItems ?? result.lineItems;
  if (rows !== undefined) {
    if (!Array.isArray(rows)) throw protocolError("schema_invalid");
    boundNumber(rows.length, "rows", LEARNED_LIMITS.maxRows);
  }
  const state = { total: 0 };
  countEvidence(result, state);
  let serialized;
  try { serialized = Buffer.byteLength(JSON.stringify(result), "utf8"); }
  catch { throw protocolError("schema_invalid"); }
  boundNumber(serialized, "bytes", LEARNED_LIMITS.maxSerializedResultBytes);
  return result;
}

function safeResponseIdentity(obj, key, fallback = null) {
  const value = obj?.[key];
  if (key === "kind") return LEARNED_KINDS.has(value) ? value : "extractInvoiceV1";
  if (key === "requestId") return typeof value === "string" && UUID_V4_RE.test(value) ? value : fallback;
  return typeof value === "string" && /^cor_[0-9a-f]{32}$/.test(value) ? value : fallback;
}

function learnedErrorResponse(obj, code, unit = null, count = null, limit = null) {
  const response = {
    protocolVersion: 1,
    kind: safeResponseIdentity(obj, "kind", "extractInvoiceV1"),
    requestId: safeResponseIdentity(obj, "requestId"),
    status: "error",
    error: {
      code,
      messageKey: code,
      retry: "user_action",
      safeContext: unit ? { limit, unit, capability: "invoice_learning_v1" } : null,
    },
  };
  const correlation = safeResponseIdentity(obj, "operationCorrelationId");
  if (correlation && /^cor_[0-9a-f]{32}$/.test(correlation)) response.operationCorrelationId = correlation;
  return response;
}

// Learned results never truncate: truncation can turn an incomplete invoice into
// plausible data. Legacy frameResponse remains unchanged for the v1/manual path.
export function frameLearnedResponse(obj) {
  let payload;
  try {
    validateLearnedBounds(obj?.status === "ok" ? obj.data ?? obj : obj);
    payload = Buffer.from(JSON.stringify(obj), "utf8");
  } catch (error) {
    const failure = SAFE_ERROR_CODES.has(error?.code) ? error.code : "schema_invalid";
    const bounded = failure === "bounded_resource";
    payload = Buffer.from(JSON.stringify(learnedErrorResponse(
      obj,
      failure,
      bounded ? error.unit : null,
      bounded ? error.count : null,
      bounded ? error.limit : null,
    )), "utf8");
  }
  if (payload.length <= LEARNED_LIMITS.maxSerializedResultBytes) return encodeFrame(payload);
  const fallback = learnedErrorResponse(obj, "bounded_resource", "bytes", payload.length, LEARNED_LIMITS.maxSerializedResultBytes);
  return encodeFrame(Buffer.from(JSON.stringify(fallback), "utf8"));
}

// ---- Request layer ----

function validateName(name) {
  if (typeof name !== "string") throw err("invalid_name");
  if (name.length === 0) throw err("invalid_name");
  if (name.length > 255) throw err("invalid_name");
  if (CONTROL_RE.test(name)) throw err("invalid_name");
  if (name.includes("/") || name.includes("\\")) throw err("invalid_name");

  const utf8Len = Buffer.byteLength(name, "utf8");
  if (utf8Len > 1024) throw err("invalid_name");
}

function validateBase64(b64) {
  if (typeof b64 !== "string") throw err("invalid_base64");
  if (b64.length < 4) throw err("invalid_base64");
  if (b64.length > MAX_BASE64_LENGTH) throw err("invalid_base64");
  if (!BASE64_RE.test(b64)) throw err("invalid_base64");
  let decoded;
  try { decoded = Buffer.from(b64, "base64"); }
  catch { throw err("invalid_base64"); }
  if (decoded.toString("base64") !== b64) throw err("invalid_base64");
}

function validateSha256(hash) {
  if (typeof hash !== "string") throw err("invalid_sha256");
  if (!SHA256_HEX_RE.test(hash)) throw err("invalid_sha256");
}

function validateLimits(limits) {
  if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
    throw err("invalid_limits");
  }

  for (const key of Object.keys(limits)) {
    if (!ALLOWED_LIMIT.has(key)) throw err("unknown_field");
  }

  if (limits.maxPages !== undefined) {
    if (!Number.isInteger(limits.maxPages)) throw err("invalid_max_pages");
    if (limits.maxPages < 1 || limits.maxPages > MAX_PAGES) throw err("invalid_max_pages");
  }

  if (limits.maxChars !== undefined) {
    if (!Number.isInteger(limits.maxChars)) throw err("invalid_max_chars");
    if (limits.maxChars < 1 || limits.maxChars > MAX_CHARS) throw err("invalid_max_chars");
  }
}

// ---- Request layer: validateRequest (design §5.4) ----

export function validateRequest(request) {
  if (typeof request !== "object" || request === null || Array.isArray(request)) {
    throw err("invalid_request_shape");
  }
  if (request.kind === "negotiateInvoiceLearning") return validateNegotiationRequest(request);
  if (LEARNED_KINDS.has(request.kind)) return validateLearnedRequest(request);

  // protocolVersion: must be integer 1
  if (request.protocolVersion !== 1) throw err("protocol_version");

  // Dispatch on `kind` to the per-kind validator. Every kind has a closed
  // allowlist of top-level keys, validated separately so a leaked field on
  // one kind is rejected before it reaches the next consumer.
  switch (request.kind) {
    case "extractLocal":
      return validateExtractLocalRequest(request);
    case "prepareLlmExtraction":
      return validatePrepareLlmExtractionRequest(request);
    case "confirmLlmExtraction":
      return validateConfirmLlmExtractionRequest(request);
    case "validateLlmResponse":
      return validateValidateLlmResponseRequest(request);
    case "proposeParserV1":
      return validateProposeParserV1Request(request);
    default:
      throw err("kind_unsupported");
  }
}

function allowlistOnly(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw err("unknown_field");
  }
}

function validateExtractLocalRequest(request) {
  const allowed = new Set([
    "protocolVersion",
    "kind",
    "requestId",
    "operationCorrelationId",
    "document",
    "limits",
  ]);
  allowlistOnly(request, allowed, "extractLocal");

  // requestId: canonical UUID v4
  if (typeof request.requestId !== "string" || !UUID_V4_RE.test(request.requestId)) {
    throw err("request_id");
  }
  if (request.operationCorrelationId !== undefined && (typeof request.operationCorrelationId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(request.operationCorrelationId))) throw err("operation_correlation_id");

  // document: required object
  const doc = request.document;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw err("missing_document");
  }

  allowlistOnly(doc, ALLOWED_DOC, "document");

  validateName(doc.name);

  // byteLength: integer 1..MAX_PDF_BYTES
  if (!Number.isInteger(doc.byteLength)) throw err("byte_length");
  if (doc.byteLength < 1 || doc.byteLength > MAX_PDF_BYTES) throw err("byte_length");

  validateSha256(doc.sha256);

  // Base64 validation + decode
  validateBase64(doc.pdfBase64);

  let decoded;
  try {
    decoded = Buffer.from(doc.pdfBase64, "base64");
  } catch {
    throw err("base64_decode_failed");
  }

  // Decoded length must match declared byteLength
  if (decoded.length !== doc.byteLength) throw err("length_mismatch");

  // SHA-256 must be the real hash of decoded bytes
  const actualHash = createHash("sha256").update(decoded).digest("hex");
  if (actualHash !== doc.sha256) throw err("hash_mismatch");

  // limits: optional but validated
  if (request.limits !== undefined) {
    validateLimits(request.limits);
  }
}

const ALLOWED_PREPARE_LLM = new Set([
  "protocolVersion",
  "kind",
  "requestId",
  "documentId",
  "providerId",
  "modelId",
  "purpose",
  "disclosureVersion",
  "transformedPolicyVersion",
  "localExtraction",
  "operationCorrelationId",
  "clientRequestId",
]);

const ALLOWED_CONFIRM_LLM = new Set([
  "protocolVersion",
  "kind",
  "requestId",
  "transactionId",
  // Pass-through for content-identity binding (optional, validated when
  // present). The privacy service hashes a fresh localExtraction to detect
  // document mutation between prepare and confirm.
  "documentSha256",
  "localExtraction",
]);

const ALLOWED_VALIDATE_LLM = new Set([
  "protocolVersion",
  "kind",
  "requestId",
  "transactionId",
  "responseBytesBase64",
  "contentType",
]);

const LOCAL_EXTRACTION_MODES = new Set(["digital_text", "ocr", "ocr_required_unavailable"]);
const ALLOWED_LOCAL_EXTRACTION = new Set([
  "provenance",
  "documentSha256",
  "status",
  "pagesProcessed",
  "truncationReason",
  "extractionMode",
  "invoice",
  "reviewPdfBase64",
  "untrusted",
]);

const ALLOWED_INVOICE = new Set([
  "invoiceNumber",
  "invoiceDate",
  "simplifiedInvoiceDate",
  "taxLabel",
  "totals",
  "matched",
]);

const ALLOWED_TOTALS = new Set(["subtotal", "tax", "total"]);

const ALLOWED_MATCHED = new Set(["label", "value", "bbox", "editable"]);

const DOC_ID_LEN = 22;
const BASE64URL_DOC_ID_RE = /^[A-Za-z0-9_-]{22}$/;

function validateLocalExtraction(extraction) {
  if (typeof extraction !== "object" || extraction === null || Array.isArray(extraction)) {
    throw err("invalid_local_extraction");
  }
  allowlistOnly(extraction, ALLOWED_LOCAL_EXTRACTION, "localExtraction");
  if (extraction.extractionMode !== undefined && !LOCAL_EXTRACTION_MODES.has(extraction.extractionMode)) {
    throw err("invalid_extraction_mode");
  }
  if (extraction.invoice !== undefined && extraction.invoice !== null) {
    if (typeof extraction.invoice !== "object" || Array.isArray(extraction.invoice)) {
      throw err("invalid_invoice");
    }
    allowlistOnly(extraction.invoice, ALLOWED_INVOICE, "invoice");
    if (extraction.invoice.totals !== undefined && extraction.invoice.totals !== null) {
      if (typeof extraction.invoice.totals !== "object" || Array.isArray(extraction.invoice.totals)) {
        throw err("invalid_totals");
      }
      allowlistOnly(extraction.invoice.totals, ALLOWED_TOTALS, "totals");
    }
    if (extraction.invoice.matched !== undefined) {
      if (!Array.isArray(extraction.invoice.matched)) throw err("invalid_matched");
      for (const m of extraction.invoice.matched) {
        if (typeof m !== "object" || m === null || Array.isArray(m)) {
          throw err("invalid_matched_entry");
        }
        allowlistOnly(m, ALLOWED_MATCHED, "matched_entry");
      }
    }
  }
}

function validatePrepareLlmExtractionRequest(request) {
  allowlistOnly(request, ALLOWED_PREPARE_LLM, "prepareLlmExtraction");

  if (typeof request.requestId !== "string" || !UUID_V4_RE.test(request.requestId)) {
    throw err("request_id");
  }
  if (typeof request.documentId !== "string" || !BASE64URL_DOC_ID_RE.test(request.documentId)) {
    throw err("invalid_document_id");
  }
  for (const field of [
    "providerId",
    "modelId",
    "purpose",
    "disclosureVersion",
    "transformedPolicyVersion",
  ]) {
    if (typeof request[field] !== "string" || request[field].length === 0) {
      throw err(`invalid_${field}`);
    }
  }
  if (request.localExtraction != null) {
    validateLocalExtraction(request.localExtraction);
  }
  if (
    request.operationCorrelationId !== undefined &&
    request.operationCorrelationId !== null &&
    (typeof request.operationCorrelationId !== "string" ||
      request.operationCorrelationId.length === 0)
  ) {
    throw err("invalid_operation_correlation_id");
  }
  if (
    request.clientRequestId !== undefined &&
    request.clientRequestId !== null &&
    (typeof request.clientRequestId !== "string" ||
      request.clientRequestId.length === 0)
  ) {
    throw err("invalid_client_request_id");
  }
}

function validateConfirmLlmExtractionRequest(request) {
  allowlistOnly(request, ALLOWED_CONFIRM_LLM, "confirmLlmExtraction");

  if (typeof request.requestId !== "string" || !UUID_V4_RE.test(request.requestId)) {
    throw err("request_id");
  }
  if (typeof request.transactionId !== "string" || !BASE64URL_DOC_ID_RE.test(request.transactionId)) {
    throw err("invalid_transaction_id");
  }
  if (request.documentSha256 != null) {
    if (typeof request.documentSha256 !== "string" || !SHA256_HEX_RE.test(request.documentSha256)) {
      throw err("invalid_document_sha256");
    }
  }
  if (request.localExtraction != null) {
    validateLocalExtraction(request.localExtraction);
  }
}

    function validateValidateLlmResponseRequest(request) {
      allowlistOnly(request, ALLOWED_VALIDATE_LLM, "validateLlmResponse");
    
      if (typeof request.requestId !== "string" || !UUID_V4_RE.test(request.requestId)) {
        throw err("request_id");
      }
      if (typeof request.transactionId !== "string" || !BASE64URL_DOC_ID_RE.test(request.transactionId)) {
        throw err("invalid_transaction_id");
      }
      if (typeof request.responseBytesBase64 !== "string") {
        throw err("invalid_response_bytes");
      }
      if (typeof request.contentType !== "string" || request.contentType.length === 0) {
        throw err("invalid_content_type");
      }
    }

    const ALLOWED_PROPOSE_PARSER = new Set([
      "protocolVersion",
      "kind",
      "requestId",
      "documentId",
      "documentSha256",
      "extractionMode",
      "providerId",
      "modelId",
      "anonymizedTokenStream",
      "currentScalarLabels",
      "purpose",
    ]);
    const ALLOWED_TOKEN = new Set([
      "text",
      "page",
      "bbox",
      "confidenceBps",
      "kind",
      "originalKind",
    ]);
    const ALLOWED_BBOX = new Set(["x", "y", "width", "height"]);
    const EXTRACTION_MODES = new Set(["DIGITAL_TEXT", "OCR"]);

    function validateProposeParserV1Request(request) {
      allowlistOnly(request, ALLOWED_PROPOSE_PARSER, "proposeParserV1");
      if (typeof request.requestId !== "string" || !UUID_V4_RE.test(request.requestId)) {
        throw err("request_id");
      }
      if (typeof request.documentId !== "string" || !BASE64URL_DOC_ID_RE.test(request.documentId)) {
        throw err("invalid_document_id");
      }
      if (typeof request.documentSha256 !== "string" || !SHA256_HEX_RE.test(request.documentSha256)) {
        throw err("invalid_document_sha256");
      }
      if (!EXTRACTION_MODES.has(request.extractionMode)) {
        throw err("invalid_extraction_mode");
      }
      for (const field of ["providerId", "modelId", "purpose"]) {
        if (typeof request[field] !== "string" || request[field].length === 0) {
          throw err(`invalid_${field}`);
        }
      }
      const stream = request.anonymizedTokenStream;
      if (typeof stream !== "object" || stream === null || Array.isArray(stream)) {
        throw err("invalid_anonymized_token_stream");
      }
      if (!Number.isInteger(stream.pageWidth) || stream.pageWidth <= 0) throw err("invalid_page_width");
      if (!Number.isInteger(stream.pageHeight) || stream.pageHeight <= 0) throw err("invalid_page_height");
      if (!Array.isArray(stream.tokens) || stream.tokens.length > 16_384) throw err("invalid_token_count");
      for (const t of stream.tokens) {
        if (typeof t !== "object" || t === null || Array.isArray(t)) throw err("invalid_token");
        allowlistOnly(t, ALLOWED_TOKEN, "token");
        if (typeof t.text !== "string" || t.text.length === 0 || t.text.length > 256) {
          throw err("invalid_token_text");
        }
        if (!Number.isInteger(t.page) || t.page < 1 || t.page > 100) throw err("invalid_token_page");
        if (typeof t.bbox !== "object" || t.bbox === null || Array.isArray(t.bbox)) throw err("invalid_token_bbox");
        allowlistOnly(t.bbox, ALLOWED_BBOX, "bbox");
        for (const coord of ["x", "y", "width", "height"]) {
          if (!Number.isFinite(t.bbox[coord])) throw err("invalid_bbox_coordinate");
        }
      }
      const labels = request.currentScalarLabels;
      if (typeof labels !== "object" || labels === null || Array.isArray(labels)) {
        throw err("invalid_current_scalar_labels");
      }
      const allowedLabelKeys = new Set(["invoiceDate", "invoiceNumber", "subtotal", "tax", "total"]);
      allowlistOnly(labels, allowedLabelKeys, "currentScalarLabels");
      for (const key of Object.keys(labels)) {
        if (typeof labels[key] !== "string" || labels[key].length === 0) throw err("invalid_scalar_label");
      }
      return true;
    }

// DOC_ID_LEN is exported for downstream consumers that need to mirror the
// 22-char base64url contract used by the privacy service.
export { DOC_ID_LEN };
