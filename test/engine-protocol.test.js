import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parseFrame,
  validateRequest,
  MAX_REQUEST_BYTES,
  MAX_PDF_BYTES,
  MAX_BASE64_LENGTH,
} from "../src/engine-protocol.js";

// Build a valid v1 extractLocal request. `doc` overrides document fields.
function makeValidRequest(doc = {}, overrides = {}) {
  const pdfBytes = Buffer.from("%PDF-1.4 minimal test content");
  const base = {
    protocolVersion: 1,
    kind: "extractLocal",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    document: {
      name: "invoice.pdf",
      byteLength: pdfBytes.length,
      sha256: createHash("sha256").update(pdfBytes).digest("hex"),
      pdfBase64: pdfBytes.toString("base64"),
    },
    limits: { maxPages: 100, maxChars: 80_000 },
  };
  return { ...base, ...overrides, document: { ...base.document, ...doc } };
}

describe("WU-1C1-RED engine-protocol parseFrame", () => {
  it("parses a minimal valid 32-bit big-endian frame", () => {
    const payload = Buffer.from(JSON.stringify({ hello: "world" }), "utf8");
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);
    assert.deepEqual(parseFrame(frame), { json: { hello: "world" }, bytes: payload.length });
  });

  it("rejects zero-length, truncated, trailing-data, invalid-UTF-8, and non-object JSON", () => {
    // zero-length
    const z = Buffer.alloc(4); z.writeUInt32BE(0, 0);
    assert.throws(() => parseFrame(z), /empty_frame/);
    // truncated
    const t = Buffer.alloc(4); t.writeUInt32BE(100, 0);
    assert.throws(() => parseFrame(t), /truncated_frame/);
    // trailing data
    const tp = Buffer.from(JSON.stringify({ ok: true }), "utf8");
    const td = Buffer.alloc(4 + tp.length + 1);
    td.writeUInt32BE(tp.length, 0);
    tp.copy(td, 4);
    assert.throws(() => parseFrame(td), /trailing_data/);
    // invalid UTF-8
    const u = Buffer.alloc(4 + 3); u.writeUInt32BE(3, 0); u.fill(0xff, 4);
    assert.throws(() => parseFrame(u), /invalid_json/);
    // non-object JSON (array)
    const arr = Buffer.from(JSON.stringify([1, 2, 3]), "utf8");
    const af = Buffer.alloc(4 + arr.length);
    af.writeUInt32BE(arr.length, 0); arr.copy(af, 4);
    assert.throws(() => parseFrame(af), /single_json_value/);
  });
});

describe("WU-1C1-RED engine-protocol validateRequest protocol envelope", () => {
  it("accepts a well-formed v1 extractLocal request", () => {
    assert.doesNotThrow(() => validateRequest(makeValidRequest()));
  });

  it("rejects protocolVersion, kind, requestId, and missing requestId", () => {
    assert.throws(() => validateRequest(makeValidRequest({}, { protocolVersion: 0 })), /protocol_version/);
    assert.throws(() => validateRequest(makeValidRequest({}, { protocolVersion: "1" })), /protocol_version/);
    assert.throws(() => validateRequest(makeValidRequest({}, { kind: "extractWithLlm" })), /kind/);
    assert.throws(() => validateRequest(makeValidRequest({}, { kind: 1 })), /kind/);
    assert.throws(() => validateRequest(makeValidRequest({}, { requestId: "not-a-uuid" })), /request_id/);
    assert.throws(() => validateRequest(makeValidRequest({}, { requestId: "550E8400-E29B-41D4-A716-446655440000" })), /request_id/);
    assert.throws(() => validateRequest(makeValidRequest({}, { requestId: "550e8400-e29b-11d4-a716-446655440000" })), /request_id/);
    const req = makeValidRequest(); delete req.requestId;
    assert.throws(() => validateRequest(req), /request_id/);
  });
});

describe("WU-1C1-RED engine-protocol validateRequest document fields", () => {
  it("rejects bad name, byteLength, sha256 format, base64, byteLength mismatch, and sha256 mismatch", () => {
    const d = makeValidRequest().document;
    // name: NUL/control, path separators, empty, too long
    assert.throws(() => validateRequest(makeValidRequest({ name: "bad\x00name.pdf" })), /name/);
    assert.throws(() => validateRequest(makeValidRequest({ name: "../evil.pdf" })), /name/);
    assert.throws(() => validateRequest(makeValidRequest({ name: "" })), /name/);
    assert.throws(() => validateRequest(makeValidRequest({ name: "a".repeat(256) })), /name/);
    // byteLength: out of range, non-integer
    assert.throws(() => validateRequest(makeValidRequest({ byteLength: 0 })), /byte_length/);
    assert.throws(() => validateRequest(makeValidRequest({ byteLength: MAX_PDF_BYTES + 1 })), /byte_length/);
    assert.throws(() => validateRequest(makeValidRequest({ byteLength: 1.5 })), /byte_length/);
    // sha256: wrong format
    assert.throws(() => validateRequest(makeValidRequest({ sha256: "deadbeef" })), /sha256/);
    assert.throws(() => validateRequest(makeValidRequest({ sha256: "DEADBEEF".repeat(16) })), /sha256/);
    // sha256: wrong hash value (guards against old broken algorithm)
    assert.throws(() => validateRequest(makeValidRequest({ sha256: "0".repeat(64) })), /hash_mismatch/);
    // base64: invalid chars, empty, too short
    assert.throws(() => validateRequest(makeValidRequest({ pdfBase64: "!!!not-base64!!!" })), /base64/);
    assert.throws(() => validateRequest(makeValidRequest({ pdfBase64: "" })), /base64/);
    assert.throws(() => validateRequest(makeValidRequest({ pdfBase64: "ab" })), /base64/);
    // byteLength mismatch with decoded length
    assert.throws(() => validateRequest(makeValidRequest({ byteLength: d.byteLength + 1 })), /length_mismatch/);
  });

  it("rejects missing document", () => {
    const req = makeValidRequest(); delete req.document;
    assert.throws(() => validateRequest(req), /missing_document/);
  });
});

describe("WU-1C1-RED engine-protocol validateRequest limits", () => {
  it("accepts valid limits and missing limits", () => {
    assert.doesNotThrow(() => validateRequest(makeValidRequest({}, { limits: { maxPages: 1, maxChars: 1 } })));
    assert.doesNotThrow(() => validateRequest(makeValidRequest({}, { limits: { maxPages: 100, maxChars: 80_000 } })));
    const req = makeValidRequest(); delete req.limits;
    assert.doesNotThrow(() => validateRequest(req));
  });

  it("rejects maxPages and maxChars out of range", () => {
    assert.throws(() => validateRequest(makeValidRequest({}, { limits: { maxPages: 0 } })), /max_pages/);
    assert.throws(() => validateRequest(makeValidRequest({}, { limits: { maxPages: 101 } })), /max_pages/);
    assert.throws(() => validateRequest(makeValidRequest({}, { limits: { maxChars: 0 } })), /max_chars/);
    assert.throws(() => validateRequest(makeValidRequest({}, { limits: { maxChars: 80_001 } })), /max_chars/);
  });
});

describe("WU-1C1-RED engine-protocol validateRequest reject-unknown", () => {
  it("rejects unknown top-level, document, and limit fields", () => {
    assert.throws(() => validateRequest(makeValidRequest({}, { unknown: 123 })), /unknown/);
    const d = makeValidRequest().document;
    assert.throws(() => validateRequest(makeValidRequest({ ...d, extra: true }))), /unknown/;
    assert.throws(() => validateRequest(makeValidRequest({}, { limits: { maxPages: 100, bogus: true } })), /unknown/);
  });
});

describe("WU-1C1-TRIANGULATE engine-protocol boundary validation", () => {
  it("constants match design §5.4", () => {
    assert.equal(MAX_PDF_BYTES, 12_582_912);
    assert.equal(MAX_BASE64_LENGTH, 16_777_216);
    assert.equal(MAX_REQUEST_BYTES, 17_825_792);
  });

  it("rejects base64 at MAX_BASE64_LENGTH + 1", () => {
    assert.throws(() => validateRequest(makeValidRequest({ pdfBase64: "x".repeat(16_777_217) })), /base64/);
  });

  it("does not throw on a small but valid request", () => {
    assert.doesNotThrow(() => validateRequest(makeValidRequest()));
  });
});
