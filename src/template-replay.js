import { readFileSync } from "node:fs";
import { parseContractJson, validateInvoiceEvidence, validateTemplate as validateTemplateSchema } from "./invoice-learning-contract.js";
import { hashJcs } from "./jcs.js";

export const TEMPLATE_DEFAULTS = Object.freeze({ toleranceBps: Object.freeze({ x: 200, y: 200 }), confidenceFloorBps: 9000 });
const FIELDS = ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total"];
const STEPS = new Set(["TRIM_ASCII_WHITESPACE", "COLLAPSE_ASCII_WHITESPACE", "DATE_DD_MM_YYYY_TO_ISO", "DECIMAL_DOT_THOUSANDS_TO_DECIMAL", "DECIMAL_COMMA_TO_DOT", "UPPERCASE_ASCII", "IDENTITY"]);
const FIELD_KIND = { supplier: "text", invoiceNumber: "text", invoiceDate: "date", currency: "currency", taxableBase: "money", taxes: "money", total: "money", description: "text", quantity: "quantity", unitPrice: "money" };
const ID = /^a_[0-9a-f]{16}$/;
const fail = (reason) => { throw new TypeError(`template_invalid:${reason}`); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function draftTemplate(value) {
  if (typeof value === "string") return parseContractJson(value);
  if (value?.state === "DRAFT" && value.template) return value.template;
  return value;
}
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((k) => own(value, k));
}
function checkNormalization(steps, kind) {
  if (!Array.isArray(steps) || steps.length > 3 || new Set(steps).size !== steps.length || steps.some((s) => !STEPS.has(s))) fail("normalization");
  if (steps.includes("IDENTITY") && steps.length !== 1) fail("identity_exclusive");
  const applicable = {
    TRIM_ASCII_WHITESPACE: ["text", "date", "currency", "money", "quantity"],
    COLLAPSE_ASCII_WHITESPACE: ["text"], DATE_DD_MM_YYYY_TO_ISO: ["date"],
    DECIMAL_DOT_THOUSANDS_TO_DECIMAL: ["money", "quantity"], DECIMAL_COMMA_TO_DOT: ["money", "quantity"],
    UPPERCASE_ASCII: ["currency"], IDENTITY: Object.keys(FIELD_KIND),
  };
  if (steps.some((s) => !applicable[s].includes(kind))) fail("inapplicable_normalization");
  if (steps.includes("COLLAPSE_ASCII_WHITESPACE") && steps.includes("TRIM_ASCII_WHITESPACE")) fail("duplicate_whitespace");
  if (steps.filter((s) => s.startsWith("DECIMAL_")).length > 1) fail("decimal_conflict");
  if (steps.some((s) => s.startsWith("DECIMAL_")) && steps.includes("DATE_DD_MM_YYYY_TO_ISO")) fail("date_decimal_conflict");
  const order = steps.map((s) => s === "TRIM_ASCII_WHITESPACE" || s === "COLLAPSE_ASCII_WHITESPACE" ? 0 : s.startsWith("DECIMAL_") || s === "DATE_DD_MM_YYYY_TO_ISO" ? 1 : 2);
  if (order.some((n, i) => i && n < order[i - 1])) fail("normalization_order");
}
function selectorChecks(t) {
  const anchors = [...t.requiredAnchors, ...t.optionalAnchors];
  const byId = new Map();
  for (const a of anchors) {
    if (!ID.test(a.identifier) || byId.has(a.identifier)) fail("anchor_identity");
    byId.set(a.identifier, a);
    if (!exact(a.toleranceBps, ["x", "y"]) || !Number.isSafeInteger(a.toleranceBps.x) || !Number.isSafeInteger(a.toleranceBps.y)) fail("tolerance");
    for (const n of ["x", "y"]) if (a.toleranceBps[n] < 0 || a.toleranceBps[n] > 500) fail("tolerance");
  }
  const refs = [];
  for (const name of FIELDS) {
    const s = t.selectors[name];
    if (!exact(s, ["kind", "target", "identifier", "occurrence", "normalization"]) || s.kind !== "FIELD" || s.target !== name) fail("field_selector");
    const a = byId.get(s.identifier); if (!a || a.role !== "FIELD_LABEL") fail("field_reference");
    checkNormalization(s.normalization, FIELD_KIND[name]); refs.push(s.identifier);
  }
  const li = t.selectors.lineItems;
  if (!exact(li, ["rowSelector", "description", "quantity", "unitPrice"])) fail("line_items");
  if (!exact(li.rowSelector, ["kind", "tableEvidence", "headerIdentifier", "requiredHeaderPolicy", "rowOrder"]) || li.rowSelector.kind !== "ROWS" || li.rowSelector.tableEvidence !== "LOCAL_TABLE" || li.rowSelector.rowOrder !== "SOURCE_ORDER") fail("row_selector");
  const header = byId.get(li.rowSelector.headerIdentifier); if (!header || !["TABLE_HEADER", "TABLE_BOUNDARY"].includes(header.role)) fail("header_reference"); refs.push(header.identifier);
  for (const name of ["description", "quantity", "unitPrice"]) { const s = li[name]; if (!exact(s, ["kind", "column", "identifier", "occurrence", "normalization"]) || s.kind !== "CELL" || s.column !== name || s.occurrence !== "ROW_ORDER") fail("cell_selector"); const a = byId.get(s.identifier); if (!a || !["TABLE_HEADER", "TABLE_BOUNDARY"].includes(a.role)) fail("cell_reference"); checkNormalization(s.normalization, FIELD_KIND[name]); refs.push(s.identifier); }
  for (const id of t.requiredAnchors.map((a) => a.identifier)) if (!refs.includes(id)) fail("unreferenced_required_anchor");
}
export function layoutFingerprintInput(template) { return { invoiceEvidenceSchemaVersion: "1", templateSchemaVersion: template.templateSchemaVersion, executionPolicyVersion: template.executionPolicyVersion, matchingKey: template.matchingKey, requiredAnchors: template.requiredAnchors, optionalAnchors: template.optionalAnchors, repeatedHeaderSignature: template.repeatedHeaderSignature, columnOrder: template.columnOrder }; }
export function layoutFingerprint(template) { return hashJcs(layoutFingerprintInput(template)); }
export function validateTemplateDraft(value) { const t = draftTemplate(value); validateTemplateSchema(t); selectorChecks(t); if (!Number.isSafeInteger(t.confidenceFloorBps) || t.confidenceFloorBps < 0 || t.confidenceFloorBps > 10000) fail("confidence_floor"); if (t.layoutFingerprint !== layoutFingerprint(t)) fail("fingerprint"); return true; }
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
export function approveTemplateDraft(value, { recordConfirmed } = {}) { if (recordConfirmed !== true) fail("record_confirmation_required"); if (value?.state && value.state !== "DRAFT") fail("already_approved"); const t = draftTemplate(value); validateTemplateDraft(t); return freeze(structuredClone(t)); }
export const validateTemplate = validateTemplateDraft;

const ISO = JSON.parse(readFileSync(new URL("../contracts/invoice-learning/v1/iso-4217-snapshot.json", import.meta.url), "utf8"));
const ISO_CODES = new Set(ISO.entries.map(({ code }) => code));
const PRESENT = (v) => v?.state === "PRESENT";
const same = (a, b) => hashJcs(a) === hashJcs(b);
const missing = (reason) => ({ state: "MISSING", reason });
const whitespace = /[\t\n\f\r ]/g;
function validDate(v) { if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return false; const [d, m, y] = v.split("/").map(Number); const date = new Date(Date.UTC(y, m - 1, d)); return y >= 1900 && y <= 9999 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d; }
function normalize(value, steps, kind) {
  if (typeof value !== "string") return null;
  let out = value;
  for (const step of steps) {
    if (step === "TRIM_ASCII_WHITESPACE") out = out.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
    else if (step === "COLLAPSE_ASCII_WHITESPACE") out = out.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "").replace(whitespace, " ").replace(/ +/g, " ");
    else if (step === "DATE_DD_MM_YYYY_TO_ISO") { if (!validDate(out)) return null; const [d, m, y] = out.split("/"); out = `${y}-${m}-${d}`; }
    else if (step === "DECIMAL_DOT_THOUSANDS_TO_DECIMAL") { if (!/^\d{1,3}(\.\d{3})+,[0-9]{1,6}$/.test(out)) return null; out = out.replaceAll(".", "").replace(",", "."); }
    else if (step === "DECIMAL_COMMA_TO_DOT") { if (!/^\d+,[0-9]{1,6}$/.test(out)) return null; out = out.replace(",", "."); }
    else if (step === "UPPERCASE_ASCII") { if (!/^[\x21-\x7e]+$/.test(out)) return null; out = [...out].map((c) => c >= "a" && c <= "z" ? c.toUpperCase() : c).join(""); }
  }
  const pattern = kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : kind === "currency" ? /^[A-Z]{3}$/ : kind === "money" ? /^(0|[1-9]\d*)(\.\d{1,4})?$/ : kind === "quantity" ? /^(0|[1-9]\d*)(\.\d{1,6})?$/ : /^\S(?:[^\x00-\x1f\x7f-\x9f]*\S)?$/;
  return pattern.test(out) && (kind !== "currency" || ISO_CODES.has(out)) ? out : null;
}
function replayValue(value, selector, kind) { if (!PRESENT(value)) return value; const supplier = selector.target === "supplier"; const raw = supplier ? value.value.displayName : value.value; const out = normalize(raw, selector.normalization, kind); if (out === null) return missing("INVALID_FORMAT"); return { ...value, value: supplier ? { ...value.value, displayName: out } : out, provenance: "REPLAY_LOCAL" }; }
function evidenceFor(record, selector) {
  if (selector.kind === "FIELD") return record[selector.target]?.evidence ?? [];
  return record.lineItems.flatMap((row) => row[selector.column]?.evidence ?? []);
}
function closeRect(a, b, tolerance) { return ["x", "width"].every((k) => Math.abs(a[k] - b[k]) <= tolerance.x) && ["y", "height"].every((k) => Math.abs(a[k] - b[k]) <= tolerance.y); }
function anchorsMatch(template, evidence) {
  const selectors = new Map(); for (const name of FIELDS) selectors.set(template.selectors[name].identifier, template.selectors[name]);
  const li = template.selectors.lineItems; for (const name of ["description", "quantity", "unitPrice"]) selectors.set(li[name].identifier, li[name]);
  let targetPage = null; let optionalMatches = 0;
  for (const [index, anchor] of [...template.requiredAnchors, ...template.optionalAnchors].entries()) {
    const selector = selectors.get(anchor.identifier); const fragments = selector ? evidenceFor(evidence.record, selector) : [];
    const occurrence = selector?.occurrence === "LAST" ? fragments.at(-1) : fragments[0];
    const relation = anchor.pageRelation;
    const pageOk = occurrence && (relation === "ANY_PAGE" || (relation === "FIRST_PAGE" && occurrence.page === 1) || (relation === "SAME_PAGE_AS_TARGET" && targetPage !== null && occurrence.page === targetPage) || (relation === "PRIOR_PAGE" && targetPage !== null && occurrence.page < targetPage));
    const matched = Boolean(occurrence && pageOk && closeRect(anchor.rectangle, occurrence.rect, anchor.toleranceBps));
    if (index < template.requiredAnchors.length && !matched) return { required: false, optional: optionalMatches };
    if (index >= template.requiredAnchors.length && matched) optionalMatches += 1;
    if (matched && targetPage === null) targetPage = occurrence.page;
  }
  return { required: true, optional: optionalMatches };
}
function requiredEvidence(record) { return FIELDS.every((name) => PRESENT(record[name]) && record[name].evidence.length > 0) && record.lineItems.length > 0 && record.lineItems.every((row) => ["description", "quantity", "unitPrice"].every((name) => PRESENT(row[name]) && row[name].evidence.length > 0)); }
function failOutcome(evidence, template, outcome) { return { invoiceEvidence: evidence, templateId: template.templateId, layoutFingerprint: template.layoutFingerprint, replayCounters: { providerRequestCount: 0, automaticCorrectionCount: 0, userEditCount: 0 }, replayOutcome: outcome }; }

export function replayTemplate(evidence, template, { approvedProjection } = {}) {
  validateTemplateDraft(template);
  const out = structuredClone(evidence);
  try { validateInvoiceEvidence(out); } catch { return failOutcome(out, template, "FAILURE"); }
  if (out?.invoiceEvidenceSchemaVersion !== "1" || out?.iso4217Snapshot?.version !== ISO.version || out?.iso4217Snapshot?.checksumSha256 !== ISO.checksumSha256 || template.templateSchemaVersion !== "1" || template.executionPolicyVersion !== "1") return failOutcome(out, template, "FAILURE");
  const projection = approvedProjection;
  if (projection && (projection.matchingKey !== template.matchingKey || (projection.pdfSha256 && projection.pdfSha256 !== out.documentSha256) || (projection.currency && projection.currency !== out.record.currency?.value) || (projection.expectedRowCount && projection.expectedRowCount !== out.record.lineItems.length))) return failOutcome(out, template, "LAYOUT_MISMATCH");
  if (out.recordOutcome !== "EXTRACTED_UNTRUSTED") return failOutcome(out, template, out.recordOutcome === "UNSUPPORTED" ? "FAILURE" : "REVIEW_REQUIRED");
  if (!PRESENT(out.record.currency) || !/^[A-Z]{3}$/.test(out.record.currency.value) || !ISO_CODES.has(out.record.currency.value)) return failOutcome(out, template, "FAILURE");
  if (!same(out.table.repeatedHeaderSignature, template.repeatedHeaderSignature) || !same(out.table.columns.map(({ identifier }) => identifier), template.columnOrder)) return failOutcome(out, template, "LAYOUT_MISMATCH");
  if (!requiredEvidence(out.record)) return failOutcome(out, template, "REVIEW_REQUIRED");
  const result = anchorsMatch(template, out); if (!result.required) return failOutcome(out, template, "LAYOUT_MISMATCH");
  const score = template.optionalAnchors.length ? Math.floor(result.optional * 10000 / template.optionalAnchors.length) : 10000;
  if (score < template.confidenceFloorBps) return failOutcome(out, template, "LOW_CONFIDENCE");
  const record = out.record;
  for (const name of FIELDS) record[name] = replayValue(record[name], template.selectors[name], FIELD_KIND[name]);
  const cells = template.selectors.lineItems;
  for (const row of record.lineItems) for (const name of ["description", "quantity", "unitPrice"]) row[name] = replayValue(row[name], cells[name], FIELD_KIND[name]);
  out.supplierCandidate = PRESENT(record.supplier) ? { ...out.supplierCandidate, displayName: record.supplier.value.displayName } : null;
  const outcome = requiredEvidence(record) ? "REPLAY_LOCAL" : "REVIEW_REQUIRED";
  out.recordOutcome = outcome === "REPLAY_LOCAL" ? "EXTRACTED_UNTRUSTED" : outcome;
  if (outcome !== "REPLAY_LOCAL") out.reviewReasons = [...new Set([...(out.reviewReasons ?? []), "MISSING_EVIDENCE"] )];
  return failOutcome(out, template, outcome);
}
export const executeTemplateReplay = replayTemplate;
