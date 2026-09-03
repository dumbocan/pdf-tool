import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeInvoiceEvidenceLines,
  extractInvoiceEvidence,
  materializeOcrEvidence,
} from "../src/invoice-evidence.js";

const PDF = Buffer.from("%PDF-1.4 synthetic OCR parser input");
const DOCUMENT_ID = "AAAAAAAAAAAAAAAAAAAAAA";

function token(text, x, top, options = {}) {
  const width = options.width ?? Math.max(40, text.length * 30);
  const height = options.height ?? 20;
  const pageHeight = options.pageHeight ?? 1000;
  return {
    text,
    page: options.page ?? 1,
    confidenceBps: options.confidenceBps ?? 9000,
    bbox: { x, y: pageHeight - top - height, width, height },
    pageWidth: options.pageWidth ?? 1000,
    pageHeight,
  };
}

function parserTokens() {
  const rows = [
    ["Acme", 100, 100], ["Supplies", 260, 100],
    ["Invoice", 100, 150], ["Number:", 230, 150], ["INV-42", 420, 150],
    ["Invoice", 100, 200], ["Date:", 230, 200], ["2026-02-03", 370, 200],
    ["Subtotal:", 100, 250], ["10.00", 300, 250],
    ["Taxable", 100, 275], ["Base:", 250, 275], ["10.00", 400, 275],
    ["Tax:", 100, 350], ["2.10", 300, 350],
    ["Currency:", 100, 425], ["EUR", 300, 425],
    ["Total:", 100, 500], ["12.10", 300, 500],
    ["Description", 100, 600], ["Quantity", 500, 600], ["Unit", 650, 600], ["Price", 720, 600], ["Line", 820, 600], ["Total", 900, 600],
    ["Widget", 100, 700],
    ["Premium", 100, 800], ["2", 500, 800], ["3.50", 650, 800], ["7.00", 850, 800],
    ["Description", 100, 100, { page: 2 }], ["Quantity", 500, 100, { page: 2 }], ["Unit", 650, 100, { page: 2 }], ["Price", 720, 100, { page: 2 }], ["Line", 820, 100, { page: 2 }], ["Total", 900, 100, { page: 2 }],
    ["Paper", 100, 220, { page: 2 }], ["4", 500, 220, { page: 2 }], ["1.25", 650, 220, { page: 2 }], ["5.00", 850, 220, { page: 2 }],
  ];
  return rows.map(([text, x, top, options]) => token(text, x, top, options));
}

test("RED: parses OCR columns, repeated headers, and wrapped descriptions deterministically", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
    ocrExtractor: async () => ({
      text: "",
      tokens: parserTokens(),
      pageWidth: 1000,
      pageHeight: 1000,
    }),
  });

  assert.deepEqual(evidence.record.lineItems.map(({ description, quantity, unitPrice }) => [
    description.value,
    quantity.value,
    unitPrice.value,
  ]), [
    ["Widget Premium", "2", "3.5"],
    ["Paper", "4", "1.25"],
  ]);
  assert.equal(evidence.record.invoiceNumber.value, "INV-42");
  assert.equal(evidence.record.invoiceDate.value, "2026-02-03");
  assert.equal(evidence.record.currency.value, "EUR");
  assert.equal(evidence.record.taxableBase.value, "10");
  assert.equal(evidence.record.taxes.value, "2.1");
  assert.equal(evidence.record.total.value, "12.1");
  assert.equal(evidence.table.columns.map(({ identifier }) => identifier).join(","), "description,quantity,unitPrice");
  assert.equal(evidence.table.headerMarkers.length, 1);
  assert.equal(evidence.table.headerMarkers[0].page, 2);
  assert.equal(evidence.table.repeatedHeaderSignature.continuationPageCount, 1);
  assert.equal(evidence.table.splitRowPolicy, "UNSUPPORTED");
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.ok(evidence.reviewReasons.includes("NON_DIGITAL_INPUT"));
  assert.equal(evidence.untrusted, true);

  const rowEvidence = evidence.record.lineItems[0];
  assert.equal(rowEvidence.description.evidence.length, 2);
  assert.notDeepEqual(rowEvidence.description.evidence[0].rect, rowEvidence.quantity.evidence[0].rect);
  assert.ok(rowEvidence.description.evidence.every(({ page, localRef }) => page === 1 && /^t_[0-9a-f]{16}$/.test(localRef.tokenId)));
});

test("RED: computes OCR confidence as an area-weighted local basis-point average", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
    ocrExtractor: async () => ({
      text: "",
      tokens: [
        token("large", 0, 0, { width: 90, height: 10, confidenceBps: 9000 }),
        token("small", 100, 0, { width: 10, height: 10, confidenceBps: 5000 }),
      ],
      pageWidth: 1000,
      pageHeight: 1000,
    }),
  });

  assert.equal(evidence.confidenceBps, 8600);
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.equal(evidence.untrusted, true);
});

test("RED: rejects OCR rows when column alignment is ambiguous", () => {
  const lines = materializeOcrEvidence([
    token("Widget", 100, 100),
    token("2", 500, 100),
    token("3.00", 650, 100),
    token("6.00", 850, 100),
  ], { pageWidth: 1000, pageHeight: 1000 }).lines;

  const result = analyzeInvoiceEvidenceLines(lines);

  assert.deepEqual(result.rows, []);
  assert.ok(result.reviewReasons.includes("UNSUPPORTED_STRUCTURE"));
  assert.equal(result.recordOutcome, "REVIEW_REQUIRED");
});

test("RED: marks a missing required OCR cell as evidence-missing", async () => {
  const tokens = [
    token("Description", 100, 100),
    token("Quantity", 500, 100),
    token("Unit", 650, 100),
    token("Price", 720, 100),
    token("Line", 820, 100),
    token("Total", 900, 100),
    token("Widget", 100, 200),
    token("2", 500, 200),
    token("6.00", 850, 200),
  ];
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
    ocrExtractor: async () => ({
      text: "Description Quantity Unit Price Line Total Widget 2 6.00",
      tokens,
      pageWidth: 1000,
      pageHeight: 1000,
    }),
  });

  const row = evidence.record.lineItems[0];
  assert.equal(row.description.value, "Widget");
  assert.equal(row.quantity.value, "2");
  assert.equal(row.unitPrice.state, "MISSING");
  assert.equal(row.unitPrice.reason, "EVIDENCE_MISSING");
  assert.ok(evidence.reviewReasons.includes("MISSING_EVIDENCE"));
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
});

test("TRIANGULATE: rejects overlapping OCR numeric columns", () => {
  const lines = materializeOcrEvidence([
    token("Description", 100, 100),
    token("Quantity", 500, 100),
    token("Unit", 650, 100),
    token("Price", 720, 100),
    token("Line", 820, 100),
    token("Total", 900, 100),
    token("Widget", 100, 200),
    token("2", 600, 200),
    token("3.00", 600, 200),
    token("6.00", 850, 200),
  ], { pageWidth: 1000, pageHeight: 1000 }).lines;

  const result = analyzeInvoiceEvidenceLines(lines);

  assert.deepEqual(result.rows, []);
  assert.ok(result.reviewReasons.includes("UNSUPPORTED_STRUCTURE"));
  assert.equal(result.recordOutcome, "REVIEW_REQUIRED");
});

test("RED: rejects a repeated-header/data collision instead of treating it as a header", () => {
  const lines = materializeOcrEvidence([
    token("Description", 100, 100),
    token("Quantity", 500, 100),
    token("Unit", 650, 100),
    token("Price", 720, 100),
    token("Line", 820, 100),
    token("Total", 900, 100),
    token("Description", 100, 200),
    token("Quantity", 500, 200),
    token("Unit", 650, 200),
    token("Price", 720, 200),
    token("Line", 820, 200),
    token("Total", 900, 200),
    token("Widget", 100, 200),
    token("2", 500, 200),
    token("3.00", 650, 200),
    token("6.00", 850, 200),
  ], { pageWidth: 1000, pageHeight: 1000 }).lines;

  const result = analyzeInvoiceEvidenceLines(lines);

  assert.deepEqual(result.rows, []);
  assert.ok(result.reviewReasons.includes("UNSUPPORTED_STRUCTURE"));
  assert.equal(result.recordOutcome, "REVIEW_REQUIRED");
});
