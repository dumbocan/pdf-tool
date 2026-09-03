// Phase 2 of llm-assisted-parser-anonymized (Task 2.2 integration).
// Spawns the real engine-stdio binary and verifies the `proposeParserV1`
// branch: fail-closed provider gate and typed envelope on validation failure.
//
// NOTE: this file lives separately from `propose-parser.test.js` because the
// unit tests in that file exercise handleProposeParserCore with an enabled
// provider + mock adapters, which must not share a runner with the binary
// spawn assertions (spawn isolation is cleaner and avoids inter-test cwd
// sensitivity).

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = join(__dirname, "..");

const REQ_ID = "123e4567-e89b-42d3-a456-426614174000";
const DOC_ID = "aB3_xY9kQr2TvW5nZ7pL1d";

function frameMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32BE(payload.length, 0);
  payload.copy(buf, 4);
  return buf;
}

function parseFrame(buf) {
  const len = buf.readUInt32BE(0);
  return { json: JSON.parse(buf.slice(4, 4 + len).toString("utf8")) };
}

function runAdapter(inputBuf) {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["src/engine-stdio.js"], {
      cwd: ENGINE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (d) => stdout.push(d));
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code });
    });
    proc.stdin.write(inputBuf);
    proc.stdin.end();
  });
}

function makeProposeParserRequest(overrides = {}) {
  return {
    protocolVersion: 1,
    kind: "proposeParserV1",
    requestId: REQ_ID,
    documentId: DOC_ID,
    documentSha256: "ab".repeat(32),
    extractionMode: "OCR",
    providerId: "minimax",
    modelId: "minimax-m3",
    anonymizedTokenStream: {
      pageWidth: 1000,
      pageHeight: 1000,
      tokens: [
        { text: "FACTURA", page: 1, bbox: { x: 10, y: 10, width: 50, height: 10 }, confidenceBps: 9500 },
        { text: "<ref>", page: 1, bbox: { x: 70, y: 10, width: 40, height: 10 }, confidenceBps: 9500 },
        { text: "Fecha", page: 1, bbox: { x: 10, y: 30, width: 40, height: 10 }, confidenceBps: 9500 },
        { text: "01/06/2026", page: 1, bbox: { x: 60, y: 30, width: 60, height: 10 }, confidenceBps: 9500 },
      ],
    },
    currentScalarLabels: {
      invoiceDate: "(?:fecha\\s+factura|date\\s+of\\s+issue)",
      invoiceNumber: "(?:n[º°]?\\s*factura|invoice\\s+number)",
      subtotal: "(?:base\\s+imponible|subtotal)",
      tax: "(?:igic|iva)",
      total: "(?:total)",
    },
    purpose: "parser_suggestion_v1",
    ...overrides,
  };
}

test("proposeParserV1 via engine-stdio → provider_disabled (fail-closed default)", async () => {
  const req = makeProposeParserRequest();
  const { stdout, code } = await runAdapter(frameMessage(req));
  assert.equal(code, 0);
  const { json } = parseFrame(stdout);
  assert.equal(json.kind, "proposeParserV1");
  assert.equal(json.status, "error");
  assert.equal(json.error.code, "provider_disabled");
});

test("proposeParserV1 with malformed request → typed validation error (no egress)", async () => {
  const req = makeProposeParserRequest({ extractionMode: "lowercase_ocr" });
  const { stdout, code } = await runAdapter(frameMessage(req));
  assert.equal(code, 0);
  const { json } = parseFrame(stdout);
  assert.equal(json.status, "error");
});

test("proposeParserV1 with unsanitized NIF token → provider gate rejects before sanitization check", async () => {
  // Provider is disabled (default), so the request fails closed at the gate
  // regardless of content. This is the strongest privacy guarantee.
  const req = makeProposeParserRequest({
    anonymizedTokenStream: {
      pageWidth: 1000,
      pageHeight: 1000,
      tokens: [{ text: "B05448063", page: 1, bbox: { x: 0, y: 0, width: 60, height: 10 }, confidenceBps: 9500 }],
    },
  });
  const { stdout, code } = await runAdapter(frameMessage(req));
  assert.equal(code, 0);
  const { json } = parseFrame(stdout);
  assert.equal(json.status, "error");
  assert.equal(json.error.code, "provider_disabled");
});
