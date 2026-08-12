import { test } from "node:test";
import assert from "node:assert/strict";
import { safeString, escapeRe } from "../src/parser-generator.js";

test("safeString strips control chars and collapses whitespace", () => {
  assert.equal(safeString("Hola\nMundo\u0000"), "Hola Mundo");
  assert.equal(safeString("a   b\tc"), "a b c");
  assert.equal(safeString(undefined), "");
});

test("escapeRe escapes regex metacharacters and the slash delimiter", () => {
  assert.equal(escapeRe("a/b(c)d"), "a\\/b\\(c\\)d");
  assert.equal(escapeRe("A.C*"), "A\\.C\\*");
  // no newlines or control chars can survive into a generated /.../i literal
  assert.ok(!/[\n\x00-\x1f]/.test(escapeRe("x\ny\u0007")));
});
