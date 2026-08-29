import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProposalProjection,
  projectionHashInput,
  hashProjection,
  geometryBucket,
  buildLayoutStructureProjection,
  hashLayoutStructure,
  proposalScopeKey,
  buildPreparedBindingInput,
  hashPreparedBinding,
  buildProposalDisclosure,
} from "../src/proposal-session.js";
import { canonicalizeJcs, canonicalizeJcsBytes, hashJcs } from "../src/jcs.js";

const key = `sup_${"a".repeat(32)}`;
const ids = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}_${i.toString(16).padStart(16, "0")}`);
const tokens = ids("t", 6).map((opaqueId, i) => ({ opaqueId, semanticClass: i === 0 ? "label" : "other-opaque", page: i > 3 ? 2 : 1, normalizedRect: { x: i * 100, y: 0, width: 90, height: 90 } }));
const [row, repeated, description, quantity] = ids("g", 4);
const groups = [row, repeated].map((groupId, i) => ({ groupId, kind: "ROW", page: i + 1, ordinal: 0 })).concat([
  { groupId: description, kind: "COLUMN", page: 1, ordinal: 1 },
  { groupId: quantity, kind: "COLUMN", page: 1, ordinal: 2 },
]);
const relationships = [
  { kind: "ROW_MEMBER", rowId: row, tokenId: tokens[0].opaqueId, ordinal: 0 },
  { kind: "COLUMN_MEMBER", columnId: description, tokenId: tokens[1].opaqueId, ordinal: 0 },
  { kind: "HEADER_FOR_COLUMN", headerTokenId: tokens[2].opaqueId, columnId: quantity },
  { kind: "LABEL_FOR_VALUE", labelTokenId: tokens[0].opaqueId, valueTokenId: tokens[1].opaqueId },
  { kind: "NEXT_IN_READING_ORDER", fromTokenId: tokens[0].opaqueId, toTokenId: tokens[1].opaqueId },
  { kind: "REPEATED_HEADER_OF", repeatedRowId: repeated, canonicalRowId: row },
];
const projection = { projectionSchemaVersion: "1", tokens, groups, relationships, counts: { pageCount: 2, tokenCount: 6, groupCount: 4, relationshipCount: 6 } };

function proposalInput(extra = {}) {
  return { transactionId: `tx_${"b".repeat(32)}`, documentId: "A".repeat(22), matchingKey: key, providerId: "provider", modelId: "model", policyVersion: "policy-1", disclosureVersion: "disclosure-1", expiresAt: "2026-01-01T00:00:00.000Z", projection, ...extra };
}

test("builds a closed value-free projection with all six relation variants", () => {
  const result = buildProposalProjection(proposalInput());
  assert.deepEqual(Object.keys(result), ["projectionSchemaVersion", "templateSchemaVersion", "proposalResponseSchemaVersion", "purpose", "transactionId", "documentId", "projectionSha256", "matchingKey", "providerId", "modelId", "policyVersion", "disclosureVersion", "expiresAt", "tokens", "groups", "relationships", "counts"]);
  assert.equal(result.templateSchemaVersion, "1");
  assert.equal(result.relationships.length, 6);
  assert.equal(Object.hasOwn(result, "rawText"), false);
  assert.equal(result.projectionSha256, hashProjection(projection));
  assert.equal(projectionHashInput(result).projectionSha256, undefined);
});

test("uses exact JCS bytes, preserves array order, and hashes the closed input", () => {
  assert.equal(canonicalizeJcs(1), "1");
  assert.deepEqual(canonicalizeJcsBytes({ b: 2, a: 1 }), Buffer.from('{"a":1,"b":2}'));
  assert.equal(hashJcs({ b: 2, a: 1 }), "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
  const reordered = structuredClone(projection); reordered.tokens.reverse();
  assert.notEqual(hashProjection(projection), hashProjection(reordered));
  assert.throws(() => buildProposalProjection({ ...proposalInput(), rawText: "must not cross" }), /UNKNOWN_FIELD/);
  assert.throws(() => buildProposalProjection({ ...proposalInput(), unexpected: true }), /UNKNOWN_FIELD/);
});

test("rejects unsafe references, duplicate edges, cycles, and wrong repeated-row order", () => {
  const badReference = structuredClone(projection); badReference.relationships[0].tokenId = "t_ffffffffffffffff";
  assert.throws(() => hashProjection(badReference), /MISSING_RELATIONSHIP_REFERENCE/);
  const duplicate = structuredClone(projection); duplicate.relationships.push({ ...duplicate.relationships[0] }); duplicate.counts.relationshipCount++;
  assert.throws(() => hashProjection(duplicate), /DUPLICATE_RELATIONSHIP/);
  const cycle = structuredClone(projection); cycle.relationships.splice(4, 1, { kind: "NEXT_IN_READING_ORDER", fromTokenId: tokens[0].opaqueId, toTokenId: tokens[1].opaqueId }, { kind: "NEXT_IN_READING_ORDER", fromTokenId: tokens[1].opaqueId, toTokenId: tokens[0].opaqueId }); cycle.counts.relationshipCount++;
  assert.throws(() => hashProjection(cycle), /RELATIONSHIP_CYCLE/);
  const wrongOrder = structuredClone(projection); wrongOrder.relationships[5] = { kind: "REPEATED_HEADER_OF", repeatedRowId: row, canonicalRowId: repeated };
  assert.throws(() => hashProjection(wrongOrder), /REPEATED_HEADER_ORDER/);
});

test("rejects invalid timestamp, layout, and consent bindings without normalization", () => {
  assert.throws(() => buildProposalProjection(proposalInput({ expiresAt: "2026-99-99T00:00:00.000Z" })), /INVALID_TIMESTAMP/);
  assert.throws(() => geometryBucket({ x: 0, y: 0, width: 1, height: 1 }, "raw"), /INVALID_GEOMETRY_ROLE/);
  assert.throws(() => buildPreparedBindingInput({ transactionId: proposalInput().transactionId, documentSha256: "c".repeat(64), projectionSha256: "d".repeat(64), matchingKey: key, proposalScopeKey: "e".repeat(64), providerId: "provider", modelId: "model", policyVersion: "policy-1", disclosureVersion: "disclosure-1", expiresAt: proposalInput().expiresAt, consentActionId: "ACT_" + "a".repeat(32) }), /INVALID_CONSENT_ACTION/);
});

test("binds layout scope and prepared content/purpose inputs with closed disclosure", () => {
  const layout = buildLayoutStructureProjection({
    fieldLabelGeometryBuckets: ["FIELD_LABEL", "FIELD_LABEL", "FIELD_LABEL", "FIELD_LABEL", "FIELD_LABEL", "FIELD_LABEL", "FIELD_LABEL"].map((role, i) => ({ role, x: i, y: 2, width: 3, height: 4 })),
    tableColumnGeometryBuckets: ["TABLE_HEADER", "TABLE_HEADER", "TABLE_BOUNDARY"].map((role) => ({ role, x: 1, y: 2, width: 3, height: 4 })),
    fieldLabelPageRelations: Array(7).fill("FIRST_PAGE"), tableColumnPageRelations: Array(3).fill("FIRST_PAGE"),
    repeatedHeaderSignature: { repeatedHeaderPolicy: "REQUIRED" },
  });
  assert.deepEqual(geometryBucket({ x: 100, y: 9999, width: 100, height: 1 }, "FIELD_LABEL"), { role: "FIELD_LABEL", x: 1, y: 99, width: 1, height: 0 });
  const layoutHash = hashLayoutStructure(layout);
  const scope = proposalScopeKey({ matchingKey: key, layoutStructureHash: layoutHash });
  const binding = buildPreparedBindingInput({ transactionId: proposalInput().transactionId, documentSha256: "c".repeat(64), projectionSha256: hashProjection(projection), matchingKey: key, proposalScopeKey: scope, providerId: "provider", modelId: "model", policyVersion: "policy-1", disclosureVersion: "disclosure-1", expiresAt: proposalInput().expiresAt, consentActionId: null });
  assert.equal(binding.consentActionId, null);
  assert.match(hashPreparedBinding(binding), /^[0-9a-f]{64}$/);
  assert.deepEqual(buildProposalDisclosure({ providerId: "provider", modelId: "model", policyVersion: "policy-1", disclosureVersion: "disclosure-1", expiresAt: proposalInput().expiresAt }).allowedCategories, ["OPAQUE_MATCHING_KEY", "TOKEN_CLASSES", "NORMALIZED_GEOMETRY", "ROW_COLUMN_STRUCTURE"]);
});
