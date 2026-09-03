// Phase 1 of llm-assisted-parser-anonymized (TDD RED → GREEN → TRIANGULATE → REFACTOR)
//
// Tests the sanitization module that MUST sit between any invoice OCR stream
// and any external LLM egress. The module's job:
//   1. Take raw OCR tokens (with potential PII in `text`).
//   2. Apply a deterministic set of PII regex rules + a closed dictionary of
//      supplier / customer / street names.
//   3. Replace PII with placeholders (`<email>`, `<url>`, `<iban>`, `<nif>`,
//      `<tel>`, `<ref>`, `<name>`, `<amt>`, `<date>`).
//   4. Emit an audit envelope describing what was redacted.
//   5. Provide a `auditSanitizedPayload` re-scan function that confirms the
//      sanitized output still contains zero PII — fail-closed egress boundary.
//
// RGPD Art. 4(5) + WP216/EDPB: this is anonymization by suppression, not
// pseudonymization. No raw PII byte leaves the device.

import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeTokensForLLM,
  auditSanitizedPayload,
  sanitizeTextForLLM,
} from "../src/llm-sanitize.js";

const token = (text, page = 1, x = 0) => ({
  text,
  page,
  bbox: { x, y: 0, width: 100, height: 20 },
  confidenceBps: 9500,
});

// --- Task 1.1: planted-PII deterministic test ---------------------------

test("planted PII: email, NIF, IBAN, phone, supplier name → expected placeholders", () => {
  const tokens = [
    token("Factura FAC002147"),
    token("info@eyserhidraulica.com"),
    token("NIF: B05448063"),
    token("IBAN: ES4300815543580001340244"),
    token("Tel: +34 654 53 56 12"),
    token("WOLTERS"),
    token("KLUWER"),
    token("Fecha: 01/06/2026"),
    token("Total: 12,00 EUR"),
  ];
  const result = sanitizeTokensForLLM(tokens, { pageWidth: 1000, pageHeight: 1000 });
  const texts = result.tokens.map((t) => t.text);

  // Labels preserved (verbatim)
  assert.ok(texts.some((t) => /Factura/.test(t)), "Factura label kept");
  assert.ok(texts.some((t) => /Fecha/.test(t)), "Fecha label kept");
  assert.ok(texts.some((t) => /Total/.test(t)), "Total label kept");

  // PII replaced with placeholders
  assert.ok(!texts.some((t) => /eyserhidraulica\.com/.test(t)), "email redacted");
  assert.ok(texts.some((t) => /<email>/.test(t)), "email placeholder emitted");
  assert.ok(!texts.some((t) => /B05448063/.test(t)), "NIF redacted");
  assert.ok(texts.some((t) => /<nif>/.test(t)), "nif placeholder emitted");
  assert.ok(!texts.some((t) => /ES4300815543580001340244/.test(t)), "IBAN redacted");
  assert.ok(texts.some((t) => /<iban>/.test(t)), "iban placeholder emitted");
  assert.ok(!texts.some((t) => /\+34 654 53 56 12/.test(t)), "phone redacted");
  assert.ok(texts.some((t) => /<tel>/.test(t)), "tel placeholder emitted");
  assert.ok(!texts.some((t) => /\bWOLTERS\b/.test(t)), "supplier name redacted");
  assert.ok(!texts.some((t) => /\bKLUWER\b/.test(t)), "supplier name redacted");
  assert.ok(texts.some((t) => /<name>/.test(t)), "name placeholder emitted");

  // Date and amount kept visible (structural, not PII in isolation)
  assert.ok(texts.some((t) => /01\/06\/2026/.test(t)), "date kept");
  assert.ok(texts.some((t) => /12,00/.test(t)), "amount kept");

  // Audit counts
  assert.ok(result.audit.ruleHits.email >= 1, "email rule counted");
  assert.ok(result.audit.ruleHits.nif >= 1, "nif rule counted");
  assert.ok(result.audit.ruleHits.iban >= 1, "iban rule counted");
  assert.ok(result.audit.ruleHits.tel >= 1, "tel rule counted");
  assert.ok(result.audit.placeholderCount >= 5, "≥5 placeholders emitted");
  assert.ok(result.audit.totalBytes > 0, "byte count > 0");
});

// --- Task 1.1: empty input ----------------------------------------------

test("empty token stream → empty sanitized output, zero placeholders", () => {
  const result = sanitizeTokensForLLM([], { pageWidth: 1000, pageHeight: 1000 });
  assert.equal(result.tokens.length, 0);
  assert.equal(result.audit.placeholderCount, 0);
  assert.equal(result.audit.totalBytes, 0);
});

// --- Task 1.1: re-scan returns 0 for sanitized, >0 for unsanitized -------

test("auditSanitizedPayload: returns 0 for sanitized output, >0 for raw PII", () => {
  const sanitized = sanitizeTokensForLLM(
    [token("Factura"), token("info@x.com"), token("WOLTERS"), token("B12345678")],
    { pageWidth: 1000, pageHeight: 1000 },
  );
  const cleanAudit = auditSanitizedPayload(sanitized.tokens);
  assert.equal(cleanAudit.piiRegexMatches, 0, "no PII in sanitized output");

  const rawAudit = auditSanitizedPayload([
    token("info@x.com"),
    token("WOLTERS"),
    token("B12345678"),
  ]);
  assert.ok(rawAudit.piiRegexMatches > 0, "raw PII detected by audit");
});

// --- Task 1.4: no PII → output equals input ------------------------------

test("synthetic invoice with no PII → labels and structure preserved", () => {
  const tokens = [
    token("Factura"),
    token("Fecha"),
    token("Total"),
    token("Subtotal"),
    token("IGIC"),
    token("IVA"),
  ];
  const result = sanitizeTokensForLLM(tokens, { pageWidth: 1000, pageHeight: 1000 });
  for (let i = 0; i < tokens.length; i += 1) {
    assert.equal(result.tokens[i].text, tokens[i].text, `token ${i} preserved`);
  }
  assert.equal(result.audit.placeholderCount, 0);
});

// --- Task 1.4: overlapping rules → first-match deterministic ------------

test("overlapping rules: email containing URL substring → email first", () => {
  // The substring "x.com" inside an email is also a URL pattern; the email
  // rule MUST win because it appears first in the rule list.
  const tokens = [token("Visit https://shop.example.com/path or email info@x.com")];
  const result = sanitizeTokensForLLM(tokens, { pageWidth: 1000, pageHeight: 1000 });
  const text = result.tokens[0].text;
  assert.ok(/<email>/.test(text), "email placeholder applied");
  assert.ok(!/x\.com/.test(text), "raw email gone");
});

// --- Task 1.4: unicode characters → no false positives ------------------

test("unicode characters: 'Año', 'Niño' → not redacted", () => {
  const tokens = [token("Año 2026"), token("Niño García")];
  const result = sanitizeTokensForLLM(tokens, { pageWidth: 1000, pageHeight: 1000 });
  assert.equal(result.tokens[0].text, "Año 2026");
  assert.equal(result.tokens[1].text, "Niño García");
  assert.equal(result.audit.placeholderCount, 0);
});

// --- Task 1.4: long text capped at 256 chars -----------------------------

test("long token text capped at 256 chars", () => {
  const long = "A".repeat(500);
  const result = sanitizeTokensForLLM([token(long)], { pageWidth: 1000, pageHeight: 1000 });
  assert.ok(result.tokens[0].text.length <= 256, "capped at 256");
});

// --- sanitizeTextForLLM convenience helper -------------------------------

test("sanitizeTextForLLM: convenience function for single string", () => {
  const out = sanitizeTextForLLM("Email me at jane@example.com please");
  assert.ok(/<email>/.test(out));
  assert.ok(!/jane@example\.com/.test(out));
});

// --- Confidence and bbox preservation ------------------------------------

test("confidence and bbox preserved through sanitization", () => {
  const t = { ...token("B05448063"), bbox: { x: 42, y: 99, width: 88, height: 12 }, confidenceBps: 7777 };
  const result = sanitizeTokensForLLM([t], { pageWidth: 1000, pageHeight: 1000 });
  assert.equal(result.tokens[0].bbox.x, 42);
  assert.equal(result.tokens[0].bbox.width, 88);
  assert.equal(result.tokens[0].confidenceBps, 7777);
});
