import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const CONTRACT = resolve(ROOT, "contracts/invoice-learning/v1");
const OPS = [
  "extractInvoiceV1", "replayTemplateV1", "renderPageV1",
  "proposalPrepareV1", "proposalSubmitV1", "proposalCancelV1",
];
const load = (name) => JSON.parse(readFileSync(resolve(CONTRACT, name), "utf8"));

 test("B1b registers the six closed operation envelopes", () => {
  const schema = load("operations.schema.json");
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.$defs.OperationKindV1.enum, OPS);
  assert.equal(schema.$defs.OperationRequestV1.oneOf.length, OPS.length);
  assert.equal(schema.$defs.OperationResponseV1.oneOf.length, OPS.length + 1);
  for (const kind of OPS) {
    const name = kind[0].toUpperCase() + kind.slice(1, -2) + "RequestV1";
    assert.ok(schema.$defs[name], `${name} is registered`);
  }
});

test("B1b carries the exact proposal response version", () => {
  const defs = load("operations.schema.json").$defs;
  for (const name of ["ProposalPrepareRequestV1", "ProposalSubmitRequestV1", "ProposalCancelRequestV1"]) {
    assert.equal(defs[name].properties.proposalResponseSchemaVersion.const, "1");
  }
  assert.equal(defs.NegotiateSuccessV1.properties.proposalResponseSchemaVersion.const, "1");
});

test("B1b resolves every schema alias exactly once", () => {
  const manifest = load("manifest.json");
  const aliases = manifest.aliases;
  assert.equal(new Set(aliases.map(({ alias }) => alias)).size, aliases.length);
  for (const name of ["invoice-learning.schema.json", "template.schema.json", "proposal.schema.json"]) {
    for (const alias of Object.keys(load(name).$defs)) {
      assert.equal(aliases.filter((entry) => entry.alias === alias).length, 1, alias);
    }
  }
  assert.deepEqual(manifest.operations.map(({ kind }) => kind), OPS);
  for (const entry of manifest.schemas) {
    assert.equal(createHash("sha256").update(readFileSync(resolve(CONTRACT, entry.path))).digest("hex"), entry.sha256);
  }
  assert.match(manifest.contractDigest, /^[0-9a-f]{64}$/);
  const { contractDigest, ...digestInput } = manifest;
  assert.equal(createHash("sha256").update(canonicalize(digestInput)).digest("hex"), contractDigest);
});
