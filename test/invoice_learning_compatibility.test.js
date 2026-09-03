import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  protocolMismatchResponse,
  validateLearnedRequest,
  validateRequest,
} from "../src/engine-protocol.js";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const FALLBACK_REQUEST_ID = "550e8400-e29b-41d4-a716-446655440001";
const CORRELATION_ID = "cor_0123456789abcdef0123456789abcdef";
const FALLBACK_CORRELATION_ID = "cor_abcdef0123456789abcdef0123456789";
const PDF = Buffer.from("%PDF-1.7\n");

function documentRef() {
  return {
    name: "invoice.pdf",
    byteLength: PDF.length,
    sha256: createHash("sha256").update(PDF).digest("hex"),
    pdfBase64: PDF.toString("base64"),
  };
}

function learnedRequest() {
  return {
    protocolVersion: 1,
    kind: "extractInvoiceV1",
    requestId: REQUEST_ID,
    operationCorrelationId: CORRELATION_ID,
    capability: "legacy",
    invoiceEvidenceSchemaVersion: "1",
    document: documentRef(),
    limits: { maxPages: 100, maxChars: 80_000 },
  };
}

function extractionOnlyRequest() {
  return {
    protocolVersion: 1,
    kind: "extractLocal",
    requestId: FALLBACK_REQUEST_ID,
    operationCorrelationId: FALLBACK_CORRELATION_ID,
    document: documentRef(),
    limits: { maxPages: 100, maxChars: 80_000 },
  };
}

test("protocol mismatch is terminal and extraction-only fallback has a new operation identity", () => {
  const mismatch = protocolMismatchResponse(learnedRequest());

  assert.throws(() => validateLearnedRequest(learnedRequest()), {
    code: "protocol_mismatch",
  });
  assert.equal(mismatch.status, "error");
  assert.equal(mismatch.kind, "extractInvoiceV1");
  assert.equal(mismatch.requestId, REQUEST_ID);
  assert.equal(mismatch.error.code, "protocol_mismatch");
  assert.equal(mismatch.error.retry, "never");
  assert.equal(validateRequest(extractionOnlyRequest()), undefined);
  assert.notEqual(extractionOnlyRequest().requestId, mismatch.requestId);
  assert.notEqual(
    extractionOnlyRequest().operationCorrelationId,
    learnedRequest().operationCorrelationId,
  );
});
