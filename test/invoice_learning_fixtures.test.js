import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = resolve(ROOT, "contracts/invoice-learning/v1/fixtures");
const FILES = ["valid", "invalid", "duplicate-keys", "jcs", "errors-and-idempotency"];
const load = (name) => JSON.parse(readFileSync(resolve(DIR, `${name}.json`), "utf8"));
const hash = (value) => createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

function assertVectors(name) {
  const fixture = load(name);
  assert.deepEqual(Object.keys(fixture), ["fixtureSetSchemaVersion", "vectors"]);
  assert.equal(fixture.fixtureSetSchemaVersion, "1");
  assert.ok(fixture.vectors.length > 0, `${name} must contain vectors`);
  for (const vector of fixture.vectors) {
    assert.match(vector.id, /^[a-z0-9.-]+$/);
    assert.match(vector.dto, /^[A-Za-z][A-Za-z0-9]{2,63}$/);
    assert.ok(["ACCEPT", "REJECT"].includes(vector.expected));
    assert.equal(typeof vector.state, "string");
    assert.equal(typeof vector.bytes, "string");
    assert.equal(vector.bytesSha256, hash(vector.bytes));
    assert.equal(new Set(fixture.vectors.map(({ id }) => id)).size, fixture.vectors.length);
  }
  return fixture.vectors;
}

test("all B2a fixture vectors are stable, bounded, and hashable", () => {
  const vectors = FILES.flatMap(assertVectors);
  assert.equal(new Set(vectors.map(({ id }) => id)).size, vectors.length);
  assert.ok(vectors.every(({ id }) => id.length <= 99));
});

test("valid vectors preserve accepted shapes, versions, and exact states", () => {
  const vectors = assertVectors("valid");
  assert.ok(vectors.every((v) => v.expected === "ACCEPT"));
  assert.deepEqual(vectors.map((v) => v.state), [
    "EXTRACTED_UNTRUSTED", "TEMPLATE_APPROVED", "PROPOSAL_SUGGESTED",
  ]);
  assert.deepEqual(vectors.map((v) => v.version), ["1", "1", "1"]);
});

test("invalid vectors reject missing reasons, versions, unsafe numbers, and Unicode", () => {
  const vectors = assertVectors("invalid");
  assert.ok(vectors.every((v) => v.expected === "REJECT"));
  assert.deepEqual(vectors.map((v) => v.errorCode), [
    "evidence_missing", "protocol_mismatch", "semantic_invalid", "semantic_invalid",
  ]);
  assert.deepEqual(vectors.map((v) => v.reason), [
    "EVIDENCE_MISSING", "PROTOCOL_MISMATCH", "UNSAFE_NUMBER", "INVALID_UNICODE",
  ]);
});

test("duplicate-key vectors retain raw escaped-key bytes and reject collisions", () => {
  const vectors = assertVectors("duplicate-keys");
  assert.ok(vectors.filter((v) => v.scope !== "SEPARATE_OBJECTS").every((v) => v.expected === "REJECT" && v.errorCode === "schema_invalid"));
  assert.equal(vectors.find((v) => v.scope === "SEPARATE_OBJECTS").expected, "ACCEPT");
  assert.ok(vectors.some((v) => v.kind === "ESCAPED_EQUIVALENT"));
  assert.ok(vectors.some((v) => v.bytes.includes("\\u0061")));
});

test("JCS vectors reproduce RFC 8785 bytes and SHA-256 digests", () => {
  const vectors = assertVectors("jcs");
  assert.deepEqual(vectors.map((v) => [v.input, v.canonicalUtf8, v.bytesSha256]), [
    ["1", "1", "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"],
    ["{\"b\":2,\"a\":1}", "{\"a\":1,\"b\":2}", "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"],
  ]);
});

test("error and idempotency vectors preserve exact terminal outcomes", () => {
  const vectors = assertVectors("errors-and-idempotency");
  assert.deepEqual(vectors.map((v) => [v.errorCode, v.state]), [
    ["protocol_mismatch", "PROTOCOL_MISMATCH"],
    ["transaction_consumed", "EXHAUSTED"],
    ["persistence_failure", "FAILURE"],
    [null, "NOOP"],
  ]);
  const noop = vectors.find((v) => v.state === "NOOP");
  assert.equal(noop.operationKind, "FIRST_COMPLETION");
  assert.equal(noop.outcome, "NOOP");
});
