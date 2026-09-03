// Phase 1 of llm-assisted-parser-anonymized.
//
// Sanitization module that sits between any invoice OCR stream and any external
// LLM egress. The module's job:
//   1. Take raw OCR tokens (with potential PII in `text`).
//   2. Apply a deterministic set of PII regex rules + a closed dictionary of
//      supplier / customer / street names.
//   3. Replace PII with placeholders (`<email>`, `<url>`, `<iban>`, `<nif>`,
//      `<tel>`, `<ref>`, `<name>`, `<amt>`, `<date>`).
//   4. Emit an audit envelope describing what was redacted.
//   5. Provide `auditSanitizedPayload` re-scan function that confirms the
//      sanitized output still contains zero PII — fail-closed egress boundary.
//
// RGPD Art. 4(5) + WP216/EDPB: this is anonymization by suppression, not
// pseudonymization. No raw PII byte leaves the device.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NAME_DICTIONARY = JSON.parse(
  readFileSync(join(__dirname, "llm-sanitize-names.json"), "utf8"),
);

const MAX_TOKEN_TEXT_CHARS = 256;

// Pass 1 — PII regex rules (order matters: first match wins).
// Each rule: [name, regex, placeholder]
const PII_RULES = Object.freeze([
  ["email", /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, "<email>"],
  ["url", /\b(?:https?:\/\/|www\.)[^\s]+/i, "<url>"],
  // Spanish IBAN (with or without masking); the fragment rule catches short
  // occurrences that the long-IBAN rule misses.
  ["iban", /\bES\d{2}[\d\s*]{15,}\b/, "<iban>"],
  ["iban", /\bES\d{2}\b/, "<iban>"],
  // Invoice refs with a separator (`L2026S5151/7136`, `80018183-0025`).
  ["ref", /\b(?:[A-Z][A-Z0-9]+|\d{6,})[\-\/\.][A-Z0-9\-\/\.]+\b/, "<ref>"],
  ["nif", /\bEU\d{6,}\b/, "<nif>"],
  ["nif", /\b[A-Z]{2}\d{7,8}\b/, "<nif>"],
  ["nif", /\b[ABCDEFGHJNPQRSUVW]\d{7,8}\b/, "<nif>"],
  // Standalone alphanumeric codes (e.g. `FAC002147`, `04012A301272`).
  ["ref", /\b(?:[A-Z]+\d+|\d+[A-Z]+|\d+[A-Z]+\d*)[A-Z0-9]{3,}\b/, "<ref>"],
  ["ref", /\b\d{6,}\b/, "<ref>"],
  // Spanish phone (mobile 6/7/9 + 8 more digits, optional `+` and country code).
  // Tolerates both space-separated (`654 53 56 12`) and packed (`654535612`)
  // formats. Order matters: this rule MUST run after IBAN/email so it doesn't
  // accidentally swallow ISO dates (see commit message for context).
  ["tel", /(?:\+\d{1,3}[\s.-]?)?[679][\d\s.-]{7,12}\d\b/, "<tel>"],
]);

const NAME_SET = new Set(NAME_DICTIONARY.map((n) => n.toUpperCase().replace(/[.,]$/, "")));

function sanitizeString(input) {
  let out = String(input);
  for (const [, re, rep] of PII_RULES) {
    out = out.replace(re, rep);
  }
  // Closed dictionary pass: replace whole-token matches of known names.
  // We iterate over the dictionary and replace each occurrence.
  for (const name of NAME_DICTIONARY) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, "<name>");
  }
  // Drop stray `@` and `#` symbols left over from split email/URL tokens.
  out = out.replace(/@/g, "").replace(/[#]+/g, "");
  // Collapse repeated placeholders.
  out = out.replace(/(<\w+>)(\s*\1)+/g, "$1");
  return out.trim();
}

function compileRules() {
  // Already compiled (frozen on module load). Exposed for test introspection.
  return PII_RULES.map(([name, re, rep]) => [name, re, rep]);
}

/**
 * Sanitize a token stream for LLM egress. Preserves geometry and confidence.
 * Returns the sanitized token stream and an audit envelope.
 *
 * @param {Array} tokens - raw OCR tokens, each with `text`, `page`, `bbox`, `confidenceBps`
 * @param {Object} options - `{ pageWidth, pageHeight, rules?, dictionary? }`
 * @returns {Object} `{ tokens, audit: { ruleHits, placeholderCount, totalBytes } }`
 */
export function sanitizeTokensForLLM(tokens, options = {}) {
  const ruleHits = {};
  for (const [name] of PII_RULES) ruleHits[name] = 0;
  let placeholderCount = 0;
  let totalBytes = 0;

  const out = [];
  for (const t of tokens) {
    if (!t || typeof t.text !== "string") continue;
    let text = sanitizeString(t.text);
    if (text.length > MAX_TOKEN_TEXT_CHARS) text = text.slice(0, MAX_TOKEN_TEXT_CHARS);
    // Count placeholders emitted.
    const placeholders = text.match(/<\w+>/g) || [];
    for (const ph of placeholders) {
      const kind = ph.slice(1, -1);
      if (kind in ruleHits) ruleHits[kind] += 1;
      else if (kind === "name") ruleHits.name = (ruleHits.name || 0) + 1;
    }
    placeholderCount += placeholders.length;
    totalBytes += text.length;
    out.push({
      ...t,
      text,
      kind: placeholders.length > 0 ? "placeholder" : (t.kind || "context"),
      originalKind: t.originalKind || (t.text !== text ? "alphanumeric" : "text"),
    });
  }

  return {
    tokens: out,
    audit: { ruleHits, placeholderCount, totalBytes },
  };
}

/**
 * Convenience: sanitize a single string for callers that don't have a token
 * stream yet.
 */
export function sanitizeTextForLLM(text) {
  let out = sanitizeString(text);
  if (out.length > MAX_TOKEN_TEXT_CHARS) out = out.slice(0, MAX_TOKEN_TEXT_CHARS);
  return out;
}

/**
 * Re-scan the sanitized output for PII patterns. Returns 0 if clean; any
 * non-zero result indicates a sanitization hole that MUST abort egress.
 *
 * @param {Array} tokens - sanitized tokens (post-sanitizeTokensForLLM)
 * @returns {Object} `{ piiRegexMatches, scannedBytes, scanRules }`
 */
export function auditSanitizedPayload(tokens) {
  const scanRules = PII_RULES.map(([name]) => name);
  let piiRegexMatches = 0;
  let scannedBytes = 0;
  for (const t of tokens || []) {
    if (!t || typeof t.text !== "string") continue;
    const text = t.text;
    scannedBytes += text.length;
    for (const [name, re] of PII_RULES) {
      const matches = text.match(re);
      if (matches) piiRegexMatches += matches.length;
    }
  }
  return { piiRegexMatches, scannedBytes, scanRules };
}

// Re-export for test introspection (REFACTOR step).
export const __test__ = { PII_RULES, NAME_DICTIONARY, NAME_SET, compileRules };
