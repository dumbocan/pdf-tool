import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJcsInput, canonicalizeJcs, ContractError, hashJcs } from "./jcs.js";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../contracts/invoice-learning/v1");
const SCHEMA_FILES = new Set(["invoice-learning.schema.json", "template.schema.json", "proposal.schema.json", "operations.schema.json"]);
const CACHE = new Map();
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fail = (code, reason, message = reason) => { throw new ContractError(code, reason, message); };
const ISO_CODES = new Set(JSON.parse(readFileSync(path.join(DIR, "iso-4217-snapshot.json"), "utf8")).entries.map(({ code }) => code));
const same = (a, b) => canonicalizeJcs(a) === canonicalizeJcs(b);
function schemaFile(name) { if (!SCHEMA_FILES.has(name)) fail("schema_invalid", "UNKNOWN_SCHEMA"); if (!CACHE.has(name)) CACHE.set(name, JSON.parse(readFileSync(path.join(DIR, name), "utf8"))); return CACHE.get(name); }
function pointer(root, fragment) { return fragment.slice(1).split("/").filter(Boolean).reduce((o, p) => o[p.replaceAll("~1", "/").replaceAll("~0", "~")], root); }
function check(value, schema, root, location = "$", seen = new Set()) {
  if (schema.$ref) { const [file, fragment = "#"] = schema.$ref.split("#"); const r = file ? schemaFile(path.basename(file)) : root; return check(value, fragment === "#" ? r : pointer(r, fragment), r, location, seen); }
  if (schema.const !== undefined && !same(value, schema.const)) fail("schema_invalid", "CONST", `${location} has an invalid literal`);
  if (schema.enum && !schema.enum.some((item) => same(value, item))) fail("schema_invalid", "ENUM", `${location} has an invalid enum value`);
  if (schema.oneOf || schema.anyOf) { let matches = 0; for (const option of schema.oneOf ?? schema.anyOf) { try { check(value, option, root, location, new Set(seen)); matches += 1; } catch (e) { if (!(e instanceof ContractError)) throw e; } } if (schema.oneOf ? matches !== 1 : matches === 0) fail("schema_invalid", schema.oneOf ? "ONE_OF" : "ANY_OF"); return true; }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("schema_invalid", "TYPE");
    if (seen.has(value)) fail("semantic_invalid", "CIRCULAR_REFERENCE"); seen.add(value);
    for (const key of schema.required ?? []) if (!own(value, key)) fail("schema_invalid", "REQUIRED", `${location}.${key} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!own(schema.properties ?? {}, key)) fail("schema_invalid", "UNKNOWN_FIELD", `${location}.${key}`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (own(value, key)) check(value[key], child, root, `${location}.${key}`, seen);
    seen.delete(value);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) fail("schema_invalid", "TYPE");
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("schema_invalid", "MIN_ITEMS"); if (schema.maxItems !== undefined && value.length > schema.maxItems) fail("schema_invalid", "MAX_ITEMS");
    if (schema.uniqueItems && new Set(value.map(canonicalizeJcs)).size !== value.length) fail("schema_invalid", "DUPLICATE_ITEM");
    for (const [i, child] of (schema.prefixItems ?? []).entries()) if (i < value.length) check(value[i], child, root, `${location}[${i}]`, seen);
    const start = schema.prefixItems?.length ?? 0; if (schema.items) for (let i = start; i < value.length; i += 1) check(value[i], schema.items, root, `${location}[${i}]`, seen);
  } else if (schema.type === "string") {
    if (typeof value !== "string") fail("schema_invalid", "TYPE"); if (schema.minLength !== undefined && value.length < schema.minLength) fail("schema_invalid", "MIN_LENGTH"); if (schema.maxLength !== undefined && value.length > schema.maxLength) fail("schema_invalid", "MAX_LENGTH"); if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail("schema_invalid", "PATTERN");
  } else if (schema.type === "integer") { if (!Number.isSafeInteger(value)) fail("semantic_invalid", "UNSAFE_NUMBER"); if (schema.minimum !== undefined && value < schema.minimum) fail("schema_invalid", "MINIMUM"); if (schema.maximum !== undefined && value > schema.maximum) fail("schema_invalid", "MAXIMUM");
  } else if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) fail("semantic_invalid", "NON_FINITE_NUMBER"); else if (schema.type === "boolean" && typeof value !== "boolean") fail("schema_invalid", "TYPE");
  return true;
}
function skip(s, i) { while (i < s.length && /[\t\n\f\r ]/.test(s[i])) i += 1; return i; }
function stringEnd(s, start) { let i = start + 1; while (i < s.length) { if (s[i] === "\\") i += 2; else if (s[i++] === '"') { if (i - start - 2 > 1_048_576) fail("bounded_resource", "MAX_STRING_BYTES"); return i; } } fail("schema_invalid", "INVALID_JSON"); }
function decodeKey(s, start, end) { let out = ""; for (let i = start + 1; i < end - 1; i += 1) { if (s[i] !== "\\") { out += s[i]; continue; } const e = s[++i]; const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }; if (e === "u") { const hex = s.slice(i + 1, i + 5); if (!/^[0-9a-f]{4}$/i.test(hex)) fail("schema_invalid", "INVALID_JSON"); out += String.fromCharCode(Number.parseInt(hex, 16)); i += 4; } else if (own(simple, e)) out += simple[e]; else fail("schema_invalid", "INVALID_JSON"); } return out; }
function scan(s, i, depth = 0) {
  i = skip(s, i); if (depth > 64) fail("bounded_resource", "MAX_JSON_DEPTH");
  if (s[i] === "{") { i = skip(s, i + 1); const keys = new Set(); let count = 0; if (s[i] === "}") return i + 1; while (i < s.length) { if (++count > 8192) fail("bounded_resource", "MAX_OBJECT_MEMBERS"); if (s[i] !== '"') fail("schema_invalid", "INVALID_JSON"); const end = stringEnd(s, i); const key = decodeKey(s, i, end); if (keys.has(key)) fail("schema_invalid", "DUPLICATE_KEY"); keys.add(key); i = skip(s, end); if (s[i++] !== ":") fail("schema_invalid", "INVALID_JSON"); i = scan(s, i, depth + 1); i = skip(s, i); if (s[i] === "}") return i + 1; if (s[i++] !== ",") fail("schema_invalid", "INVALID_JSON"); i = skip(s, i); } }
  else if (s[i] === "[") { i = skip(s, i + 1); let count = 0; if (s[i] === "]") return i + 1; while (i < s.length) { if (++count > 8192) fail("bounded_resource", "MAX_ARRAY_ITEMS"); i = scan(s, i, depth + 1); i = skip(s, i); if (s[i] === "]") return i + 1; if (s[i++] !== ",") fail("schema_invalid", "INVALID_JSON"); i = skip(s, i); } }
  else if (s[i] === '"') return stringEnd(s, i); else { const start = i; while (i < s.length && !",]}\t\n\f\r ".includes(s[i])) i += 1; if (start === i) fail("schema_invalid", "INVALID_JSON"); return i; }
  fail("schema_invalid", "INVALID_JSON");
}
export function parseContractJson(raw, { topLevelObject = true } = {}) { if (typeof raw === "string") assertJcsInput(raw); const bytes = Buffer.isBuffer(raw) ? raw : typeof raw === "string" ? Buffer.from(raw, "utf8") : null; if (!bytes) fail("schema_invalid", "INVALID_INPUT"); if (bytes.length > 1_048_576) fail("bounded_resource", "MAX_SERIALIZED_RESULT_BYTES"); let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("schema_invalid", "INVALID_UTF8"); } if (text.charCodeAt(0) === 0xfeff) fail("schema_invalid", "BOM_NOT_ALLOWED"); const first = skip(text, 0); if (topLevelObject && text[first] !== "{") fail("schema_invalid", "ROOT_MUST_BE_OBJECT"); const end = scan(text, first); if (skip(text, end) !== text.length) fail("schema_invalid", "INVALID_JSON"); let value; try { value = JSON.parse(text); } catch { fail("schema_invalid", "INVALID_JSON"); } assertJcsInput(value); return value; }
export function validateSchema(value, schemaOrName) { assertJcsInput(value); const root = typeof schemaOrName === "string" ? schemaFile(schemaOrName) : schemaOrName; check(value, root, root); return true; }

const present = (v) => v?.state === "PRESENT";
function rect(r) { if (!r || ![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1 || r.x + r.width > 10000 || r.y + r.height > 10000) fail("semantic_invalid", "INVALID_GEOMETRY"); }
function envelope(v, name, ids) { if (present(v)) for (const e of v.evidence ?? []) { rect(e.rect); if (ids.has(e.evidenceId)) fail("semantic_invalid", "DUPLICATE_EVIDENCE"); ids.add(e.evidenceId); } else if (v?.state !== "MISSING") fail("semantic_invalid", `INVALID_${name.toUpperCase()}_ENVELOPE`); }
function decimal(v, places) { if (typeof v !== "string" || !new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{0,${places - 1}}[1-9])?$`).test(v)) fail("semantic_invalid", "INVALID_DECIMAL"); }
function add(a, b) { const [ai, af = ""] = a.split("."), [bi, bf = ""] = b.split("."), scale = Math.max(af.length, bf.length), sum = (BigInt(ai + af.padEnd(scale, "0")) + BigInt(bi + bf.padEnd(scale, "0"))).toString().padStart(scale + 1, "0"); return scale ? `${sum.slice(0, -scale)}.${sum.slice(-scale).replace(/0+$/, "") || "0"}` : sum; }
function validDate(v) { const [y, m, d] = v.split("-").map(Number); const date = new Date(Date.UTC(y, m - 1, d)); return y >= 1900 && y <= 9999 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d; }
function projectionSemantics(v) {
  if (!v.tokens || !v.groups || !v.relationships || !v.counts) return;
  if (v.counts.tokenCount !== v.tokens.length || v.counts.groupCount !== v.groups.length || v.counts.relationshipCount !== v.relationships.length) fail("semantic_invalid", "PROJECTION_COUNT_MISMATCH");
  const tokens = new Set(v.tokens.map((t) => { rect(t.normalizedRect); return t.opaqueId; })); const groups = new Set(v.groups.map((g) => g.groupId)); if (groups.size !== v.groups.length || tokens.size !== v.tokens.length) fail("semantic_invalid", "DUPLICATE_PROJECTION_ID");
  const edges = new Set(); const next = new Map();
  for (const e of v.relationships) { const key = canonicalizeJcs(e); if (edges.has(key)) fail("semantic_invalid", "DUPLICATE_RELATIONSHIP"); edges.add(key); const ts = [e.tokenId, e.headerTokenId, e.labelTokenId, e.valueTokenId, e.fromTokenId, e.toTokenId].filter(Boolean); const gs = [e.rowId, e.columnId, e.repeatedRowId, e.canonicalRowId].filter(Boolean); if (ts.some((id) => !tokens.has(id)) || gs.some((id) => !groups.has(id))) fail("semantic_invalid", "MISSING_RELATIONSHIP_REFERENCE"); if (e.fromTokenId === e.toTokenId || e.repeatedRowId === e.canonicalRowId || e.labelTokenId === e.valueTokenId) fail("semantic_invalid", "RELATIONSHIP_SELF_EDGE"); if (e.kind === "NEXT_IN_READING_ORDER") next.set(e.fromTokenId, e.toTokenId); }
  for (const start of next.keys()) { const seen = new Set(); let cursor = start; while (next.has(cursor)) { if (seen.has(cursor)) fail("semantic_invalid", "RELATIONSHIP_CYCLE"); seen.add(cursor); cursor = next.get(cursor); } }
}
export function validateSemantic(value) { assertJcsInput(value); projectionSemantics(value); if (value?.confidenceBps !== undefined && (!Number.isSafeInteger(value.confidenceBps) || value.confidenceBps < 0 || value.confidenceBps > 10000)) fail("semantic_invalid", "UNSAFE_NUMBER"); if (value?.record) { const ids = new Set(); for (const [name, v] of Object.entries(value.record)) if (name !== "lineItems") envelope(v, name, ids); if (value.supplierCandidate && present(value.record.supplier) && !same(value.supplierCandidate, { supplierCandidateId: value.record.supplier.value.supplierCandidateId, displayName: value.record.supplier.value.displayName, evidence: value.supplierCandidate.evidence })) fail("semantic_invalid", "SUPPLIER_MISMATCH"); for (const row of value.record.lineItems ?? []) for (const name of ["description", "quantity", "unitPrice"]) envelope(row[name], name, ids); const money = [value.record.taxableBase, value.record.taxes, value.record.total]; for (const v of money) if (present(v)) decimal(v.value, 4); for (const row of value.record.lineItems ?? []) { if (present(row.quantity)) decimal(row.quantity.value, 6); if (present(row.unitPrice)) decimal(row.unitPrice.value, 4); } if (present(value.record.currency) && !ISO_CODES.has(value.record.currency.value)) fail("semantic_invalid", "UNSUPPORTED_CURRENCY"); if (money.every(present) && add(money[0].value, money[1].value) !== money[2].value) fail("semantic_invalid", "ARITHMETIC_INVALID"); if (present(value.record.invoiceDate) && !validDate(value.record.invoiceDate.value)) fail("semantic_invalid", "INVALID_DATE"); } return true; }
export function validateInvoiceEvidence(v) { validateSchema(v, "invoice-learning.schema.json"); return validateSemantic(v); }
export function validateTemplate(v) { validateSchema(v, "template.schema.json"); validateSemantic(v); if (layoutFingerprint(v) !== v.layoutFingerprint) fail("semantic_invalid", "FINGERPRINT_MISMATCH"); return true; }
export function validateProposal(v) { validateSchema(v, "proposal.schema.json"); return validateSemantic(v); }
export function validateOperation(v) { validateSchema(v, "operations.schema.json"); return validateSemantic(v); }
export function validateProjection(v) { validateSchema(v, { $ref: "proposal.schema.json#/$defs/ProjectionHashInputV1" }); return validateSemantic(v); }
export function layoutFingerprintInput(v) { return { invoiceEvidenceSchemaVersion: "1", templateSchemaVersion: v.templateSchemaVersion, executionPolicyVersion: v.executionPolicyVersion, matchingKey: v.matchingKey, requiredAnchors: v.requiredAnchors, optionalAnchors: v.optionalAnchors, repeatedHeaderSignature: v.repeatedHeaderSignature, columnOrder: v.columnOrder }; }
export function layoutFingerprint(v) { return hashJcs(layoutFingerprintInput(v)); }
export function acceptFixtureSets(directory = path.join(DIR, "fixtures")) { const names = ["valid", "invalid", "duplicate-keys", "jcs", "errors-and-idempotency"]; let total = 0; let accepted = 0; for (const name of names) { const fixture = parseContractJson(readFileSync(path.join(directory, `${name}.json`))); if (fixture.fixtureSetSchemaVersion !== "1" || !Array.isArray(fixture.vectors) || canonicalizeJcs(Object.keys(fixture)) !== '["fixtureSetSchemaVersion","vectors"]') fail("schema_invalid", "FIXTURE_SHAPE"); for (const v of fixture.vectors) { total += 1; accepted += v.expected === "ACCEPT" ? 1 : 0; if (createHash("sha256").update(v.bytes, "utf8").digest("hex") !== v.bytesSha256) fail("schema_invalid", "FIXTURE_DIGEST"); if (name === "duplicate-keys" && v.expected === "REJECT") { try { parseContractJson(v.bytes); fail("schema_invalid", "FIXTURE_EXPECTATION"); } catch (e) { if (!(e instanceof ContractError) || e.reason !== "DUPLICATE_KEY") throw e; } } if (name === "jcs") { const input = parseContractJson(v.input, { topLevelObject: false }); if (canonicalizeJcs(input) !== v.canonicalUtf8 || hashJcs(input) !== v.bytesSha256) fail("semantic_invalid", "JCS_GOLDEN"); } } } return { fixtureCount: names.length, vectorCount: total, accepted, rejected: total - accepted }; }
export { ContractError };
