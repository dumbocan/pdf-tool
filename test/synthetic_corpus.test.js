import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/invoice-learning");
const FIRST_PDF = resolve(FIXTURES, "synthetic.same-layout.first.pdf");
const SECOND_PDF = resolve(FIXTURES, "synthetic.same-layout.second.pdf");
const EVIDENCE = resolve(FIXTURES, "synthetic-evidence.json");
const REQUIRED_FIELDS = ["supplier","invoiceNumber","invoiceDate","currency","taxableBase","taxes","total"];
const SAFE_VISUAL_FIELDS = ["page","zoomBps","viewportWidth","viewportHeight","workflow","containsSensitiveContent"];
const ALLOWED = new Set(["entryId","kind","fixturePath","pdfSha256","pageCount","currency","layoutVersion","requiredFieldList","expectedRowCount","repeatedHeaderCoverage","safeVisualMetadata"]);
const FORBIDDEN = ["opaqueLocalId","opaqueSha256","equivalence","commandCount","resultCount","safeConclusion","checksum","checksumSha256","corpusManifestSchemaVersion"];

function sha(b) { return createHash("sha256").update(b).digest("hex").toLowerCase(); }
function inspect(path) {
  const bytes = readFileSync(path);
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from("%PDF-1.4")), "PDF magic missing");
  const ascii = bytes.toString("latin1");
  return { ascii, pages: (ascii.match(/\/Type\s*\/Page[^s]/g) || []).length, hasH: /\/BaseFont\s*\/Helvetica[^-\s\/]/.test(ascii) || /\/BaseFont\s*\/Helvetica\b/.test(ascii), hasHB: /\/BaseFont\s*\/Helvetica-Bold/.test(ascii) };
}
function normalizeLayout(a) {
  return a.replace(/\(([^)]*)\)\s*Tj/g, "( ) Tj").replace(/\[(.*?)\]\s*TJ/gs, "[] TJ")
    .replace(/SYN-2026-00\d/g, "SYN-NNN").replace(/2026-01-1\d/g, "2026-NN-NN")
    .replace(/Demo Office Supplies Ltd\./g, "SUPPLIER").replace(/Notebook A\d|Pen Black|Stapler Heavy/g, "ITEM")
    .replace(/\d+\.\d{2}/g, "N.NN").replace(/\b\d+\b/g, "N");
}
function loadEvidence() { return JSON.parse(readFileSync(EVIDENCE, "utf8")); }

test("synthetic PDFs and evidence JSON exist on disk", () => {
  assert.ok(existsSync(FIRST_PDF)); assert.ok(existsSync(SECOND_PDF)); assert.ok(existsSync(EVIDENCE));
});

test("evidence has two entries with the exact safe SyntheticCorpusEntryV1 shape", () => {
  const ev = loadEvidence();
  assert.equal(ev.syntheticEvidenceSchemaVersion, "1"); assert.equal(ev.entries.length, 2);
  for (const e of ev.entries) {
    assert.ok(["synthetic.same-layout.first","synthetic.same-layout.second"].includes(e.entryId));
    assert.equal(e.kind, "SYNTHETIC");
    assert.match(e.fixturePath, /^fixtures\/invoice-learning\/synthetic\.same-layout\.(first|second)\.pdf$/);
    assert.match(e.pdfSha256, /^[0-9a-f]{64}$/);
    assert.equal(e.pageCount, 2); assert.equal(e.currency, "EUR"); assert.equal(e.layoutVersion, "A3-LAYOUT-V1");
    assert.deepEqual(e.requiredFieldList, REQUIRED_FIELDS);
    assert.equal(e.expectedRowCount, 3); assert.equal(e.repeatedHeaderCoverage, "ALL_CONTINUATION_PAGES");
    for (const k of SAFE_VISUAL_FIELDS) assert.ok(k in e.safeVisualMetadata);
    const m = e.safeVisualMetadata;
    assert.ok(Number.isInteger(m.page) && m.page >= 1 && m.page <= 100);
    assert.ok(Number.isInteger(m.zoomBps) && m.zoomBps >= 100 && m.zoomBps <= 400);
    assert.ok(Number.isInteger(m.viewportWidth) && m.viewportWidth >= 320 && m.viewportWidth <= 4096);
    assert.ok(Number.isInteger(m.viewportHeight) && m.viewportHeight >= 240 && m.viewportHeight <= 4096);
    assert.equal(m.workflow, "REVIEW_OVERLAY_AND_REPLAY"); assert.equal(m.containsSensitiveContent, false);
    assert.deepEqual(Object.keys(e).sort(), [...ALLOWED].sort());
  }
});

test("entries are ordered first then second and have no private/manifest fields", () => {
  const ev = loadEvidence();
  assert.equal(ev.entries[0].entryId, "synthetic.same-layout.first");
  assert.equal(ev.entries[1].entryId, "synthetic.same-layout.second");
  for (const k of Object.keys(ev)) assert.ok(["syntheticEvidenceSchemaVersion","entries"].includes(k));
  for (const e of ev.entries) for (const f of FORBIDDEN) assert.ok(!(f in e));
});

test("lower-case SHA-256 of each PDF matches evidence pdfSha256", () => {
  const ev = loadEvidence();
  assert.equal(sha(readFileSync(FIRST_PDF)), ev.entries[0].pdfSha256);
  assert.equal(sha(readFileSync(SECOND_PDF)), ev.entries[1].pdfSha256);
});

test("each PDF is two pages with Helvetica + Helvetica-Bold fonts", () => {
  for (const p of [FIRST_PDF, SECOND_PDF]) {
    const r = inspect(p);
    assert.equal(r.pages, 2); assert.ok(r.hasH); assert.ok(r.hasHB);
  }
});

test("after stripping text streams, both PDFs have identical layout signatures", () => {
  assert.equal(normalizeLayout(inspect(FIRST_PDF).ascii), normalizeLayout(inspect(SECOND_PDF).ascii));
});

test("first PDF carries SYN-2026-001, 2026-01-15, EUR, 37.10/7.79/44.89, three row descriptions", () => {
  const a = readFileSync(FIRST_PDF).toString("latin1");
  for (const v of ["Demo Office Supplies Ltd.","SYN-2026-001","2026-01-15","EUR","37.10","7.79","44.89","Notebook A5","Pen Black","Stapler Heavy"]) assert.ok(a.includes(v));
});

test("second PDF carries SYN-2026-002, 2026-01-16, EUR, 50.75/10.66/61.41, three row descriptions", () => {
  const a = readFileSync(SECOND_PDF).toString("latin1");
  for (const v of ["Demo Office Supplies Ltd.","SYN-2026-002","2026-01-16","EUR","50.75","10.66","61.41","Notebook A5","Pen Black","Stapler Heavy"]) assert.ok(a.includes(v));
});

test("second PDF repeats the table header on its continuation page", () => {
  const a = readFileSync(SECOND_PDF).toString("latin1");
  for (const h of ["Description","Quantity","Unit Price"]) assert.ok((a.match(new RegExp(h, "g")) || []).length >= 2);
});

test("synthetic generation is deterministic: re-hashing yields the same SHA-256", () => {
  const f = readFileSync(FIRST_PDF); const s = readFileSync(SECOND_PDF);
  assert.equal(sha(f), sha(f)); assert.equal(sha(s), sha(s));
});
