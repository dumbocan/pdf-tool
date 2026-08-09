import assert from "node:assert/strict";
import test from "node:test";
import { extractTextFromPdf } from "../src/extract.js";

// Real-pipeline triangulation for the limit-based truncation contract: the same
// builder as extract.test.js so these tests drive the actual pdfjs extraction,
// not a stub. Unreadable-page skips are best-effort continuation and never set
// `truncated` on their own (verified here via a valid multi-page PDF).
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

const LONG_PAGE = "lorem ipsum dolor sit amet ".repeat(30); // ~660 chars per page

test("real pipeline: small maxChars yields reason maxChars and applied limits", async () => {
  const pdf = await buildPdf([LONG_PAGE, LONG_PAGE]);
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 100 });
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "maxChars");
  assert.deepEqual(result.applied, { maxPages: 5, maxChars: 100 });
});

test("real pipeline: maxPages 1 on a multi-page PDF yields reason maxPages", async () => {
  const pdf = await buildPdf([LONG_PAGE, LONG_PAGE, LONG_PAGE]);
  const result = await extractTextFromPdf(pdf, { maxPages: 1, maxChars: 200000 });
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "maxPages");
  assert.equal(result.pages, 1);
  assert.deepEqual(result.applied, { maxPages: 1, maxChars: 200000 });
});

test("real pipeline: small maxChars and maxPages together yield reason maxPagesAndMaxChars", async () => {
  const pdf = await buildPdf([LONG_PAGE, LONG_PAGE, LONG_PAGE]);
  const result = await extractTextFromPdf(pdf, { maxPages: 1, maxChars: 100 });
  assert.equal(result.truncated, true);
  assert.equal(result.truncationReason, "maxPagesAndMaxChars");
  assert.deepEqual(result.applied, { maxPages: 1, maxChars: 100 });
});

test("real pipeline: an untruncated extraction reports no reason and stays consistent", async () => {
  const pdf = await buildPdf(["Short single page"]);
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 1000 });
  assert.equal(result.truncated, false);
  assert.equal(result.truncationReason, null);
  assert.deepEqual(result.applied, { maxPages: 5, maxChars: 1000 });
});
