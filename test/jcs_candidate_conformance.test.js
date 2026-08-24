import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

function sha256(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function captureError(action) {
  let throwCount = 0;
  let error;
  try {
    action();
  } catch (caught) {
    throwCount += 1;
    error = caught;
  }
  assert.equal(throwCount, 1);
  assert.ok(error instanceof Error);
  return error;
}

test("loads the ESM default export and canonicalizes strings", () => {
  assert.equal(typeof canonicalize, "function");
  assert.equal(canonicalize("hello"), '"hello"');
});

test("emits the scalar JCS golden bytes and hash", () => {
  const result = canonicalize(1);
  assert.equal(result, "1");
  assert.deepEqual([...Buffer.from(result, "utf8")], [0x31]);
  assert.equal(sha256(result), "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b");
});

test("recursively orders object keys with the object JCS golden hash", () => {
  const result = canonicalize({ b: 2, a: 1 });
  assert.equal(result, '{"a":1,"b":2}');
  assert.equal(sha256(result), "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
});

test("orders nested object keys without changing nested array order", () => {
  assert.equal(
    canonicalize({ outer: { z: 2, a: [{ b: 2, a: 1 }] }, a: true }),
    '{"a":true,"outer":{"a":[{"a":1,"b":2}],"z":2}}',
  );
});

test("orders keys by UTF-16 code units", () => {
  const supplementary = "\u{10000}";
  const bmp = "\uE000";
  assert.equal(
    canonicalize({ [bmp]: 1, [supplementary]: 2 }),
    `{"${supplementary}":2,"${bmp}":1}`,
  );
});

test("preserves arrays and emits control and UTF-8 strings exactly", () => {
  assert.equal(
    canonicalize(["é", "😀", "\u0000", "\n", { z: "✓", a: "ñ" }]),
    '["é","😀","\\u0000","\\n",{"a":"ñ","z":"✓"}]',
  );
});

test("formats negative zero, exponents, and safe-number boundaries", () => {
  assert.deepEqual(
    [-0, 1e-7, 1e-6, 1e20, 1e21, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER].map(canonicalize),
    ["0", "1e-7", "0.000001", "100000000000000000000", "1e+21", "9007199254740991", "-9007199254740991"],
  );
});

test("rejects NaN and infinities with Error instances and messages", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const error = captureError(() => canonicalize(value));
    assert.equal(error.constructor.name, "Error");
    assert.match(error.message, /finite|number|NaN|Infinity/i);
  }
});

test("rejects a lone surrogate with an Error instance and message", () => {
  const error = captureError(() => canonicalize("\uD800"));
  assert.equal(error.constructor.name, "Error");
  assert.match(error.message, /surrogate|unicode|string/i);
});

test("rejects circular references with an Error instance and message", () => {
  const value = {};
  value.self = value;
  const error = captureError(() => canonicalize(value));
  assert.equal(error.constructor.name, "Error");
  assert.match(error.message, /circular|cycle|recursive/i);
});
