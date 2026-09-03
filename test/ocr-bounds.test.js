import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractOcrFromPdfPage } from "../src/extract.js";

const fixture = readFileSync("test/fixtures/ocr-placeholder-image.pdf");

test("OCR remains page-one bounded", async () => {
  const result = await extractOcrFromPdfPage(fixture, 2);

  assert.deepEqual(result, {
    text: "",
    untrusted: true,
    trustBoundary: "ocr_local_only",
    error: "ocr_page_not_supported",
  });
});

test("OCR kills a stuck local converter at the total deadline", async () => {
  const started = Date.now();
  const result = await extractOcrFromPdfPage(fixture, 1, { timeoutMs: 1 });

  assert.equal(result.error, "ocr_timeout");
  assert.ok(Date.now() - started < 1_000);
});

test("OCR caps raster and text output", async () => {
  const result = await extractOcrFromPdfPage(fixture, 1, {
    maxTextChars: 1,
  });

  assert.equal(result.error, "ocr_output_too_large");
  assert.equal(result.text, "");
});

test("OCR caps the rendered raster before invoking Tesseract", async () => {
  const result = await extractOcrFromPdfPage(fixture, 1, {
    maxRasterBytes: 32,
  });

  assert.equal(result.error, "ocr_output_too_large");
  assert.equal(result.text, "");
});

test("OCR rejects invalid input without spawning a process", async () => {
  const result = await extractOcrFromPdfPage(Buffer.alloc(0));

  assert.equal(result.error, "ocr_invalid_input");
});
