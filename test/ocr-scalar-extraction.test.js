import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractInvoiceEvidence, extractInvoiceFieldsPositional } from "../src/invoice-evidence.js";

const tokenStream = (rows) => ({
  pageWidth: 1000,
  pageHeight: 1000,
  tokens: rows.flatMap((words, row) => words.map((text, column) => ({
    text,
    page: 1,
    bbox: { x: 40 + column * 120, y: 900 - row * 80, width: 100, height: 30 },
    confidenceBps: 9500,
  }))),
});

// Real-invoice OCR fixture (Phase 3B.3). Sanitized: emails, NIFs/CIFs, URLs,
// phone numbers, real invoice refs and supplier/customer names are replaced
// with placeholders (<email>, <nif>, <url>, <tel>, <ref>, <name>) so the
// fixture is safe to commit. Dates and amounts are kept visible because
// they are structural inputs the positional extractor regex needs and an
// amount/date in isolation is not PII. See the sanitization rules in
// /home/jmon/nelupdf/docs/decisions.md (to be added) or in the commit
// message for this fixture.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_FIXTURE = JSON.parse(readFileSync(join(__dirname, "fixtures", "ocr-scalar-vectors.json"), "utf8"));

const REAL_INVOICE_IDS = Object.keys(REAL_FIXTURE).filter((id) => !REAL_FIXTURE[id]?.skipped);

test("clusters OCR words into y-aligned rows and orders each row by x", () => {
  const fields = extractInvoiceFieldsPositional({
    pageWidth: 1000,
    pageHeight: 1000,
    tokens: [
      { text: "TOTAL", page: 1, bbox: { x: 300, y: 900, width: 80, height: 30 } },
      { text: "12,00", page: 1, bbox: { x: 400, y: 901, width: 80, height: 30 } },
      { text: "Invoice", page: 1, bbox: { x: 100, y: 800, width: 80, height: 30 } },
      { text: "number", page: 1, bbox: { x: 190, y: 799, width: 90, height: 30 } },
      { text: "80018183-0025", page: 1, bbox: { x: 300, y: 800, width: 150, height: 30 } },
    ],
  });
  assert.equal(fields.lines[0].text, "TOTAL 12,00");
  assert.equal(fields.lines[1].text, "Invoice number 80018183-0025");
});

test("extracts Spanish positional scalar labels", () => {
  const fields = extractInvoiceFieldsPositional(tokenStream([
    ["FACTURA", "N*", "L2026S5151/7136"],
    ["Fecha", "Factura", "15/01/2026"],
    ["Base", "Imponible", "11,21"],
    ["IVA", "0,79"],
    ["TOTAL", "12,00"],
  ]));
  assert.equal(fields.invoiceNumber, "L2026S5151/7136");
  assert.equal(fields.invoiceDate, "2026-01-15");
  assert.equal(fields.totals.subtotal, "11.21");
  assert.equal(fields.totals.tax, "0.79");
  assert.equal(fields.totals.total, "12.00");
});

test("OCR evidence record uses positional scalar fields and remains review-required", async () => {
  const evidence = await extractInvoiceEvidence(Buffer.from("pdf"), {
    documentId: "abcdefghijklmnopqrstuv",
    digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
    ocrExtractor: async () => ({
      pageWidth: 1000,
      pageHeight: 1000,
      tokens: tokenStream([["Invoice", "number", "80018183-0025"], ["Subtotal", "$20.00"], ["Tax", "$4.00"], ["Total", "€24,00"]]).tokens,
    }),
  });
  assert.equal(evidence.record.invoiceNumber.state, "PRESENT");
  assert.equal(evidence.record.invoiceNumber.value, "80018183-0025");
  assert.equal(evidence.record.taxableBase.value, "20");
  assert.equal(evidence.record.total.value, "24");
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.ok(evidence.reviewReasons.includes("NON_DIGITAL_INPUT"));
  assert.equal(evidence.untrusted, true);
});

test("extracts English labels and ignores tabular separators and currency symbols", () => {
  const fields = extractInvoiceFieldsPositional(tokenStream([
    ["|", "N°", "Factura", "|", "|", "Fecha", "Factura", "|"],
    ["Invoice", "number", "80018183-0025"],
    ["Date", "of", "issue", "02/03/2026"],
    ["Subtotal", "$20.00"],
    ["Tax", "$4.00"],
    ["Total", "€24,00"],
  ]));
  assert.equal(fields.invoiceNumber, "80018183-0025");
  assert.equal(fields.invoiceDate, "2026-03-02");
  assert.equal(fields.totals.subtotal, "20.00");
  assert.equal(fields.totals.tax, "4.00");
  assert.equal(fields.totals.total, "24.00");
});

// ---------------------------------------------------------------------------
// Phase 3B.3 — Real-invoice regression corpus (sanitized)
// ---------------------------------------------------------------------------
// These cases triangulate the positional scalar extractor against a small
// corpus of real-world invoices (Empark, LCX, OpenAI, Lencar/lenbox) that
// were OCR'd locally and then sanitized. The fixture carries expected
// presence/absence for each field per invoice (not exact values — values
// are redacted, only labels and structural layout matter for regression).

for (const id of REAL_INVOICE_IDS) {
  const v = REAL_FIXTURE[id];
  test(`3B.3 real invoice (${id}): extractInvoiceFieldsPositional surfaces expected labels`, () => {
    const fields = extractInvoiceFieldsPositional({
      pageWidth: v.pageWidth,
      pageHeight: v.pageHeight,
      tokens: v.tokens,
    });
    const labels = {
      invoiceNumber: fields.invoiceNumber,
      invoiceDate: fields.invoiceDate,
      taxLabel: fields.taxLabel,
      subtotal: fields.totals?.subtotal ?? null,
      tax: fields.totals?.tax ?? null,
      total: fields.totals?.total ?? null,
    };
    for (const f of v.expectedPositional.present) {
      assert.notEqual(labels[f], null, `${id}: expected ${f} PRESENT but got null`);
      assert.notEqual(labels[f], "", `${id}: expected ${f} PRESENT but got empty string`);
    }
    for (const f of v.expectedPositional.absent) {
      const got = labels[f];
      const isAbsent = got === null || got === "";
      assert.ok(isAbsent, `${id}: expected ${f} ABSENT but got ${JSON.stringify(got)}`);
    }
  });

  test(`3B.3 real invoice (${id}): extractInvoiceEvidence keeps OCR record review-required with NON_DIGITAL_INPUT`, async () => {
    const documentId = `3b3${id}xxxxxxxxxxxxxxxx`.slice(0, 22);
    const evidence = await extractInvoiceEvidence(Buffer.from("pdf"), {
      documentId,
      digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
      ocrExtractor: async () => ({
        pageWidth: v.pageWidth,
        pageHeight: v.pageHeight,
        tokens: v.tokens,
      }),
    });
    const shape = v.expectedRecordShape;
    assert.equal(evidence.extractionMode, shape.extractionMode, `${id}: extractionMode`);
    assert.equal(evidence.recordOutcome, shape.recordOutcome, `${id}: recordOutcome`);
    assert.equal(evidence.untrusted, shape.untrusted, `${id}: untrusted`);
    for (const reason of shape.reviewReasonsIncludes) {
      assert.ok(evidence.reviewReasons.includes(reason), `${id}: reviewReasons must include ${reason}`);
    }
    const recordLabels = {
      invoiceNumber: evidence.record.invoiceNumber,
      invoiceDate: evidence.record.invoiceDate,
      taxableBase: evidence.record.taxableBase,
      taxes: evidence.record.taxes,
      total: evidence.record.total,
    };
    for (const f of v.expectedRecord.present) {
      assert.equal(recordLabels[f]?.state, "PRESENT", `${id}: record.${f} should be PRESENT`);
    }
    for (const f of v.expectedRecord.absent) {
      const got = recordLabels[f]?.state;
      assert.ok(got === "MISSING" || got === undefined, `${id}: record.${f} should be MISSING but got ${got}`);
    }
  });
}
