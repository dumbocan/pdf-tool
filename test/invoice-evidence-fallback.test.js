import assert from "node:assert/strict";
import test from "node:test";

import { extractInvoiceEvidence } from "../src/invoice-evidence.js";

const FIXTURE_ID = "fx_7bdb36cf";
const DOCUMENT_ID = "FFFFFFFFFFFFFFFFFFFFFF";
const PDF = Buffer.from("safe-synthetic-pdf");

function token(text, row, column = 0) {
  return {
    text,
    page: 1,
    pageWidth: 1000,
    pageHeight: 1000,
    bbox: { x: 40 + column * 180, y: 900 - row * 40, width: 140, height: 20 },
    confidenceBps: 9900,
  };
}

function localOcr(ocr) {
  return {
    digitalExtractor: async () => ({ text: "", pages: 1, pageLines: [] }),
    ocrExtractor: async () => ({ pageWidth: 1000, pageHeight: 1000, ...ocr }),
  };
}

function trace(
  t,
  { positionalCount, regexCount, resultCount, mode, outcome, errorCode = null },
) {
  t.diagnostic(
    JSON.stringify({
      fixtureId: FIXTURE_ID,
      positionalCount,
      regexCount,
      resultCount,
      mode,
      outcome,
      errorCode,
    }),
  );
}

test("uses the local regex extractor when valid positional extraction returns no fields", async (t) => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...localOcr({
      text: "Invoice number\nSAFE-001\nSubtotal\n20.00\nTax\n4.00\nTotal\n24.00",
      tokens: [
        token("SAFE-001", 0),
        token("20.00", 1),
        token("4.00", 2),
        token("24.00", 3),
      ],
    }),
  });

  assert.equal(evidence.extractionMode, "OCR");
  assert.equal(evidence.recordOutcome, "REVIEW_REQUIRED");
  assert.equal(evidence.record.invoiceNumber.state, "PRESENT");
  assert.equal(evidence.record.taxableBase.state, "PRESENT");
  assert.equal(evidence.record.taxes.state, "PRESENT");
  assert.equal(evidence.record.total.state, "PRESENT");
  assert.ok(
    [
      evidence.record.invoiceNumber,
      evidence.record.taxableBase,
      evidence.record.taxes,
      evidence.record.total,
    ].every((field) => field.evidence.length > 0),
  );

  trace(t, {
    positionalCount: 0,
    regexCount: 5,
    resultCount: 4,
    mode: evidence.extractionMode,
    outcome: evidence.recordOutcome,
  });
});

test("does not call or merge the regex fallback when positional extraction is non-empty", async (t) => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...localOcr({
      text: "Invoice number: POS-001\nSubtotal\n20.00",
      tokens: [
        token("Invoice", 0),
        token("number", 0, 1),
        token("POS-001", 0, 2),
      ],
    }),
  });

  assert.equal(evidence.record.invoiceNumber.state, "PRESENT");
  assert.equal(evidence.record.taxableBase.state, "MISSING");
  trace(t, {
    positionalCount: 1,
    regexCount: 0,
    resultCount: 1,
    mode: evidence.extractionMode,
    outcome: evidence.recordOutcome,
  });
});

test("rejects an invalid contract before either local extractor can run", async (t) => {
  let extractorCalls = 0;
  await assert.rejects(
    () =>
      extractInvoiceEvidence(PDF, {
        documentId: "invalid",
        digitalExtractor: async () => {
          extractorCalls += 1;
          return { text: "", pages: 1, pageLines: [] };
        },
        ocrExtractor: async () => {
          extractorCalls += 1;
          return { error: "safe_error" };
        },
      }),
    (error) => error?.code === "document_id_invalid",
  );
  assert.equal(extractorCalls, 0);
  trace(t, {
    positionalCount: 0,
    regexCount: 0,
    resultCount: 0,
    mode: "NOT_STARTED",
    outcome: "REJECTED",
    errorCode: "document_id_invalid",
  });
});

test("keeps UNSUPPORTED when positional and regex extraction are both empty", async (t) => {
  const evidence = await extractInvoiceEvidence(PDF, {
    documentId: DOCUMENT_ID,
    ...localOcr({
      text: "",
      tokens: [token("scan", 0), token("without", 1), token("fields", 2)],
    }),
  });

  assert.equal(evidence.extractionMode, "OCR");
  assert.equal(evidence.recordOutcome, "UNSUPPORTED");
  assert.equal(evidence.record.invoiceNumber.state, "MISSING");
  assert.equal(evidence.record.total.state, "MISSING");
  trace(t, {
    positionalCount: 0,
    regexCount: 0,
    resultCount: 0,
    mode: evidence.extractionMode,
    outcome: evidence.recordOutcome,
  });
});
