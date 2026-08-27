import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractTextFromPdf, PdfExtractionError } from "./extract.js";

const ISO_SNAPSHOT = JSON.parse(readFileSync(resolve(import.meta.dirname, "../contracts/invoice-learning/v1/iso-4217-snapshot.json"), "utf8"));
const ISO_CODES = new Set(ISO_SNAPSHOT.entries.map(({ code }) => code));
const MISSING = (reason = "NOT_FOUND") => ({ state: "MISSING", reason });
const ID = (prefix, ordinal) => `${prefix}_${ordinal.toString(16).padStart(16, "0")}`;
const PRESENT = (value, fragment) => ({ state: "PRESENT", value, provenance: "EXTRACTED_LOCAL", evidence: [fragment] });

function documentError(message, code = "pdf_invalid") {
  return new PdfExtractionError(message, code);
}

function assertDocumentId(documentId) {
  if (typeof documentId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(documentId)) {
    throw documentError("document id must be a 22-character opaque identifier", "document_id_invalid");
  }
}

function rectFromBbox(bbox) {
  const x = Math.min(10000, Math.max(0, Math.round(Number(bbox?.x ?? 0) * 100)));
  const y = Math.min(10000, Math.max(0, Math.round(Number(bbox?.y ?? 0) * 100)));
  const right = Math.min(10000, Math.max(x + 1, Math.round((Number(bbox?.x ?? 0) + Number(bbox?.width ?? 100)) * 100)));
  const bottom = Math.min(10000, Math.max(y + 1, Math.round((Number(bbox?.y ?? 0) + Number(bbox?.height ?? 4)) * 100)));
  return { x, y, width: right - x, height: bottom - y };
}

function fragmentFor(source, ordinal) {
  const page = Number.isInteger(source?.bbox?.page) ? source.bbox.page : Number(source?.pageNumber) || 1;
  const tokenId = ID("t", ordinal);
  return {
    evidenceId: ID("ev", ordinal),
    page: Math.min(100, Math.max(1, page)),
    rect: rectFromBbox(source?.bbox),
    localRef: { kind: "TOKEN", tokenId },
  };
}

function canonicalNumber(raw, maxFraction) {
  if (typeof raw !== "string") return null;
  const input = raw.trim();
  const value = input.includes(",") && input.includes(".")
    ? input.replace(/\./g, "").replace(",", ".")
    : input.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > maxFraction) return null;
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const normalized = normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
  return normalized === "" ? "0" : normalized;
}

function lineSource(lines, expression) {
  return lines.find((line) => expression.test(line.text)) ?? null;
}

function valueFromLine(lines, expression, normalizer) {
  const source = lineSource(lines, expression);
  if (!source) return { value: null, source: null };
  const match = source.text.match(expression);
  return { value: normalizer(match?.[1] ?? ""), source };
}

function makeRow(description, quantity, unitPrice, source, ordinal) {
  const rowId = ID("g", ordinal);
  const descFragment = fragmentFor(source, ordinal * 3 + 8);
  const quantityFragment = fragmentFor(source, ordinal * 3 + 9);
  const priceFragment = fragmentFor(source, ordinal * 3 + 10);
  return {
    rowId,
    page: descFragment.page,
    ordinal,
    description: PRESENT(description, descFragment),
    quantity: PRESENT(quantity, quantityFragment),
    unitPrice: PRESENT(unitPrice, priceFragment),
  };
}

function parseRows(lines) {
  const rows = [];
  const seen = new Set();
  const rowPattern = /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+((?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{1,6})\s+(?:\d{1,3}(?:\.\d{3})+|\d+)[.,]\d{1,6}$/;
  for (const source of lines) {
    const match = source.text.trim().match(rowPattern);
    if (!match || /^(description|quantity|unit price|line total|taxable base|taxes|total)\b/i.test(match[1])) continue;
    const description = match[1].trim();
    const quantity = canonicalNumber(match[2], 6);
    const unitPrice = canonicalNumber(match[3], 4);
    if (!description || !quantity || !unitPrice) continue;
    const key = `${description}\u0000${quantity}\u0000${unitPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(makeRow(description, quantity, unitPrice, source, rows.length));
    if (rows.length === 500) break;
  }
  return rows;
}

function emptyRow() {
  return { rowId: ID("g", 0), page: 1, ordinal: 0, description: MISSING(), quantity: MISSING(), unitPrice: MISSING() };
}

function missingReasons(record, hasText) {
  const reasons = [];
  for (const [name, value] of Object.entries(record)) {
    if (name === "lineItems") continue;
    if (value.state === "MISSING") reasons.push(value.reason === "EVIDENCE_MISSING" ? "MISSING_EVIDENCE" : "MISSING_REQUIRED_VALUE");
  }
  if (record.lineItems.length === 1 && record.lineItems[0].description.state === "MISSING") reasons.push("MISSING_REQUIRED_VALUE");
  if (!hasText) reasons.push("NON_DIGITAL_INPUT");
  return [...new Set(reasons)];
}

function fieldEnvelope(value, source, ordinal, fallbackReason = "NOT_FOUND") {
  return value == null ? MISSING(fallbackReason) : PRESENT(value, fragmentFor(source, ordinal));
}

export async function extractInvoiceEvidence(buffer, { documentId } = {}) {
  assertDocumentId(documentId);
  const documentSha256 = createHash("sha256").update(buffer).digest("hex");
  const extracted = await extractTextFromPdf(buffer, { maxPages: 100, maxChars: 80_000 });
  const lines = Array.isArray(extracted.pageLines) ? extracted.pageLines : [];
  const text = extracted.text ?? "";
  const supplierSource = lines.find((line) => line.text.trim() && !/^(invoice|description|quantity|unit price|line total|invoice number|invoice date|currency|taxable base|taxes|total)\b/i.test(line.text.trim())) ?? null;
  const supplierName = supplierSource?.text.trim() || null;
  const supplierId = supplierName ? "sc_0000000000000000" : null;
  const supplierFragment = supplierSource ? fragmentFor(supplierSource, 0) : null;
  const supplierCandidate = supplierName ? { supplierCandidateId: supplierId, displayName: supplierName, evidence: [supplierFragment] } : null;
  const record = {
    supplier: supplierName ? PRESENT({ supplierCandidateId: supplierId, displayName: supplierName }, supplierFragment) : MISSING(),
    invoiceNumber: fieldEnvelope(valueFromLine(lines, /invoice\s+number\s*:\s*([^\s]+)/i, (v) => v.trim()).value ?? extracted.invoiceFields?.invoiceNumber, lineSource(lines, /invoice\s+number/i), 1),
    invoiceDate: fieldEnvelope(valueFromLine(lines, /invoice\s+date\s*:\s*(\d{4}-\d{2}-\d{2})/i, (v) => v).value ?? extracted.invoiceFields?.invoiceDate, lineSource(lines, /invoice\s+date/i), 2),
    currency: fieldEnvelope(valueFromLine(lines, /currency\s*:\s*([A-Z]{3})\b/i, (v) => ISO_CODES.has(v) ? v : null).value, lineSource(lines, /currency/i), 3, "UNSUPPORTED"),
    taxableBase: fieldEnvelope(valueFromLine(lines, /taxable\s+base\s*:\s*([\d.,]+)/i, (v) => canonicalNumber(v, 4)).value, lineSource(lines, /taxable\s+base/i), 4),
    taxes: fieldEnvelope(valueFromLine(lines, /taxes\s*:\s*([\d.,]+)/i, (v) => canonicalNumber(v, 4)).value, lineSource(lines, /taxes/i), 5),
    total: fieldEnvelope(valueFromLine(lines, /total\s*:\s*([\d.,]+)/i, (v) => canonicalNumber(v, 4)).value, lineSource(lines, /^total\s*:/i), 6),
    lineItems: parseRows(lines),
  };
  if (record.lineItems.length === 0) record.lineItems = [emptyRow()];
  const reasons = missingReasons(record, text.trim().length > 0);
  const valueCount = 7 + record.lineItems.length * 3;
  const presentCount = Object.values(record).filter((v) => !Array.isArray(v) && v.state === "PRESENT").length + record.lineItems.reduce((count, row) => count + [row.description, row.quantity, row.unitPrice].filter((v) => v.state === "PRESENT").length, 0);
  return {
    invoiceEvidenceSchemaVersion: "1",
    documentId,
    documentSha256,
    extractionMode: "DIGITAL_TEXT",
    pageCount: Math.max(1, Math.min(100, extracted.pages || 1)),
    extractedCharacterCount: Math.min(80_000, text.length),
    iso4217Snapshot: { version: ISO_SNAPSHOT.version, checksumSha256: ISO_SNAPSHOT.checksumSha256 },
    supplierCandidate,
    record,
    table: {
      columns: [0, 1, 2].map((ordinal) => ({ columnId: ID("g", ordinal + 1), identifier: ["description", "quantity", "unitPrice"][ordinal], ordinal })),
      headerMarkers: [],
      repeatedHeaderSignature: { columnOrder: ["description", "quantity", "unitPrice"], repeatedHeaderPolicy: "ABSENT", headerRowCount: 1, continuationPageCount: 0 },
      splitRowPolicy: "UNSUPPORTED",
    },
    confidenceBps: Math.round((presentCount / valueCount) * 10_000),
    recordOutcome: reasons.length ? (text.trim() ? "REVIEW_REQUIRED" : "UNSUPPORTED") : "EXTRACTED_UNTRUSTED",
    reviewReasons: reasons,
    untrusted: true,
  };
}

export const produceInvoiceEvidence = extractInvoiceEvidence;
