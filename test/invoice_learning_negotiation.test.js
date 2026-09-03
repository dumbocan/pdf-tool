import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import test from "node:test";

import {
  LEARNED_LIMITS,
  LEARNED_OPERATIONS,
  createNegotiationResponse,
  frameLearnedResponse,
  parseFrame,
  protocolMismatchResponse,
  validateLearnedRequest,
  validateNegotiationRequest,
  validateNegotiationResponse,
} from "../src/engine-protocol.js";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const CORRELATION_ID = "cor_0123456789abcdef0123456789abcdef";
const PDF = readFileSync(new URL("../fixtures/invoice-learning/synthetic.same-layout.first.pdf", import.meta.url));

function documentRef() {
  return {
    documentId: "AAAAAAAAAAAAAAAAAAAAAA",
    name: "invoice.pdf",
    byteLength: PDF.length,
    sha256: createHash("sha256").update(PDF).digest("hex"),
    pdfBase64: PDF.toString("base64"),
  };
}

function negotiationRequest(overrides = {}) {
  return {
    protocolVersion: 1,
    kind: "negotiateInvoiceLearning",
    requestId: REQUEST_ID,
    operationCorrelationId: CORRELATION_ID,
    ...overrides,
  };
}

function extractRequest(overrides = {}) {
  return {
    protocolVersion: 1,
    kind: "extractInvoiceV1",
    requestId: REQUEST_ID,
    operationCorrelationId: CORRELATION_ID,
    capability: "invoice_learning_v1",
    invoiceEvidenceSchemaVersion: "1",
    document: documentRef(),
    limits: { maxPages: 100, maxChars: 80_000 },
    ...overrides,
  };
}

function frame(json) {
  const payload = Buffer.from(JSON.stringify(json), "utf8");
  const result = Buffer.alloc(payload.length + 4);
  result.writeUInt32BE(payload.length, 0);
  payload.copy(result, 4);
  return result;
}

function runEngine(message) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["bin/pdf-tool-engine.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (code) => {
      const output = Buffer.concat(stdout);
      resolve({ code, stderr: Buffer.concat(stderr).toString("utf8"), output,
        json: output.length ? parseFrame(output).json : null });
    });
    child.stdin.end(message);
  });
}

test("negotiation advertises exactly the ordered learned capability", () => {
  const request = negotiationRequest();
  assert.equal(validateNegotiationRequest(request), true);
  const response = createNegotiationResponse(request);
  assert.equal(validateNegotiationResponse(response), true);
  assert.deepEqual(response.operations, [
    "extractInvoiceV1",
    "replayTemplateV1",
    "renderPageV1",
    "proposalPrepareV1",
    "proposalSubmitV1",
    "proposalCancelV1",
  ]);
  assert.deepEqual(response.limits, LEARNED_LIMITS);
  assert.deepEqual(LEARNED_OPERATIONS, response.operations);
  assert.equal(response.capability, "invoice_learning_v1");
  assert.equal(response.invoiceEvidenceSchemaVersion, "1");
  assert.equal(response.templateSchemaVersion, "1");
  assert.equal(response.executionPolicyVersion, "1");
  assert.equal(response.projectionSchemaVersion, "1");
  assert.equal(response.proposalResponseSchemaVersion, "1");
  assert.equal(Object.hasOwn(response, "operations"), true);
});

test("negotiation rejects unknown fields and wrong or missing versions", () => {
  for (const mutation of [
    { protocolVersion: 2 },
    { kind: "negotiateInvoiceLearningV2" },
    { extra: true },
  ]) {
    const request = negotiationRequest(mutation);
    const response = protocolMismatchResponse(request);
    assert.equal(response.status, "error");
    assert.equal(response.error.code, "protocol_mismatch");
    assert.equal(response.error.retry, "never");
    assert.equal(validateNegotiationResponse(response), true);
    assert.equal(Object.hasOwn(response, "operations"), false);
  }
  assert.throws(() => validateNegotiationRequest({ ...negotiationRequest(), operationCorrelationId: undefined }));
});

test("learned requests require exact capability and all declared versions", () => {
  assert.equal(validateLearnedRequest(extractRequest()), true);
  for (const field of [
    "capability",
    "invoiceEvidenceSchemaVersion",
  ]) {
    const invalid = extractRequest({ [field]: field === "capability" ? "legacy" : "2" });
    const response = protocolMismatchResponse(invalid);
    assert.equal(response.kind, "extractInvoiceV1");
    assert.equal(response.requestId, REQUEST_ID);
    assert.equal(response.error.code, "protocol_mismatch");
    assert.equal(response.error.retry, "never");
  }
  assert.throws(() => validateLearnedRequest(extractRequest({ limits: { maxPages: 99, maxChars: 80_000 } })));
});

test("stable executable negotiates without falling back to legacy extraction", async () => {
  const negotiated = await runEngine(frame(negotiationRequest()));
  assert.equal(negotiated.code, 0);
  assert.equal(negotiated.json.kind, "negotiateInvoiceLearningResponse");
  assert.equal(negotiated.json.status, "ok");
  assert.deepEqual(negotiated.json.operations, LEARNED_OPERATIONS);
  assert.equal(negotiated.output.length, negotiated.output.readUInt32BE(0) + 4);

  const mismatch = await runEngine(frame(extractRequest({ capability: "legacy" })));
  assert.equal(mismatch.code, 0);
  assert.equal(mismatch.json.kind, "extractInvoiceV1");
  assert.equal(mismatch.json.status, "error");
  assert.equal(mismatch.json.error.code, "protocol_mismatch");
  assert.equal(mismatch.json.error.retry, "never");
  assert.doesNotMatch(mismatch.stderr, /fallback|downgrade|legacy/i);
});

test("learned response framing remains bounded and never truncates an envelope", () => {
  const response = frameLearnedResponse({
    protocolVersion: 1,
    kind: "extractInvoiceV1",
    requestId: REQUEST_ID,
    status: "ok",
    data: { padding: "x".repeat(LEARNED_LIMITS.maxSerializedResultBytes) },
  });
  const parsed = parseFrame(response).json;
  assert.equal(response.readUInt32BE(0) <= LEARNED_LIMITS.maxSerializedResultBytes, true);
  assert.equal(parsed.status, "error");
  assert.equal(parsed.error.code, "bounded_resource");
  assert.equal(Object.hasOwn(parsed, "data"), false);
});
