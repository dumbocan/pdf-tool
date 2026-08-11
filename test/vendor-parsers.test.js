import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  detectVendor,
  parseVendorInvoice,
  VENDOR_NAMES,
  _internal,
} from "../src/vendor-parsers.js";
import { enrichInvoiceFields } from "../src/extract.js";

// Real invoice texts extracted from the production IMAP mailbox (Hostinger)
// via pdf-tool v0.2. These are untrusted real-world fixtures: if a vendor
// changes its layout these tests break on purpose so the parser is re-audited.
const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/vendor-invoices.json", import.meta.url)), "utf8"),
);

test("detectVendor recognizes each supported vendor by unique markers", () => {
  assert.equal(detectVendor(fixtures.miller), "miller");
  assert.equal(detectVendor(fixtures.empark), "empark");
  assert.equal(detectVendor(fixtures.acastimar), "acastimar");
  assert.equal(detectVendor("una factura cualquiera sin marcadores"), null);
  assert.equal(detectVendor(""), null);
});

test("MILLER (Lencar Canarias) parser extracts number, date, IGIC totals", () => {
  const result = parseVendorInvoice(fixtures.miller);
  assert.equal(result.vendor, "miller");
  assert.equal(result.fields.invoiceNumber, "F2939/26");
  assert.equal(result.fields.invoiceDate, "2026-08-01");
  assert.deepEqual(result.fields.totals, {
    subtotal: "131.59",
    tax: "9.21",
    total: "140.80",
  });
  assert.equal(result.fields.taxLabel, "IGIC");
});

test("EMPARK parser extracts number, ISO date, IGIC totals", () => {
  const result = parseVendorInvoice(fixtures.empark);
  assert.equal(result.vendor, "empark");
  assert.equal(result.fields.invoiceNumber, "L2026S5151/10105");
  assert.equal(result.fields.invoiceDate, "2026-08-01");
  assert.deepEqual(result.fields.totals, {
    subtotal: "11.21",
    tax: "0.79",
    total: "12.00",
  });
  assert.equal(result.fields.taxLabel, "IGIC");
});

test("ACASTIMAR parser extracts number and date; totals from neto/BaseIVA (no tax line)", () => {
  const result = parseVendorInvoice(fixtures.acastimar);
  assert.equal(result.vendor, "acastimar");
  assert.equal(result.fields.invoiceNumber, "26-722");
  assert.equal(result.fields.invoiceDate, "2026-06-04");
  assert.deepEqual(result.fields.totals, {
    subtotal: "1298.05",
    tax: null,
    total: "1298.05",
  });
  // Acastimar invoices do not print IGIC/IVA on this layout.
  assert.equal(result.fields.taxLabel, null);
});

test("parseVendorInvoice returns null for unknown or empty text", () => {
  assert.equal(parseVendorInvoice("factura genérica sin proveedor"), null);
  assert.equal(parseVendorInvoice(""), null);
  assert.equal(parseVendorInvoice(null), null);
});

test("enrichInvoiceFields fills the generic gaps with vendor-specific fields", () => {
  // MILLER's generic extraction (no "Nº Factura", column totals) leaves the
  // number and totals null; the vendor parser fills them.
  const fields = enrichInvoiceFields(fixtures.miller);
  assert.equal(fields.invoiceNumber, "F2939/26");
  assert.equal(fields.invoiceDate, "2026-08-01");
  assert.equal(fields.totals.subtotal, "131.59");
  assert.equal(fields.totals.tax, "9.21");
  assert.equal(fields.totals.total, "140.80");
  assert.equal(fields.vendor, "miller");
  for (const key of ["invoiceNumber", "invoiceDate", "subtotal", "tax", "total", "taxLabel"]) {
    assert.ok(fields.matched.includes(key), `matched should include ${key}`);
  }
});

test("enrichInvoiceFields leaves generic fields untouched for unknown vendors", () => {
  const fields = enrichInvoiceFields("factura genérica");
  assert.equal(fields.vendor, undefined);
  assert.equal(fields.invoiceNumber, null);
  assert.equal(Array.isArray(fields.matched), true);
});

test("amount normalization handles es-ES thousands and decimals", () => {
  const { parseAmount } = _internal;
  assert.equal(parseAmount("1.298,05"), "1298.05");
  assert.equal(parseAmount("131,59"), "131.59");
  assert.equal(parseAmount("12.00"), "12.00");
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(""), null);
});

test("date normalization maps es-ES and ISO formats to ISO", () => {
  const { toIsoDate } = _internal;
  assert.equal(toIsoDate("01/08/2026"), "2026-08-01");
  assert.equal(toIsoDate("2026-08-01"), "2026-08-01");
  assert.equal(toIsoDate("04-06-2026"), "2026-06-04");
  assert.equal(toIsoDate(null), null);
});

test("vendor inventory stays in sync with the marker table", () => {
  assert.deepEqual(VENDOR_NAMES, ["mercadona", "miller", "empark", "acastimar"]);
});
