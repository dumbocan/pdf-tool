// WU-3D1: privacy sidecar dispatch tests.
//
// The engine-stdio.js now doubles as the privacy transaction sidecar: it
// accepts `prepareLlmExtraction` / `confirmLlmExtraction` /
// `validateLlmResponse` requests and routes them through the Slice 3
// PrivacyTransactionService. The provider registry defaults to `disabled`,
// so today's tests exercise the fail-closed path end-to-end.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

import { parseFrame } from "../src/engine-protocol.js";

const REQ_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_DOC_ID = "AAAAAAAAAAAAAAAAAAAAAA";

function frameMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32BE(payload.length, 0);
  payload.copy(buf, 4);
  return buf;
}

function runAdapter(inputBuf) {
  return new Promise((resolve) => {
    const proc = spawn("node", ["src/engine-stdio.js"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (d) => stdout.push(d));
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("close", (code) =>
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code }),
    );
    proc.stdin.write(inputBuf);
    proc.stdin.end();
  });
}

async function runWith(req) {
  const { stdout, stderr, code } = await runAdapter(frameMessage(req));
  let json = null;
  try {
    json = parseFrame(stdout).json;
  } catch {
    /* ignore */
  }
  return { json, stderr: stderr.toString(), code };
}

describe("WU-3D1 privacy sidecar: prepareLlmExtraction", () => {
  it("returns provider_disabled through the response envelope (default fail-closed registry)", async () => {
    const { json, code } = await runWith({
      protocolVersion: 1,
      kind: "prepareLlmExtraction",
      requestId: REQ_ID,
      documentId: VALID_DOC_ID,
      providerId: "minimax",
      modelId: "MiniMax-M3",
      purpose: "extract_invoice",
      disclosureVersion: "v1",
      transformedPolicyVersion: "pseudonymize-v1",
      localExtraction: {
        provenance: "local_deterministic",
        documentSha256: "0".repeat(64),
        status: "complete",
        pagesProcessed: 1,
        truncationReason: null,
        extractionMode: "digital_text",
        invoice: {
          invoiceNumber: null,
          invoiceDate: null,
          simplifiedInvoiceDate: null,
          taxLabel: null,
          totals: { subtotal: null, tax: null, total: null },
          matched: [],
        },
        untrusted: true,
      },
    });
    assert.equal(code, 0);
    assert.equal(json.protocolVersion, 1);
    assert.equal(json.kind, "prepareLlmExtraction");
    assert.equal(json.requestId, REQ_ID);
    assert.equal(json.status, "error");
    assert.equal(json.error.code, "provider_disabled");
  });

  it("rejects unknown documentId with a typed protocol error", async () => {
    const { json } = await runWith({
      protocolVersion: 1,
      kind: "prepareLlmExtraction",
      requestId: REQ_ID,
      documentId: "not-a-valid-doc-id",
      providerId: "minimax",
      modelId: "MiniMax-M3",
      purpose: "extract_invoice",
      disclosureVersion: "v1",
      transformedPolicyVersion: "pseudonymize-v1",
      localExtraction: {},
    });
    assert.equal(json.status, "error");
    assert.equal(json.error, "invalid_document_id");
  });

  it("rejects unknown kind with a typed protocol error", async () => {
    const { json } = await runWith({
      protocolVersion: 1,
      kind: "bogusKind",
      requestId: REQ_ID,
      documentId: VALID_DOC_ID,
      providerId: "minimax",
      modelId: "MiniMax-M3",
      purpose: "extract_invoice",
      disclosureVersion: "v1",
      transformedPolicyVersion: "pseudonymize-v1",
    });
    assert.equal(json.status, "error");
    assert.equal(json.error, "kind_unsupported");
  });

  it("rejects unknown top-level fields defensively", async () => {
    const { json } = await runWith({
      protocolVersion: 1,
      kind: "prepareLlmExtraction",
      requestId: REQ_ID,
      documentId: VALID_DOC_ID,
      providerId: "minimax",
      modelId: "MiniMax-M3",
      purpose: "extract_invoice",
      disclosureVersion: "v1",
      transformedPolicyVersion: "pseudonymize-v1",
      evil_secret: "leak-into-service",
    });
    assert.equal(json.status, "error");
    assert.equal(json.error, "unknown_field");
  });
});

describe("WU-3D1 privacy sidecar: confirmLlmExtraction", () => {
  it("returns tx_unknown because the default registry never bound the transaction", async () => {
    // The provider_disabled gate fires at prepare() time. confirm() runs
    // after prepare() and looks the transaction up by id; with no
    // successful prepare() the lookup misses and the service returns
    // tx_unknown. This proves the response carries the typed envelope
    // even though the SSR-style "happy" path is gated.
    const { json, code } = await runWith({
      protocolVersion: 1,
      kind: "confirmLlmExtraction",
      requestId: REQ_ID,
      transactionId: randomBytes(16).toString("base64url"),
    });
    assert.equal(code, 0);
    assert.equal(json.status, "error");
    assert.equal(json.error.code, "tx_unknown");
  });

  it("rejects malformed transactionId", async () => {
    const { json } = await runWith({
      protocolVersion: 1,
      kind: "confirmLlmExtraction",
      requestId: REQ_ID,
      transactionId: "not-a-tx",
    });
    assert.equal(json.status, "error");
    assert.equal(json.error, "invalid_transaction_id");
  });
});

describe("WU-3D1 privacy sidecar: validateLlmResponse", () => {
  it("returns tx_unknown when the registry is default and no transaction was bound", async () => {
    const { json } = await runWith({
      protocolVersion: 1,
      kind: "validateLlmResponse",
      requestId: REQ_ID,
      transactionId: randomBytes(16).toString("base64url"),
      responseBytesBase64: Buffer.from("{}").toString("base64"),
      contentType: "application/json",
    });
    assert.equal(json.status, "error");
    assert.equal(json.error.code, "tx_unknown");
  });
});
