import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeInvoiceEvidenceLines, extractInvoiceEvidence } from "../src/invoice-evidence.js";
import { validateInvoiceEvidence } from "../src/invoice-learning-contract.js";

const PDF = readFileSync(new URL("../fixtures/invoice-learning/synthetic.same-layout.first.pdf", import.meta.url));
const DOCUMENT_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const replace = (from, to) => {
  const text = PDF.toString("latin1");
  assert.equal(from.length, to.length);
  assert.ok(text.includes(from));
  return Buffer.from(text.replace(from, to), "latin1");
};

const values = (record) => record.lineItems.map(({ description, quantity, unitPrice }) => [
  description.value, quantity.value, unitPrice.value,
]);


test("keeps repeated headers structural and preserves multipage source order", async () => {
  const evidence = await extractInvoiceEvidence(PDF, { documentId: DOCUMENT_ID });
  assert.deepEqual(values(evidence.record), [
    ["Notebook A5", "4", "2.5"],
    ["Pen Black", "8", "1.2"],
    ["Stapler Heavy", "2", "8.75"],
  ]);
  assert.equal(evidence.table.repeatedHeaderSignature.repeatedHeaderPolicy, "REQUIRED");
  assert.equal(evidence.table.repeatedHeaderSignature.continuationPageCount, 1);
  assert.equal(evidence.table.headerMarkers.length, 1);
  assert.equal(evidence.table.headerMarkers[0].page, 2);
  assert.equal(evidence.recordOutcome, "EXTRACTED_UNTRUSTED");
  assert.equal(validateInvoiceEvidence(evidence), true);
});

test("rejects invalid dates, currencies, and arithmetic instead of guessing", async () => {
  const invalidDate = await extractInvoiceEvidence(replace("2026-01-15", "2026-02-30"), { documentId: DOCUMENT_ID });
  assert.equal(invalidDate.record.invoiceDate.state, "MISSING");
  assert.equal(invalidDate.record.invoiceDate.reason, "INVALID_FORMAT");
  assert.ok(invalidDate.reviewReasons.includes("INVALID_FORMAT"));

  const invalidCurrency = await extractInvoiceEvidence(replace("EUR", "ZZZ"), { documentId: DOCUMENT_ID });
  assert.equal(invalidCurrency.record.currency.state, "MISSING");
  assert.equal(invalidCurrency.record.currency.reason, "UNSUPPORTED");
  assert.ok(invalidCurrency.reviewReasons.includes("CURRENCY_INVALID"));

  const invalidArithmetic = await extractInvoiceEvidence(replace("37.10", "37.11"), { documentId: DOCUMENT_ID });
  assert.ok(invalidArithmetic.reviewReasons.includes("ARITHMETIC_INVALID"));
  assert.equal(invalidArithmetic.recordOutcome, "REVIEW_REQUIRED");

  for (const date of ["1900-02-28", "9999-12-31"]) {
    const boundary = await extractInvoiceEvidence(replace("2026-01-15", date), { documentId: DOCUMENT_ID });
    assert.equal(boundary.record.invoiceDate.value, date);
  }
  const nonEur = await extractInvoiceEvidence(replace("EUR", "USD"), { documentId: DOCUMENT_ID });
  assert.equal(nonEur.record.currency.value, "USD");
});

test("fails closed for negative values and explicit credit-note text", async () => {
  const negative = await extractInvoiceEvidence(replace("44.89", "-4.89"), { documentId: DOCUMENT_ID });
  assert.notEqual(negative.record.total.state, "PRESENT");
  assert.ok(["UNSUPPORTED", "REVIEW_REQUIRED"].includes(negative.recordOutcome));

  const creditNote = await extractInvoiceEvidence(replace("INVOICE", "CREDIT "), { documentId: DOCUMENT_ID });
  assert.equal(creditNote.recordOutcome, "UNSUPPORTED");
  assert.ok(creditNote.reviewReasons.includes("CREDIT_NOTE"));
});

test("reports unsupported row structures without inferring split or ambiguous columns", () => {
  const result = analyzeInvoiceEvidenceLines([
    { text: "Description Quantity Unit Price Line Total", bbox: { page: 1, x: 1, y: 1, width: 10, height: 1 } },
    { text: "Widget", bbox: { page: 1, x: 1, y: 2, width: 10, height: 1 } },
    { text: "2 3.00 6.00", bbox: { page: 1, x: 1, y: 3, width: 10, height: 1 } },
    { text: "Description Quantity Unit Price Line Total", bbox: { page: 2, x: 1, y: 1, width: 10, height: 1 } },
    { text: "Description Quantity Price", bbox: { page: 2, x: 1, y: 2, width: 10, height: 1 } },
  ]);
  assert.ok(result.reviewReasons.includes("UNSUPPORTED_STRUCTURE"));
  assert.ok(["UNSUPPORTED", "REVIEW_REQUIRED"].includes(result.recordOutcome));
  const negativeQuantity = analyzeInvoiceEvidenceLines([
    { text: "Widget -2 3.00 6.00", bbox: { page: 1, x: 1, y: 1, width: 10, height: 1 } },
  ]);
  assert.equal(negativeQuantity.recordOutcome, "UNSUPPORTED");
  assert.ok(negativeQuantity.reviewReasons.includes("CREDIT_NOTE"));
});
