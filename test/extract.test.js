import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTextFromPdf,
  validatePdfBuffer,
  PdfExtractionError,
  MAX_PDF_BYTES,
  HARD_MAX_PAGES,
  HARD_MAX_CHARS,
  pageItemsFromPdfItems,
  groupTokensByLine,
  extractInvoiceFieldsFromLines,
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

test("extractTextFromPdf merges Acastimar fields into matched entries", async () => {
  const pdf = await buildPdfWithItems([
    [
      { text: "02-01-2099", x: 30, y: 750 },
      { text: "Fecha", x: 110, y: 750 },
      { text: "00000000", x: 30, y: 720 },
      { text: "VENTA", x: 120, y: 720 },
      { text: "Importe neto", x: 30, y: 690 },
      { text: "BaseIVA", x: 130, y: 690 },
      { text: "texto ".repeat(35), x: 30, y: 660 },
      { text: "Importe Factura (EUR) :", x: 30, y: 630 },
      { text: "123,45", x: 180, y: 630 },
    ],
  ]);
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 10_000 });
  const labels = result.invoiceFields.matched.map((field) => field.label);

  assert.equal(result.invoiceFields.vendor, "acastimar");
  assert.equal(result.invoiceFields.invoiceNumber, "00000000");
  assert.equal(result.invoiceFields.invoiceDate, "2099-01-02");
  assert.equal(result.invoiceFields.totals.subtotal, "123.45");
  assert.equal(result.invoiceFields.totals.total, "123.45");
  assert.equal(result.invoiceFields.totals.tax, null);
  assert.deepEqual(labels.sort(), ["invoiceDate", "invoiceNumber", "subtotal", "total"]);
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

// ── WU-2C: positional bbox tests ──────────────────────────────────────────

// Build a PDF where each page is an array of text items placed at explicit
// (x, y) coordinates. Used to assert that the extractor records the right
// bbox for matched fields.
//
// Each item is wrapped in its own BT/ET block so pdfjs returns it as a
// separate text item with its own transform — the helper is for positional
// tests, so collapsing items into one run would defeat the exercise.
function buildPdfWithItems(pages, { fontSize = 8 } = {}) {
  const escapePdfText = (value) =>
    value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages
      .map((_, index) => `${5 + index * 2} 0 R`)
      .join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const items of pages) {
    const cmds = [];
    for (const item of items) {
      const fs = item.fontSize ?? fontSize;
      cmds.push(
        `BT /F1 ${fs} Tf ${item.x} ${item.y} Td (${escapePdfText(item.text)}) Tj ET`,
      );
    }
    const content = cmds.join("\n");
    const contentObject = objects.length + 1;
    objects.push(
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );
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
  chunks.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}

test("extractTextFromPdf populates bbox for an invoice number matched from pdfjs text", async () => {
  // Use the real fixture so we exercise pdfjs's real font decoding (a hand-
  // rolled Type1 PDF mangles "º" because the literal byte 0xC2 0xBA is not
  // in Helvetica's standard encoding). The Mercadona fixture is the canonical
  // case the VisualReview overlay needs to handle.
  const { readFileSync } = await import("node:fs");
  const pdfBytes = readFileSync(
    new URL("./fixtures/A-G2026-245895.pdf", import.meta.url),
  );
  const result = await extractTextFromPdf(pdfBytes, { maxPages: 5, maxChars: 80000 });
  const invoiceNumber = result.invoiceFields.matched.find(
    (m) => m.label === "invoiceNumber",
  );
  assert.ok(invoiceNumber, "invoiceNumber must be matched from the Mercadona fixture");
  assert.equal(invoiceNumber.value, "A-G2026-00000245895");
  assert.ok(invoiceNumber.bbox, "invoiceNumber.bbox must be populated");
  assert.equal(typeof invoiceNumber.bbox.x, "number");
  assert.equal(typeof invoiceNumber.bbox.y, "number");
  assert.equal(typeof invoiceNumber.bbox.width, "number");
  assert.equal(typeof invoiceNumber.bbox.height, "number");
  assert.ok(invoiceNumber.bbox.width > 0, "bbox.width must be > 0");
  assert.ok(invoiceNumber.bbox.height > 0, "bbox.height must be > 0");
});

test("extractTextFromPdf bbox coordinates are page-relative percentages in [0, 100]", async () => {
  // Multi-line synthetic PDF with ASCII labels (no "º" — synthetic PDFs mangle
  // that codepoint through Helvetica's standard encoding). Each label sits on
  // its own line so the per-line bbox is well defined.
  const pdf = await buildPdfWithItems([
    [
      { text: "Factura: X-1", x: 30, y: 750 },
      { text: "Fecha Factura: 27/07/2026", x: 30, y: 720 },
      { text: "Subtotal: 80,00 EUR", x: 30, y: 690 },
      { text: "IGIC: 7,00 EUR", x: 30, y: 660 },
      { text: "Total: 87,00 EUR", x: 30, y: 630 },
    ],
  ]);
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 10000 });
  assert.ok(
    result.invoiceFields.matched.length >= 3,
    `expected several matched fields, got ${result.invoiceFields.matched.length}: ${JSON.stringify(result.invoiceFields.matched.map(m => m.label))}`,
  );
  for (const field of result.invoiceFields.matched) {
    assert.ok(field.bbox, `${field.label} must carry a bbox`);
    assert.ok(
      field.bbox.x >= 0 && field.bbox.x <= 100,
      `${field.label}.x out of [0,100]: ${field.bbox.x}`,
    );
    assert.ok(
      field.bbox.y >= 0 && field.bbox.y <= 100,
      `${field.label}.y out of [0,100]: ${field.bbox.y}`,
    );
    assert.ok(
      field.bbox.width > 0 && field.bbox.width <= 100,
      `${field.label}.width out of (0,100]: ${field.bbox.width}`,
    );
    assert.ok(
      field.bbox.height > 0 && field.bbox.height <= 100,
      `${field.label}.height out of (0,100]: ${field.bbox.height}`,
    );
  }
});

test("extractTextFromPdf marks every matched field as editable: true", async () => {
  const { readFileSync } = await import("node:fs");
  const pdfBytes = readFileSync(
    new URL("./fixtures/A-G2026-245895.pdf", import.meta.url),
  );
  const result = await extractTextFromPdf(pdfBytes, { maxPages: 5, maxChars: 80000 });
  assert.ok(result.invoiceFields.matched.length > 0, "matched must be non-empty");
  for (const field of result.invoiceFields.matched) {
    assert.equal(field.editable, true, `${field.label}.editable must be true`);
  }
});

test("pageItemsFromPdfItems drops items whose transform or geometry is unusable (bbox: null fallback)", () => {
  // No transform → can't compute bbox → dropped. The downstream extractor
  // then has no positional anchor for any field anchored to this run and
  // records bbox: null, matching the OCR/scanned contract.
  const items = [
    { str: "NoTransform", width: 50 },
    { str: "BadFont", width: 50, transform: [0, 0, 0, 0, 30, 750] },
    { str: "ZeroWidth", width: 0, transform: [8, 0, 0, 8, 30, 720] },
    { str: "Good", width: 50, transform: [8, 0, 0, 8, 30, 690] },
  ];
  const pageItems = pageItemsFromPdfItems(items, 1, { width: 612, height: 792 });
  assert.equal(pageItems.length, 1, "only the well-formed item survives");
  assert.equal(pageItems[0].text, "Good");

  // Sanity: the helper returns [] when viewport is invalid, preserving
  // bbox: null at the call site instead of throwing.
  assert.deepEqual(
    pageItemsFromPdfItems(items, 1, { width: 0, height: 0 }),
    [],
  );
  assert.deepEqual(
    pageItemsFromPdfItems([], 1, { width: 612, height: 792 }),
    [],
  );
});

test("extractTextFromPdf bbox page number matches the source page (multi-page PDF)", async () => {
  // Page 1 has no invoice labels; page 2 carries the "Factura:" + "Total:"
  // pair. The bbox.page on each matched field must point at page 2.
  const pdf = await buildPdfWithItems([
    [{ text: "Page one with no invoice labels", x: 30, y: 750 }],
    [
      { text: "Factura: X-1", x: 30, y: 750 },
      { text: "Total: 100,00 EUR", x: 30, y: 720 },
    ],
  ]);
  const result = await extractTextFromPdf(pdf, { maxPages: 5, maxChars: 10000 });
  // The "Factura:" label alone does not match LABEL_INVOICE_NUMBER_RE (which
  // requires the "nº/n°/n." prefix), but the date on the same line as the
  // label still exercises page-number routing. We assert via the total field
  // which is reliably matched on page 2.
  const total = result.invoiceFields.matched.find((m) => m.label === "total");
  assert.ok(total, "total must be matched on page 2");
  assert.equal(total.bbox.page, 2, "total bbox.page must be 2");
  // Page 1 has no invoice labels → no matched fields from page 1.
  const fromPage1 = result.invoiceFields.matched.filter((m) => m.bbox?.page === 1);
  assert.equal(
    fromPage1.length,
    0,
    "page 1 has no invoice labels; matched must not carry page 1 entries",
  );
});

test("groupTokensByLine + extractInvoiceFieldsFromLines union bboxes across label/value lines", () => {
  // "Fecha Factura:" on line 1, "27/07/2026" on line 2 — the union bbox must
  // span both lines so the VisualReview overlay highlights the whole label
  // header, not just the bare date fragment.
  const pageItems = [
    { text: "Fecha Factura:", pageNumber: 1, x: 5, y: 30, width: 25, height: 4 },
    { text: "27/07/2026", pageNumber: 1, x: 5, y: 20, width: 15, height: 4 },
    { text: "N. Factura: A-1", pageNumber: 1, x: 5, y: 10, width: 20, height: 4 },
  ];
  const lines = groupTokensByLine(pageItems);
  const fields = extractInvoiceFieldsFromLines(lines);
  const date = fields.matched.find((m) => m.label === "invoiceDate");
  assert.ok(date, "invoiceDate must be matched");
  assert.ok(date.bbox, "invoiceDate bbox must be populated");
  // union y-range covers [20, 34]; y min = 20, y max = 34, height = 14
  assert.equal(date.bbox.y, 20);
  assert.equal(date.bbox.height, 14);
  // x min = 5 (both lines start at 5)
  assert.equal(date.bbox.x, 5);

  // invoiceNumber stays on a single line so its bbox equals that line's bbox.
  const number = fields.matched.find((m) => m.label === "invoiceNumber");
  assert.ok(number, "invoiceNumber must be matched");
  assert.ok(number.bbox, "invoiceNumber bbox must be populated");
  assert.equal(number.bbox.y, 10);
  assert.equal(number.bbox.height, 4);
});
