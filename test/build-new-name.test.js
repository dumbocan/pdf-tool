import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNewName, deterministicKeyword, sanitizeFilenamePart } from "../src/folder-scan.js";

test("buildNewName applies the pattern with sanitized values", () => {
  const row = {
    file: "scan_20260730_145823.pdf",
    vendor: "mercadona",
    invoiceNumber: "A-G2026/000001",
    invoiceDate: "2026-08-01",
    keyword: "compra-semanal",
    lineItems: "LECHE :: 2 :: 1.10 :: 2.20",
  };
  assert.equal(buildNewName(row, "{fecha}_{proveedor}_{palabra}"), "2026-08-01_mercadona_compra-semanal.pdf");
  assert.equal(buildNewName(row, "{proveedor}"), "mercadona.pdf");
  assert.equal(buildNewName(row, "{fecha}"), "2026-08-01.pdf");
  assert.equal(buildNewName(row, "{numero}"), "A-G2026-000001.pdf");
});

test("buildNewName falls back when fields are missing", () => {
  const row = { file: "x.pdf", vendor: "", invoiceNumber: "", invoiceDate: "", keyword: "", lineItems: "" };
  assert.equal(buildNewName(row, "{fecha}_{proveedor}"), "sin-fecha_desconocido.pdf");
});

test("deterministicKeyword strips numbers, dates and stopwords", () => {
  const row = { lineItems: "LECHE DESN P6 :: 1 :: 1.10 :: 1.10 ; PAN DE MOLDE :: 2 :: 0.90 :: 1.80" };
  assert.equal(deterministicKeyword(row), "leche-desn");
});

test("sanitizeFilenamePart removes unsafe characters", () => {
  assert.equal(sanitizeFilenamePart("a/b:c*d", "x"), "a-b-c-d");
  assert.equal(sanitizeFilenamePart("  hola  ", "x"), "hola");
  assert.equal(sanitizeFilenamePart("", "fallback"), "fallback");
});
