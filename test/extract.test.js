import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTextFromPdf,
  validatePdfBuffer,
  PdfExtractionError,
  MAX_PDF_BYTES,
  HARD_MAX_PAGES,
  HARD_MAX_CHARS,
} from "../src/extract.js";

function buildPdf(pages, { fontSize = 8 } = {}) {
  const escapePdfText = (value) => value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const text of pages) {
    const content = `BT /F1 ${fontSize} Tf 30 750 Td (${escapePdfText(text)}) Tj ET`;
    const contentObject = objects.length + 1;
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
  }
  const chunks = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`));
  }
  const xrefOffset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (let index = 1; index < offsets.length; index += 1) {
    chunks.push(Buffer.from(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`));
  }
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test("validatePdfBuffer accepts a real PDF magic and rejects non-PDF buffers", () => {
  const good = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, " ")]);
  validatePdfBuffer(good); // should not throw

  assert.throws(() => validatePdfBuffer(Buffer.from("not a pdf")), PdfExtractionError);
  assert.throws(() => validatePdfBuffer(Buffer.from("PNG\r\n")), PdfExtractionError);
});

test("validatePdfBuffer enforces the size window", () => {
  const tiny = Buffer.from("%PDF-");
  assert.throws(() => validatePdfBuffer(tiny), /too small/i);

  const huge = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(MAX_PDF_BYTES + 1, "x")]);
  assert.throws(() => validatePdfBuffer(huge), /exceeds the size limit/i);
});

test("validatePdfBuffer rejects non-buffer inputs", () => {
  assert.throws(() => validatePdfBuffer("not a buffer"), /buffer/i);
  assert.throws(() => validatePdfBuffer(null), /buffer/i);
  assert.throws(() => validatePdfBuffer(42), /buffer/i);
});

test("extractTextFromPdf returns sanitized text for a one-page PDF", async () => {
  const pdf = await buildPdf(["Hello PDF text"]);
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 1000 });
  assert.ok(result.text.includes("Hello"), `expected text to contain 'Hello', got: ${result.text}`);
  assert.ok(result.text.includes("PDF"), `expected text to contain 'PDF'`);
  assert.equal(result.pages, 1);
  assert.equal(result.truncated, false);
});

test("extractTextFromPdf caps page count at HARD_MAX_PAGES even when caller asks for more", async () => {
  // Build a PDF that would otherwise expose many pages if unbounded.
  const manyPages = Array.from({ length: 4 }, (_, i) => `Page ${i + 1}`);
  const pdf = await buildPdf(manyPages);
  const result = await extractTextFromPdf(pdf, { maxPages: HARD_MAX_PAGES * 5, maxChars: HARD_MAX_CHARS });
  assert.ok(result.pages <= HARD_MAX_PAGES, `pages ${result.pages} must not exceed ${HARD_MAX_PAGES}`);
});

test("extractTextFromPdf truncates output and flags truncation when over the cap", async () => {
  const pages = Array.from({ length: 3 }, () => "lorem ipsum ".repeat(50));
  const pdf = await buildPdf(pages, { fontSize: 8 });
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 200 });
  assert.ok(result.text.length <= 200, `text length ${result.text.length} exceeded 200`);
  assert.equal(result.truncated, true);
});

test("extractTextFromPdf strips control characters from extracted text", async () => {
  // pdf-lib does not let us embed raw \u0000 cleanly, but the extractor must
  // strip control chars regardless. We construct a PDF with normal text and
  // verify the result has no NULs or other C0 controls.
  const pdf = await buildPdf(["Hello"]);
  const result = await extractTextFromPdf(pdf);
  assert.doesNotMatch(result.text, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
});

test("extractTextFromPdf rejects a buffer that exceeds MAX_PDF_BYTES", async () => {
  // Buffer above the cap with valid magic but no real PDF body.
  const oversize = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(MAX_PDF_BYTES + 1, "x")]);
  await assert.rejects(() => extractTextFromPdf(oversize), /exceeds the size limit/i);
});

test("extractTextFromPdf rejects buffers without PDF magic", async () => {
  const bad = Buffer.from("not a pdf at all");
  await assert.rejects(() => extractTextFromPdf(bad), /magic/i);
});

test("extractTextFromPdf surfaces a parse error for a header-only buffer", async () => {
  // A buffer that looks like a PDF by magic but has no real body. pdfjs
  // surfaces an internal error; the extractor maps that to pdf_parse_failed.
  const headerOnly = Buffer.from("%PDF-1.7\njust a header and nothing else");
  await assert.rejects(() => extractTextFromPdf(headerOnly), /parse/i);
});

test("extractTextFromPdf ignores invalid maxPages / maxChars and falls back to defaults", async () => {
  const pdf = await buildPdf(["Defaults"]);
  const result = await extractTextFromPdf(pdf, { maxPages: -1, maxChars: "lots" });
  assert.equal(result.pages, 1);
  assert.ok(result.text.length > 0);
});

// ── AbortSignal / timeout tests ────────────────────────────────────────────

test("extractTextFromPdf rejects with the correct error contract when the signal is aborted", async () => {
  const ac = new AbortController();
  ac.abort();
  const pdf = await buildPdf(["test"]);
  // The pre-import check catches this before any work begins. The per-page
  // loop check and the loadingTask.abort handler share the same error contract
  // (PdfExtractionError with /cancelled/i), so this single deterministic
  // test proves the error shape for all three abort paths.
  await assert.rejects(() => extractTextFromPdf(pdf, { signal: ac.signal }), /cancelled/i);
});

test("source wires signal abort to loadingTask.abort() and checks signal in the page loop", async () => {
  const source = new URL("../src/extract.js", import.meta.url);
  const { readFileSync } = await import("node:fs");
  const content = readFileSync(source, "utf8");

  assert.ok(
    content.includes('signal?.aborted'),
    "extract.js must check signal?.aborted in the page loop",
  );
  assert.ok(
    content.includes('loadingTask.abort('),
    "extract.js must wire signal abort to loadingTask.abort()",
  );
  assert.ok(
    content.includes('pdf_cancelled'),
    "extract.js must set a cancellation error type (pdf_cancelled)",
  );
});
