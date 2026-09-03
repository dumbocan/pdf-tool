import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  ContractError,
  acceptFixtureSets,
  parseContractJson,
  validateInvoiceEvidence,
  validateProjection,
  validateSchema,
  validateSemantic,
} from "../src/invoice-learning-contract.js";
import { canonicalizeJcs, hashJcs } from "../src/jcs.js";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURE_DIR = resolve(ROOT, "contracts/invoice-learning/v1/fixtures");
const load = (name) => JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), "utf8"));
const errorCode = (action) => {
  try { action(); } catch (error) { return error.code; }
  return null;
};

function assertCode(action, code) {
  assert.equal(errorCode(action), code);
}

test("accepts the complete B2a fixture set without product imports", () => {
  const result = acceptFixtureSets(FIXTURE_DIR);
  assert.deepEqual(result, { fixtureCount: 5, vectorCount: 17, accepted: 7, rejected: 10 });
});

test("guards duplicate keys in raw UTF-8 before JSON parsing", () => {
  const distinct = parseContractJson(Buffer.from('{"left":{"id":1},"right":{"id":2}}'));
  assert.deepEqual(Object.keys(distinct), ["left", "right"]);
  for (const raw of [
    '{"state":"x","state":"y"}',
    '{"outer":{"id":1,"id":2}}',
    '{"a":1,"\\u0061":2}',
  ]) assertCode(() => parseContractJson(raw), "schema_invalid");
});

test("rejects invalid UTF-8 and bounded raw input without producing a value", () => {
  assertCode(() => parseContractJson(Buffer.from([0xc3, 0x28])), "schema_invalid");
  assertCode(() => parseContractJson(Buffer.alloc(1_048_577)), "bounded_resource");
  assertCode(() => parseContractJson("[]"), "schema_invalid");
  assertCode(() => parseContractJson("\\ufeff{}"), "schema_invalid");
  assertCode(() => parseContractJson(`${"{\"a\":".repeat(65)}1${"}".repeat(65)}`), "bounded_resource");
});

test("applies closed schema rules and rejects unknown members", () => {
  const schema = {
    type: "object", additionalProperties: false, required: ["id", "expected"],
    properties: { id: { type: "string" }, expected: { enum: ["ACCEPT", "REJECT"] } },
  };
  assert.equal(validateSchema({ id: "fixture", expected: "ACCEPT" }, schema), true);
  assertCode(() => validateSchema({ id: "fixture", expected: "ACCEPT", unknown: true }, schema), "schema_invalid");
});

function evidenceFixture() {
  const fragment = (id, localRef = { kind: "TOKEN", tokenId: "t_0000000000000000" }) => ({
    evidenceId: id.length === 22 ? `ev_${id.slice(-16)}` : id, page: 1, rect: { x: 0, y: 0, width: 100, height: 100 }, localRef,
  });
  const present = (value, evidenceId) => ({ state: "PRESENT", value, provenance: "EXTRACTED_LOCAL", evidence: [fragment(evidenceId)] });
  const supplier = { supplierCandidateId: "sc_0000000000000000", displayName: "Example Supplier", evidence: [fragment("ev_0000000000000000000")] };
  const record = {
    supplier: { state: "PRESENT", value: { supplierCandidateId: supplier.supplierCandidateId, displayName: supplier.displayName }, provenance: "EXTRACTED_LOCAL", evidence: supplier.evidence },
    invoiceNumber: present("INV-1", "ev_0000000000000000001"), invoiceDate: present("2026-01-01", "ev_0000000000000000002"),
    currency: present("USD", "ev_0000000000000000003"), taxableBase: present("10", "ev_0000000000000000004"),
    taxes: present("1", "ev_0000000000000000005"), total: present("11", "ev_0000000000000000006"),
    lineItems: [{ rowId: "g_0000000000000000", page: 1, ordinal: 0, description: present("Paper", "ev_0000000000000000007"), quantity: present("1", "ev_0000000000000000008"), unitPrice: present("10", "ev_0000000000000000009") }],
  };
  return {
    invoiceEvidenceSchemaVersion: "1", documentId: "AAAAAAAAAAAAAAAAAAAAAA", documentSha256: "a".repeat(64), extractionMode: "DIGITAL_TEXT",
    pageCount: 1, extractedCharacterCount: 10, iso4217Snapshot: { version: "ISO4217-2026-01-01", checksumSha256: "b".repeat(64) }, supplierCandidate: supplier,
    record, table: { columns: [{ columnId: "g_0000000000000001", identifier: "description", ordinal: 0 }, { columnId: "g_0000000000000002", identifier: "quantity", ordinal: 1 }, { columnId: "g_0000000000000003", identifier: "unitPrice", ordinal: 2 }], headerMarkers: [], repeatedHeaderSignature: { columnOrder: ["description", "quantity", "unitPrice"], repeatedHeaderPolicy: "ABSENT", headerRowCount: 1, continuationPageCount: 0 }, splitRowPolicy: "UNSUPPORTED" },
    confidenceBps: 9000, recordOutcome: "EXTRACTED_UNTRUSTED", reviewReasons: [], untrusted: true, vendor: null,
  };
}

test("enforces semantic safety beyond JSON Schema", () => {
  assertCode(() => validateSemantic({ confidenceBps: 9007199254740992 }), "semantic_invalid");
  assertCode(() => validateSemantic({ text: "\ud800" }), "semantic_invalid");
  const evidence = evidenceFixture();
  assert.equal(validateInvoiceEvidence(evidence), true);
  evidence.record.total.value = "12";
  assertCode(() => validateInvoiceEvidence(evidence), "semantic_invalid");
  const unsupportedCurrency = evidenceFixture();
  unsupportedCurrency.record.currency.value = "ZZZ";
  assertCode(() => validateInvoiceEvidence(unsupportedCurrency), "semantic_invalid");
});

test("validates projection references and exact array counts", () => {
  const projection = { projectionSchemaVersion: "1", tokens: [{ opaqueId: "t_0000000000000000", semanticClass: "label", page: 1, normalizedRect: { x: 0, y: 0, width: 100, height: 100 } }], groups: [{ groupId: "g_0000000000000000", kind: "ROW", page: 1, ordinal: 0 }], relationships: [], counts: { pageCount: 1, tokenCount: 1, groupCount: 1, relationshipCount: 0 } };
  assert.equal(validateProjection(projection), true);
  projection.counts.tokenCount = 2;
  assertCode(() => validateProjection(projection), "semantic_invalid");
});

test("reproduces RFC 8785 bytes and hashes through the production JCS wrapper", () => {
  assert.equal(canonicalizeJcs(1), "1");
  assert.equal(hashJcs(1), "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b");
  const canonical = canonicalizeJcs({ b: 2, a: 1 });
  assert.equal(canonical, '{"a":1,"b":2}');
  assert.equal(createHash("sha256").update(canonical, "utf8").digest("hex"), "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
});

test("uses typed bounded errors rather than weakening contract failures", () => {
  assert.throws(() => canonicalizeJcs(NaN), (error) => error instanceof ContractError && error.code === "semantic_invalid");
});
