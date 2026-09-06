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

      it("prepares a transaction when deepseek is the enabled provider", async () => {
        const { json, code } = await runWith({
          protocolVersion: 1,
          kind: "prepareLlmExtraction",
          requestId: REQ_ID,
          documentId: VALID_DOC_ID,
          providerId: "deepseek",
          modelId: "deepseek-chat",
          purpose: "extract_invoice",
          disclosureVersion: "v1",
          transformedPolicyVersion: "pseudonymize-v1",
          operationCorrelationId: "cor_smoke_0000000000000000",
          localExtraction: {
            provenance: "local_deterministic",
            documentSha256: "0".repeat(64),
            status: "complete",
            pagesProcessed: 1,
            truncationReason: null,
            extractionMode: "digital_text",
            invoice: {
              invoiceNumber: "F-1",
              invoiceDate: "2024-01-15",
              simplifiedInvoiceDate: "2024-01-15",
              taxLabel: "IVA",
              totals: { subtotal: "100.00", tax: "21.00", total: "121.00" },
              matched: [
                { label: "invoiceNumber", value: "F-1" },
                { label: "invoiceDate", value: "2024-01-15" },
              ],
            },
            untrusted: true,
          },
        });
        assert.equal(code, 0);
        assert.equal(json.status, "ok");
        assert.equal(json.kind, "prepareLlmExtraction");
        assert.equal(json.requestId, REQ_ID);
        assert.ok(json.data.transactionId, "transactionId present");
        assert.match(json.data.transactionId, /^[A-Za-z0-9_-]{22}$/);
        assert.equal(json.data.providerId, "deepseek");
        assert.equal(json.data.modelId, "deepseek-chat");
        assert.equal(json.data.disclosure.providerId, "deepseek");
        assert.ok(json.data.expiresAt, "expiresAt present");
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

    describe("WU-3D1 persistent sidecar: prepare -> confirm share one process", () => {
      // A persistent engine process keeps ONE module-level
      // PrivacyTransactionService alive across frames. prepare() binds a
      // transaction in frame 1; confirm() must consume the SAME transaction in
      // frame 2. With the one-shot process model this can never work (each
      // frame would run in a fresh process+service), so this test proves the
      // shared-service persistent loop.
      function runPersistent() {
        const proc = spawn(
          "node",
          ["src/engine-stdio.js"],
          {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, PDF_TOOL_ENGINE_PERSISTENT: "1" },
          },
        );
        const stderr = [];
        proc.stderr.on("data", (d) => stderr.push(d));
        const queue = [];
        let buffer = Buffer.alloc(0);
        let waiting = null;
        proc.stdout.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 4) {
            const len = buffer.readUInt32BE(0);
            if (len === 0 || buffer.length < 4 + len) break;
            const payload = buffer.subarray(4, 4 + len);
            buffer = buffer.subarray(4 + len);
            const framed = Buffer.alloc(4 + payload.length);
            framed.writeUInt32BE(payload.length, 0);
            payload.copy(framed, 4);
            let json = null;
            try {
              json = parseFrame(framed).json;
            } catch {
              json = null;
            }
            if (waiting) {
              const resolve = waiting;
              waiting = null;
              resolve(json);
            } else {
              queue.push(json);
            }
          }
        });
        return {
          request(obj) {
            return new Promise((resolve, reject) => {
              if (queue.length > 0) {
                resolve(queue.shift());
                return;
              }
              const timer = setTimeout(
                () => reject(new Error("persistent sidecar response timeout")),
                15000,
              );
              waiting = (json) => {
                clearTimeout(timer);
                resolve(json);
              };
              proc.stdin.write(frameMessage(obj));
            });
          },
          close() {
            return new Promise((resolveClose) => {
              proc.on("close", resolveClose);
              proc.stdin.end();
            });
          },
          get stderr() {
            return Buffer.concat(stderr).toString();
          },
        };
      }

      const LOCAL_EXTRACTION = {
        provenance: "local_deterministic",
        documentSha256: "0".repeat(64),
        status: "complete",
        pagesProcessed: 1,
        truncationReason: null,
        extractionMode: "digital_text",
        invoice: {
          invoiceNumber: "F-1",
          invoiceDate: "2024-01-15",
          simplifiedInvoiceDate: "2024-01-15",
          taxLabel: "IVA",
          totals: { subtotal: "100.00", tax: "21.00", total: "121.00" },
          matched: [
            { label: "invoiceNumber", value: "F-1" },
            { label: "invoiceDate", value: "2024-01-15" },
          ],
        },
        untrusted: true,
      };

      it("confirm consumes the transaction prepared in the same process", async () => {
        const engine = runPersistent();
        try {
          const prepare = await engine.request({
            protocolVersion: 1,
            kind: "prepareLlmExtraction",
            requestId: REQ_ID,
            documentId: VALID_DOC_ID,
            providerId: "deepseek",
            modelId: "deepseek-chat",
            purpose: "extract_invoice",
            disclosureVersion: "v1",
            transformedPolicyVersion: "pseudonymize-v1",
            operationCorrelationId: "cor_persist_0000000000000000",
            localExtraction: LOCAL_EXTRACTION,
          });
          assert.equal(prepare.status, "ok", JSON.stringify(prepare));
          const transactionId = prepare.data.transactionId;
          assert.ok(transactionId, "prepare returned a transactionId");

          const confirm = await engine.request({
            protocolVersion: 1,
            kind: "confirmLlmExtraction",
            requestId: REQ_ID,
            transactionId,
          });
          assert.equal(confirm.status, "ok", JSON.stringify(confirm));
          assert.equal(
            confirm.data.request.transactionId,
            transactionId,
            "confirm returned the same transaction",
          );
          assert.ok(
            confirm.data.request.exactPayloadBytes,
            "confirm returned exactPayloadBytes",
          );
        } finally {
          await engine.close();
        }
      });
    });
