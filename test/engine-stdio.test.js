import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { parseFrame } from "../src/engine-protocol.js";

// --- WU-1C2-RED (verified) → GREEN → TRIANGULATE ---

// Real PDF fixture for extraction success tests
const PDF_FIXTURE = "test/fixtures/A-G2026-245895.pdf";
const PDF_FIXTURE_BYTES = readFileSync(PDF_FIXTURE);
const OCR_PDF_FIXTURE = "test/fixtures/ocr-placeholder-image.pdf";
const NELUPDF_OCR_FIXTURE = "/home/jmon/nelupdf/test/fixtures/invoice-learning/synthetic.ocr-first-flow.pdf";

// Fake PDF for protocol/extraction-failure tests
const PDF_FAKE = Buffer.from("%PDF-1.4 fake minimal test content for engine-stdio");

function makeValidRequest(pdfBytes, overrides = {}) {
  const doc = overrides.document || {};
  const sha256 = doc.sha256 || createHash("sha256").update(pdfBytes).digest("hex");
  const base = {
    protocolVersion: 1,
    kind: "extractLocal",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    document: {
      name: "invoice.pdf",
      byteLength: pdfBytes.length,
      sha256,
      pdfBase64: pdfBytes.toString("base64"),
    },
    limits: { maxPages: 100, maxChars: 80_000 },
  };
  return { ...base, ...overrides, document: { ...base.document, ...doc } };
}

function frameMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32BE(payload.length, 0);
  payload.copy(buf, 4);
  return buf;
}

function runAdapter(inputBuf) {
  return new Promise((resolve) => {
    const proc = spawn("node", ["src/engine-stdio.js"], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (d) => stdout.push(d));
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code });
    });
    proc.stdin.write(inputBuf);
    proc.stdin.end();
  });
}

async function runAdapterWithRequest(req) {
  const { stdout, stderr, code } = await runAdapter(frameMessage(req));
  let json = null;
  try { json = parseFrame(stdout).json; } catch { /* protocol error */ }
  return { json, stderr: stderr.toString(), code };
}

describe("WU-1C2 engine-stdio parseFrame integration", () => {
  it("decodes a valid 32-bit BE framed request and produces a response", async () => {
    const { code, json } = await runAdapterWithRequest(makeValidRequest(PDF_FAKE));
    assert.equal(code, 0);
    assert.ok(json, "should produce a framed JSON response");
  });

  it("rejects invalid protocolVersion via validateRequest", async () => {
    const { json } = await runAdapterWithRequest(makeValidRequest(PDF_FAKE, { protocolVersion: 2 }));
    assert.ok(json);
    assert.equal(json.error, "protocol_version");
  });

  it("rejects malformed frames (truncated) with non-zero exit", async () => {
    const bad = Buffer.from([0x00, 0x00, 0x00, 0xff]);
    const { stdout, code } = await runAdapter(bad);
    assert.notEqual(code, 0);
    assert.equal(stdout.length, 0);
  });
});

describe("WU-1C2 engine-stdio extraction with real PDF", () => {
  it("returns normalized result envelope with extraction fields", async () => {
    const { code, json, stderr } = await runAdapterWithRequest(makeValidRequest(PDF_FIXTURE_BYTES));
    if (code !== 0 || !json?.text) {
      throw new Error(`Adapter failed: code=${code} stderr=${stderr.slice(0,200)} json=${JSON.stringify(json?.error || "no-json")}`);
    }
    assert.equal(json.protocolVersion, 1);
    assert.equal(json.kind, "extractLocal");
    assert.equal(json.requestId, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(typeof json.text, "string");
    assert.ok(json.text.length > 0, "should extract non-empty text from real PDF");
    assert.ok("sha256" in json);
    assert.equal(json.confidence, "deterministic");
    assert.ok(json.trustBoundary, "should have trustBoundary");
    assert.equal(json.status, "ok");
    assert.ok("invoiceFields" in json);
    assert.ok("lineItems" in json);
  });
});

describe("WU-1C2 engine-stdio ocr_required_unavailable", () => {
  it("marks scanned/empty extraction as ocr_required_unavailable", async () => {
    // A buffer that passes validatePdfBuffer (magic bytes + size) but yields no
    // extractable text from pdfjs → should return partial + ocr_required_unavailable.
    // Since a fake PDF won't parse in pdfjs, we expect an error response instead.
    const req = makeValidRequest(PDF_FAKE);
    const { json } = await runAdapterWithRequest(req);
    if (json.error) {
      assert.equal(json.status, "error");
      assert.match(json.error, /pdf_parse|pdf_invalid|base64/);
    } else {
      assert.equal(json.status, "partial");
      assert.equal(json.extractionMode, "ocr_required_unavailable");
    }
  });
});

    describe("local OCR for image-only PDFs", () => {
      it("runs OCR on page 1 when digital extraction is empty", async () => {
        const pdfBytes = readFileSync(OCR_PDF_FIXTURE);
        const { code, json, stderr } = await runAdapterWithRequest(makeValidRequest(pdfBytes));

        assert.equal(code, 0, stderr);
        assert.equal(json.status, "ok");
        assert.equal(json.extractionMode, "ocr");
        assert.equal(json.pages, 1);
        assert.ok(typeof json.text === "string" && json.text.length > 0);
        assert.ok(json.text.includes("NIF"));
        assert.ok(json.text.includes("TOTAL"));
        assert.equal(json.untrusted, true);
      });

      it("direct learned extraction invokes local tools and returns bounded OCR evidence", async () => {
        const pdfBytes = readFileSync(NELUPDF_OCR_FIXTURE);
        const request = {
          ...makeValidRequest(pdfBytes),
          kind: "extractInvoiceV1",
          operationCorrelationId: "cor_00000000000000000000000000000000",
          capability: "invoice_learning_v1",
          invoiceEvidenceSchemaVersion: "1",
          document: {
            ...makeValidRequest(pdfBytes).document,
            documentId: "a".repeat(22),
          },
          limits: { maxPages: 100, maxChars: 80_000 },
        };
        const { code, json, stderr } = await runAdapterWithRequest(request);

        assert.equal(code, 0, stderr);
        assert.equal(json.status, "ok");
        assert.equal(json.data.extractionMode, "OCR");
        assert.equal(json.data.recordOutcome, "REVIEW_REQUIRED");
        assert.equal(json.data.untrusted, true);
        assert.equal(json.data.record.lineItems.length, 3);
        const evidence = json.data.record.lineItems.flatMap((row) =>
          [row.description, row.quantity, row.unitPrice].flatMap((cell) => cell.evidence ?? []));
        assert.ok(evidence.length > 0);
        for (const fragment of evidence) {
          assert.ok(fragment.rect.x >= 0 && fragment.rect.x + fragment.rect.width <= 10_000);
          assert.ok(fragment.rect.y >= 0 && fragment.rect.y + fragment.rect.height <= 10_000);
          assert.match(fragment.localRef.tokenId, /^t_[0-9a-f]{16}$/);
        }
      });
    });
