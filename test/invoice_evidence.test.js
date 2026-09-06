import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractInvoiceEvidence,
  produceInvoiceEvidence,
} from "../src/invoice-evidence.js";
import { validateInvoiceEvidence } from "../src/invoice-learning-contract.js";

const PDF = readFileSync(
  new URL(
    "../fixtures/invoice-learning/synthetic.same-layout.first.pdf",
    import.meta.url,
  ),
);
const DOCUMENT_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const fields = (record) => [
  record.supplier,
  record.invoiceNumber,
  record.invoiceDate,
  record.currency,
  record.taxableBase,
  record.taxes,
  record.total,
  ...record.lineItems.flatMap((row) => [
    row.description,
    row.quantity,
    row.unitPrice,
  ]),
];

test("produces a closed untrusted invoice evidence record for one digital PDF", async () => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
  });
  assert.equal(evidence.documentId, DOCUMENT_ID);
  assert.equal(evidence.extractionMode, "DIGITAL_TEXT");
  assert.equal(evidence.untrusted, true);
  assert.equal(evidence.recordOutcome, "EXTRACTED_UNTRUSTED");
  assert.equal(
    evidence.record.supplier.value.displayName,
    "Demo Office Supplies Ltd.",
  );
  assert.equal(evidence.record.invoiceNumber.value, "SYN-2026-001");
  assert.equal(evidence.record.invoiceDate.value, "2026-01-15");
  assert.equal(evidence.record.currency.value, "EUR");
  assert.equal(evidence.record.taxableBase.value, "37.1");
  assert.equal(evidence.record.taxes.value, "7.79");
  assert.equal(evidence.record.total.value, "44.89");
  assert.deepEqual(
    evidence.record.lineItems.map(({ description, quantity, unitPrice }) => [
      description.value,
      quantity.value,
      unitPrice.value,
    ]),
    [
      ["Notebook A5", "4", "2.5"],
      ["Pen Black", "8", "1.2"],
      ["Stapler Heavy", "2", "8.75"],
    ],
  );
  assert.equal(evidence.table.columns.length, 3);
  assert.ok(
    fields(evidence.record).every((field) => field.state === "PRESENT"),
  );
  assert.ok(
    fields(evidence.record).every((field) => field.evidence.length >= 1),
  );
  assert.equal(validateInvoiceEvidence(evidence), true);
});

test("exports the producer alias without changing the evidence contract", async () => {
  const evidence = await produceInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
  });
  assert.equal(evidence.documentSha256.length, 64);
  assert.deepEqual(
    evidence.record.lineItems.map((row) => row.rowId),
    ["g_0000000000000000", "g_0000000000000001", "g_0000000000000002"],
  );
});

test("returns explicit review state and missing envelopes when required invoice data is absent", async () => {
  const evidence = await extractInvoiceEvidence(
    readFileSync(
      new URL("./fixtures/ocr-placeholder-image.pdf", import.meta.url),
    ),
    { documentId: DOCUMENT_ID },
  );
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.deepEqual(evidence.reviewReasons, [
    "NON_DIGITAL_INPUT",
    "MISSING_REQUIRED_VALUE",
    "INVALID_FORMAT",
    "MISSING_EVIDENCE",
  ]);
  assert.equal(evidence.record.invoiceNumber.state, "MISSING");
  assert.equal(evidence.record.invoiceNumber.reason, "NOT_FOUND");
  assert.equal(evidence.record.lineItems[0].description.state, "MISSING");
  assert.equal(validateInvoiceEvidence(evidence), true);
});

test("rejects an invalid document identity before PDF processing", async () => {
  await assert.rejects(
    () => extractInvoiceEvidence(PDF, { documentId: "not-a-document-id" }),
    /document id/i,
  );
});
