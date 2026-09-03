import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { DIAGNOSTIC_PREFIX, validateDiagnosticEvent, diagnosticLine } from "../src/diagnostics.js";

const PDF = readFileSync("test/fixtures/A-G2026-245895.pdf");
const request = {
  protocolVersion: 1, kind: "extractLocal", requestId: "550e8400-e29b-41d4-a716-446655440000",
  document: { name: "synthetic.pdf", byteLength: PDF.length, sha256: createHash("sha256").update(PDF).digest("hex"), pdfBase64: PDF.toString("base64") },
  limits: { maxPages: 100, maxChars: 80_000 },
  operationCorrelationId: "file-correlation-a",
};
function frame(value) { const payload = Buffer.from(JSON.stringify(value)); const result = Buffer.alloc(payload.length + 4); result.writeUInt32BE(payload.length); payload.copy(result, 4); return result; }
function run() { return new Promise((resolve) => { const child = spawn("node", ["src/engine-stdio.js"], { stdio: ["pipe", "pipe", "pipe"] }); const stderr = []; child.stderr.on("data", (chunk) => stderr.push(chunk)); child.on("close", (code) => resolve({ code, stderr: Buffer.concat(stderr).toString("utf8") })); child.stdin.end(frame(request)); }); }

describe("diagnostic event contract", () => {
  it("rejects private-looking and unknown string metric values", () => {
    const base = { parserId: "plain-text", extractionMode: "digital_text", status: "complete", errorCode: "timeout", matchedLabels: ["total"] };
    for (const metrics of [
      { ...base, parserId: "Juan Perez" }, { ...base, extractionMode: "/home/private.pdf" },
      { ...base, status: "123.45" }, { ...base, errorCode: "arbitrary-private-error" },
      { ...base, matchedLabels: ["address"] },
    ]) assert.throws(() => diagnosticLine("fields_matched", "success", metrics, "safe-correlation"));
  });
  it("rejects unknown fields and private document values", () => {
    assert.throws(() => validateDiagnosticEvent({
      schemaVersion: 1, timestamp: new Date().toISOString(), component: "node", stage: "fields_matched", outcome: "success", elapsedMs: 1,
      operationCorrelationId: "safe-correlation", metrics: { value: "PII" },
    }));
  });

  it("accepts bounded OCR failure codes", () => {
    for (const errorCode of ["ocr_timeout", "ocr_output_too_large", "ocr_invalid_input"]) {
      assert.doesNotThrow(() => diagnosticLine(
        "ocr_failed",
        "failed",
        { errorCode },
        "safe-correlation",
      ));
    }
  });

  it("emits bounded prefixed events without extracted values or paths", async () => {
    const result = await run();
    assert.equal(result.code, 0);
    const events = result.stderr.split("\n").filter((line) => line.startsWith(DIAGNOSTIC_PREFIX)).map((line) => JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length)));
    assert.ok(events.length >= 4);
    for (const event of events) {
      validateDiagnosticEvent(event);
      assert.ok(!JSON.stringify(event).includes("A-G2026"));
      assert.ok(!JSON.stringify(event).includes("/home/"));
      assert.ok(!JSON.stringify(event).includes("synthetic.pdf"));
    }
    assert.ok(events.some((event) => event.stage === "digital_summary"));
    assert.ok(events.some((event) => event.stage === "fields_matched"));
    assert.deepEqual(new Set(events.map((event) => event.operationCorrelationId)), new Set(["file-correlation-a"]));
  });

  it("creates distinct safe correlation IDs for separate files", async () => {
    const first = await import("../src/diagnostics.js");
    const a = first.createOperationCorrelationId();
    const b = first.createOperationCorrelationId();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
    assert.match(b, /^[A-Za-z0-9_-]{8,64}$/);
  });
});
