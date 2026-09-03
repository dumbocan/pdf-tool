import assert from "node:assert/strict";
import test from "node:test";
import {
  LEARNED_LIMITS,
  MAX_FRAME_BYTES,
  MAX_PDF_BYTES,
  MAX_OPERATION_DEADLINE_MS,
  frameLearnedResponse,
  parseFrame,
  validateLearnedBounds,
} from "../src/engine-protocol.js";
import { diagnosticLine } from "../src/diagnostics.js";

const correlation = "cor_0123456789abcdef0123456789abcdef";
const requestId = "550e8400-e29b-41d4-a716-446655440000";

function frame(json) {
  const payload = Buffer.from(json, "utf8");
  const output = Buffer.alloc(4 + payload.length);
  output.writeUInt32BE(payload.length, 0);
  payload.copy(output, 4);
  return output;
}

function result(overrides = {}) {
  return {
    pageCount: 1,
    extractedCharacterCount: 1,
    record: { lineItems: [] },
    ...overrides,
  };
}

test("publishes the closed finite learned-loop limits", () => {
  assert.deepEqual(LEARNED_LIMITS, {
    maxPdfBytes: 12_582_912,
    maxPages: 100,
    maxCharacters: 80_000,
    maxRows: 500,
    maxEvidenceFragments: 16_384,
    maxSerializedResultBytes: 1_048_576,
  });
  assert.equal(MAX_PDF_BYTES, 12_582_912);
  assert.equal(MAX_FRAME_BYTES, 20_971_520);
  assert.equal(MAX_OPERATION_DEADLINE_MS, 60_000);
});

test("rejects duplicate keys and oversized frames before JSON parsing", () => {
  assert.throws(() => parseFrame(frame('{"a":1,"a":2}')), (error) => error.code === "duplicate_keys");
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32BE(MAX_FRAME_BYTES, 0);
  assert.throws(() => parseFrame(oversized), (error) => error.code === "frame_too_large");
});

test("rejects every learned result bound without truncating content", () => {
  const cases = [
    ["pages", result({ pageCount: 101 })],
    ["characters", result({ extractedCharacterCount: 80_001 })],
    ["rows", result({ record: { lineItems: Array.from({ length: 501 }, () => ({})) } })],
    ["fragments", result({ evidence: Array.from({ length: 16_385 }, () => ({ evidenceId: "ev" })) })],
  ];
  for (const [unit, value] of cases) {
    assert.throws(() => validateLearnedBounds(value), (error) => {
      assert.equal(error.code, "bounded_resource");
      assert.equal(error.unit, unit);
      assert.equal(error.count > error.limit, true);
      assert.equal(error.message, "bounded_resource");
      return true;
    });
  }
});

test("returns a bounded typed failure instead of an oversized learned result", () => {
  const response = frameLearnedResponse({
    protocolVersion: 1,
    kind: "extractInvoiceV1",
    requestId,
    operationCorrelationId: correlation,
    status: "ok",
    data: { text: "supplier-value", padding: "x".repeat(LEARNED_LIMITS.maxSerializedResultBytes) },
  });
  const payload = response.subarray(4).toString("utf8");
  const parsed = JSON.parse(payload);
  assert.equal(response.readUInt32BE(0) < LEARNED_LIMITS.maxSerializedResultBytes, true);
  assert.equal(parsed.status, "error");
  assert.equal(parsed.error.code, "bounded_resource");
  assert.deepEqual(parsed.error.safeContext, {
    limit: LEARNED_LIMITS.maxSerializedResultBytes,
    unit: "bytes",
    capability: "invoice_learning_v1",
  });
  assert.equal(payload.includes("supplier-value"), false);
  assert.equal(payload.includes(correlation), true);
  const malformed = JSON.parse(frameLearnedResponse({
    kind: "extractInvoiceV1", requestId, operationCorrelationId: correlation,
    status: "ok", data: { amount: Number.NaN },
  }).subarray(4).toString("utf8"));
  assert.equal(malformed.error.code, "schema_invalid");
  assert.equal(JSON.stringify(malformed).includes("NaN"), false);
});

test("diagnostics contain bounded stage, count, duration, and opaque correlation only", () => {
  const line = diagnosticLine("response_failed", "failed", {
    errorCode: "capacity_exhausted",
    chars: 80_001,
  }, correlation, 17);
  assert.equal(line.includes("supplier-value"), false);
  assert.equal(line.includes("/private/"), false);
  const event = JSON.parse(line.slice("NELUPDF_DIAG ".length));
  assert.deepEqual(event.metrics, { errorCode: "capacity_exhausted", chars: 80_001 });
  assert.equal(event.operationCorrelationId, correlation);
  assert.equal(event.elapsedMs, 17);
});

test("malformed learned input yields only safe correlation and stage data", () => {
  const response = frameLearnedResponse({
    protocolVersion: 1,
    kind: "extractInvoiceV1",
    requestId,
    operationCorrelationId: correlation,
    status: "error",
    error: { code: "schema_invalid", messageKey: "bad_payload", retry: "never", safeContext: null },
  });
  const parsed = JSON.parse(response.subarray(4).toString("utf8"));
  assert.equal(parsed.error.code, "schema_invalid");
  assert.equal(parsed.error.messageKey, "bad_payload");
  assert.equal(parsed.operationCorrelationId, correlation);
  assert.equal(Object.hasOwn(parsed, "message"), false);
});
