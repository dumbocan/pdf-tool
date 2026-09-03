import test from "node:test";
import assert from "node:assert/strict";
import { extractOcrFromPdfPage } from "../src/extract.js";

test("extractOcrFromPdfPage returns an untrusted local OCR envelope", async () => {
  const result = await extractOcrFromPdfPage(Buffer.from("%PDF-1.7"), 2);

  assert.deepEqual(result, {
    text: "",
    untrusted: true,
    trustBoundary: "ocr_local_only",
    error: "ocr_page_not_supported",
  });
});
