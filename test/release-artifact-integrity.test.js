// WU-5C1-RED: Artifact integrity / provenance verification tests.
//
// Validates the release-artifact-manifest.yaml.template schema and proof
// path BEFORE the WU-5C1-GREEN pinning is filled in (sha256 values are TBD).
// These tests ensure the manifest supports verifiable integrity and no
// mutable-script-only installer, matching linux-release spec §60 (scenario 2).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Minimal YAML-ish parser for the manifest schema (no external dependency).
function parseManifest(text) {
  const doc = { artifacts: [] };
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\s*)([^\s:]+):\s*(.*)$/);
    if (!m) {
      // Handle "- name: value" list item (YAML flow for array of objects)
      const ml = line.match(/^(\s*)\- name:\s*(.*)$/);
      if (ml) {
        current = { name: ml[2], digest: {} };
        doc.artifacts.push(current);
      }
      continue;
    }
    const indent = m[1].length;
    const key = m[2];
    const val = m[3];
    if (indent === 0) {
      if (key === "artifacts") continue;
      doc[key] = parseScalar(val);
    } else if (current && indent >= 4) {
      if (key === "algorithm") {
        current.digest.algorithm = val;
      } else if (key === "value") {
        current.digest.value = val;
      } else if (key === "verification") {
        current.verification = val;
      } else if (key === "description") {
        current.description = val;
      }
    }
  }
  function parseScalar(v) {
    if (!v) return "";
    if (v === "true") return true;
    if (v === "false") return false;
    return v;
  }
  return doc;
}

// Tests live at repo-root/test/ → REPO_ROOT = repo root.
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(REPO_ROOT, "docs", "release-artifact-manifest.yaml.template");

test("WU-5C1-RED: manifest template exists with schema_version + verify fields", () => {
  const text = fs.readFileSync(MANIFEST, "utf8");
  assert.ok(/schema_version: 1\.0/.test(text), "manifest must declare schema_version");
  assert.ok(/verify_before_install: true/.test(text), "manifest must gate install on verification");
  assert.ok(/mutable_script_installer: false/.test(text), "must forbid mutable-script-only installer");
});

test("WU-5C1-RED: every artifact declares a sha256 digest (TBD allowed in RED)", () => {
  const text = fs.readFileSync(MANIFEST, "utf8");
  const doc = parseManifest(text);
  assert.ok(Array.isArray(doc.artifacts) && doc.artifacts.length >= 2,
    "manifest must declare at least 2 artifacts (binary + engine)");
  for (const art of doc.artifacts) {
    assert.ok(art.name, "each artifact must have a name");
    assert.ok(art.digest?.algorithm === "sha256",
      `artifact ${art.name} must use sha256`);
    // RED: value is TBD/TODO (not yet pinned). GREEN fills real hashes.
    assert.ok(["TBD", "TODO"].includes(art.digest?.value) || /^[0-9a-f]{64}$/.test(art.digest?.value),
      `artifact ${art.name} digest must be sha256 hex or TBD (RED)`);
  }
});

test("WU-5C1-RED: manifest includes nelupdf binary + engine-stdio.js", () => {
  const text = fs.readFileSync(MANIFEST, "utf8");
  assert.ok(/nelupdf-binary/.test(text), "manifest must declare the Rust binary artifact");
  assert.ok(/engine-stdio\.js/.test(text), "manifest must declare the Node sidecar artifact");
});

test("WU-5C1-RED: verification path is documented (sha256sum -c)", () => {
  const text = fs.readFileSync(MANIFEST, "utf8");
  // Each artifact must document a verification command.
  const verificationCount = (text.match(/verification: sha256sum -c/g) || []).length;
  assert.ok(verificationCount >= 2,
    "at least 2 artifacts must document sha256sum -c verification path");
});
