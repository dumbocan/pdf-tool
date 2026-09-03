// Property-based test: 1000 random synthetic invoices, assert piiRegexMatches === 0
// per audit. We seed a tiny LCG (no external deps) so the run is deterministic.

import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeTokensForLLM,
  auditSanitizedPayload,
} from "../src/llm-sanitize.js";

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const SUPPLIERS = [
  "EMPARK", "WOLTERS KLUWER", "OPENAI OPCO LLC", "LENCAR CANARIAS",
  "NAUTIC EYSER", "ROFER ANESCO", "LEROY MERLIN", "ACASTIMAR",
];
const STREETS = [
  "ATAULFO ARGENTA", "JOAQUIN BLANCO", "CUZCO", "TAMARACEITE",
  "MENCEYES", "SEBADAL", "CASTELLANA",
];
const PRODUCTS = [
  "Abono 24 Horas", "Tornillo M6", "Mantenimiento Software",
  "Suscripcion ChatGPT", "Cable Unifilar", "Brocha Sika",
];
const FIRST_NAMES = ["FRANCISCO", "JAVIER", "YARI", "ANTONIO", "BERNARDINO"];

function randomToken(rand) {
  const r = rand();
  if (r < 0.05) return `info@vendor${Math.floor(rand() * 100)}.com`;
  if (r < 0.1) return `https://www.vendor${Math.floor(rand() * 100)}.es/path`;
  if (r < 0.15) return `+34 ${Math.floor(rand() * 900 + 100)} ${Math.floor(rand() * 900 + 100)} ${Math.floor(rand() * 900 + 100)}`;
  if (r < 0.2) return `ES${Math.floor(rand() * 100)}${Math.floor(rand() * 1e20).toString().padStart(20, "0")}`;
  if (r < 0.3) return `NIF: B${Math.floor(rand() * 1e8).toString().padStart(8, "0")}`;
  if (r < 0.4) return SUPPLIERS[Math.floor(rand() * SUPPLIERS.length)];
  if (r < 0.5) return STREETS[Math.floor(rand() * STREETS.length)];
  if (r < 0.55) return FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
  if (r < 0.65) return PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
  if (r < 0.8) return ["FACTURA", "Fecha", "Total", "Subtotal", "IGIC", "IVA"][Math.floor(rand() * 6)];
  if (r < 0.9) return `${Math.floor(rand() * 100)},${Math.floor(rand() * 100).toString().padStart(2, "0")}`;
  if (r < 0.95) return `${Math.floor(rand() * 28 + 1).toString().padStart(2, "0")}/${Math.floor(rand() * 12 + 1).toString().padStart(2, "0")}/${Math.floor(rand() * 30 + 2000)}`;
  return `Label${Math.floor(rand() * 100)}`;
}

function randomInvoice(rand) {
  const n = 30 + Math.floor(rand() * 60);
  const tokens = [];
  for (let i = 0; i < n; i++) {
    tokens.push({
      text: randomToken(rand),
      page: 1,
      bbox: { x: i * 10, y: 100 + Math.floor(rand() * 50), width: 80, height: 20 },
      confidenceBps: 8000 + Math.floor(rand() * 2000),
    });
  }
  return tokens;
}

test("property: 1000 random synthetic invoices → 0 PII matches per audit", () => {
  const rand = lcg(42);
  let maxMatches = 0;
  let worstId = -1;
  for (let i = 0; i < 1000; i++) {
    const tokens = randomInvoice(rand);
    const sanitized = sanitizeTokensForLLM(tokens, { pageWidth: 1000, pageHeight: 1000 });
    const audit = auditSanitizedPayload(sanitized.tokens);
    if (audit.piiRegexMatches > maxMatches) {
      maxMatches = audit.piiRegexMatches;
      worstId = i;
    }
  }
  assert.equal(maxMatches, 0, `worst invoice ${worstId} had ${maxMatches} PII matches`);
});
