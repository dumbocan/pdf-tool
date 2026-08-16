import { createHash } from "node:crypto";

// Frame caps (design §5.3)
export const MAX_REQUEST_BYTES = 17_825_792;   // 4-byte prefix + ≤16,777,216 payload
export const MAX_PDF_BYTES = 12_582_912;       // decoded PDF byte cap (inclusive)
export const MAX_BASE64_LENGTH = 16_777_216;   // canonical base64 for max PDF
export const MAX_RESPONSE_BYTES = 1_048_576;   // response payload cap

// Canonical UUID v4: 8-4-4-4-12 lowercase hex, version=4, variant=8/9/a/b
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/;

const ALLOWED_TOP = new Set(["protocolVersion", "kind", "requestId", "document", "limits"]);
const ALLOWED_DOC = new Set(["name", "byteLength", "sha256", "pdfBase64"]);
const ALLOWED_LIMIT = new Set(["maxPages", "maxChars"]);
const MAX_PAGES = 100;
const MAX_CHARS = 80_000;

function err(code) { return new Error(code); }

// ---- Frame layer (parseFrame) — 32-bit BE length prefix + UTF-8 JSON ----

export function parseFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new Error("empty_frame");
  }

  const length = buffer.readUInt32BE(0);
  if (length === 0) {
    throw new Error("empty_frame");
  }

  if (buffer.length < 4 + length) {
    throw new Error("truncated_frame");
  }

  if (buffer.length > 4 + length) {
    throw new Error("trailing_data");
  }

  const payload = buffer.subarray(4, 4 + length);
  let value;
  try {
    value = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("single_json_value");
  }

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

  for (const key of Object.keys(request)) {
    if (!ALLOWED_TOP.has(key)) throw err("unknown_field");
  }

  // protocolVersion: must be integer 1
  if (request.protocolVersion !== 1) throw err("protocol_version");

  // kind: must be exactly "extractLocal"
  if (request.kind !== "extractLocal") throw err("kind_unsupported");

  // requestId: canonical UUID v4
  if (typeof request.requestId !== "string" || !UUID_V4_RE.test(request.requestId)) {
    throw err("request_id");
  }

  // document: required object
  const doc = request.document;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw err("missing_document");
  }

  for (const key of Object.keys(doc)) {
    if (!ALLOWED_DOC.has(key)) throw err("unknown_field");
  }

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
