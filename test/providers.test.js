import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, providerById } from "../src/providers.js";

test("provider catalog is well-formed", () => {
  const ids = new Set();
  for (const p of PROVIDERS) {
    assert.ok(p.id, "id present");
    assert.ok(!ids.has(p.id), `unique id: ${p.id}`);
    ids.add(p.id);
    assert.ok(p.name, "name present");
    assert.ok(p.tagline, "tagline present");
    assert.equal(typeof p.needsKey, "boolean", `${p.id} needsKey`);
    // every provider except "custom" ships a concrete baseUrl + a model pick-list,
    // so a non-engineer can configure it with just a key
    if (p.id !== "custom") {
      assert.ok(p.baseUrl.startsWith("http"), `${p.id} baseUrl`);
      assert.ok(Array.isArray(p.models) && p.models.length > 0 && p.models[0], `${p.id} models`);
      assert.equal(new Set(p.models).size, p.models.length, `${p.id} unique models`);
    }
  }
});

test("providerById resolves known providers and rejects unknown", () => {
  assert.equal(providerById("minimax").name, "MiniMax");
  assert.ok(providerById("ollama"));
  assert.equal(providerById("does-not-exist"), null);
});
