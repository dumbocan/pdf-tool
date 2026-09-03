import assert from "node:assert/strict";
import test from "node:test";

import {
  extractInvoiceEvidence,
  materializeOcrEvidence,
  normalizeOcrRect,
} from "../src/invoice-evidence.js";
import { validateInvoiceEvidence } from "../src/invoice-learning-contract.js";
import { validateLearnedResponse } from "../src/engine-protocol.js";
import { diagnosticLine } from "../src/diagnostics.js";

const PDF = Buffer.from("%PDF-1.4 synthetic OCR input");
const DOCUMENT_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const TOKENS = [
  { text: "Demo", page: 1, bbox: { x: 100, y: 700, width: 100, height: 50 } },
  { text: "Invoice", page: 1, bbox: { x: 220, y: 700, width: 140, height: 50 } },
  { text: "Total:", page: 1, bbox: { x: 100, y: 500, width: 120, height: 50 } },
  { text: "44.89", page: 1, bbox: { x: 240, y: 500, width: 100, height: 50 } },
];

function extractionOptions(ocrResult) {
  return {
    digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
    ocrExtractor: async () => ocrResult,
  };
}

test("RED: normalizes bottom-left OCR coordinates deterministically into bounded integer rects", () => {
  assert.deepEqual(normalizeOcrRect({ x: 100, y: 700, width: 100, height: 50 }, 1000, 1000), {
    x: 1000,
    y: 2500,
    width: 1000,
    height: 500,
  });
});

test("TRIANGULATE: clamps OCR boxes at page edges and rejects zero-size geometry", () => {
  const rect = normalizeOcrRect({ x: 990, y: -10, width: 30, height: 30 }, 1000, 1000);
  assert.deepEqual(rect, { x: 9900, y: 9800, width: 100, height: 200 });
  assert.throws(() => normalizeOcrRect({ x: 1, y: 1, width: 0, height: 1 }, 1000, 1000), (error) => error.code === "ocr_geometry_invalid");
});

test("TRIANGULATE: rejects malformed supplied token IDs instead of trusting them", () => {
  assert.throws(() => materializeOcrEvidence([{ tokenId: "tok-unsafe", text: "x", page: 1, bbox: { x: 1, y: 1, width: 1, height: 1 } }], { pageWidth: 10, pageHeight: 10 }), (error) => error.code === "ocr_token_id_invalid");
});

test("RED: maps every OCR word to a deterministic token evidence fragment", () => {
  const first = materializeOcrEvidence(TOKENS, { pageWidth: 1000, pageHeight: 1000 });
  const second = materializeOcrEvidence(TOKENS, { pageWidth: 1000, pageHeight: 1000 });

  assert.deepEqual(first, second);
  assert.equal(first.fragments.length, TOKENS.length);
  assert.ok(first.fragments.every(({ evidenceId, page, rect, localRef }) => {
    return /^ev_[0-9a-f]{16}$/.test(evidenceId)
      && page === 1
      && Object.values(rect).every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000)
      && rect.x + rect.width <= 10000
      && rect.y + rect.height <= 10000
      && localRef.kind === "TOKEN"
      && /^t_[0-9a-f]{16}$/.test(localRef.tokenId);
  }));
});

test("RED: OCR fallback emits OCR evidence and keeps all derived values review-required", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...extractionOptions({ text: "Demo Invoice Total: 44.89", tokens: TOKENS, pageWidth: 1000, pageHeight: 1000 }),
  });

  assert.equal(evidence.extractionMode, "OCR");
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.ok(evidence.reviewReasons.includes("NON_DIGITAL_INPUT"));
  assert.equal(evidence.untrusted, true);
  assert.equal(validateInvoiceEvidence(evidence), true);
});

test("RED: final OCR evidence exposes every OCR word fragment, not only the first per field", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...extractionOptions({ text: "Demo Invoice Total: 44.89", tokens: TOKENS, pageWidth: 1000, pageHeight: 1000 }),
  });

  const finalFragments = [
    ...evidence.record.supplier.evidence,
    ...evidence.record.total.evidence,
  ];
      assert.equal(finalFragments.length, TOKENS.length);
      assert.ok(finalFragments.every(({ evidenceId, rect, localRef }) => {
        return /^ev_[0-9a-f]{16}$/.test(evidenceId)
          && Object.values(rect).every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 10000)
          && rect.x + rect.width <= 10000
          && rect.y + rect.height <= 10000
          && /^t_[0-9a-f]{16}$/.test(localRef.tokenId);
      }));
      assert.deepEqual(
        finalFragments.map(({ localRef }) => localRef.tokenId),
        materializeOcrEvidence(TOKENS, { pageWidth: 1000, pageHeight: 1000 }).fragments.map(({ localRef }) => localRef.tokenId),
      );
});

test("RED: OCR sidecar failure emits OCR_REQUIRED_UNAVAILABLE and no complete record", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...extractionOptions({ text: "", tokens: [], error: "ocr_unavailable" }),
  });

  assert.equal(evidence.extractionMode, "OCR_REQUIRED_UNAVAILABLE");
  assert.equal(evidence.recordOutcome, "UNSUPPORTED");
  assert.deepEqual(evidence.reviewReasons, ["NON_DIGITAL_INPUT"]);
  assert.equal(evidence.record.invoiceNumber.state, "MISSING");
  assert.equal(validateInvoiceEvidence(evidence), true);
});

test("RED: successful empty or malformed OCR stays review-required without fabricated evidence", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...extractionOptions({ text: "", tokens: [{ text: "bad", bbox: null }], pageWidth: 1000, pageHeight: 1000 }),
  });

  assert.equal(evidence.extractionMode, "OCR");
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.ok(evidence.reviewReasons.includes("MISSING_EVIDENCE"));
  assert.ok(Object.values(evidence.record).filter((value) => !Array.isArray(value)).every((value) => value.state === "MISSING"));
  assert.equal(validateInvoiceEvidence(evidence), true);
});

test("RED: OCR evidence refuses to truncate beyond the fragment cap", () => {
  const tokens = Array.from({ length: 16_385 }, (_, index) => ({
    text: "x",
    page: 1,
    bbox: { x: index % 1000, y: 1_000, width: 1, height: 1 },
  }));

  assert.throws(() => materializeOcrEvidence(tokens, { pageWidth: 1000, pageHeight: 1000 }), (error) => error.code === "ocr_resource_limit");
});

test("RED: learned IPC accepts uppercase OCR modes and rejects lowercase modes", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...extractionOptions({ text: "Demo Invoice Total: 44.89", tokens: TOKENS, pageWidth: 1000, pageHeight: 1000 }),
  });
  const response = {
    protocolVersion: 1,
    kind: "extractInvoiceV1",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    status: "ok",
    data: evidence,
  };

  assert.equal(validateLearnedResponse(response), true);
  assert.throws(() => validateLearnedResponse({ ...response, data: { ...evidence, extractionMode: "ocr" } }), /ONE_OF|schema_invalid|protocol_mismatch/);
});

test("RED: local diagnostics retain lowercase extraction modes only", () => {
  assert.doesNotThrow(() => diagnosticLine("ocr_decision", "started", { extractionMode: "ocr" }, "safe-correlation"));
  assert.throws(() => diagnosticLine("ocr_decision", "started", { extractionMode: "OCR" }, "safe-correlation"));
});
