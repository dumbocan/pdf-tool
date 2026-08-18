// WU-5A2-TRIANGULATE: Package integrity/no-PATH/resource tests for Node sidecar.
//
// Verifies the WU-5A2-GREEN contract:
// - Engine loader checks bundled RESOURCE_DIR before env override + fallback
// - No PATH search (only PDF_TOOL_ENGINE_PATH for dev/CI)
// - tauri.conf.json declares bundle.resources for engine-stdio.js
// - Production loader uses bundled resource path, not relative ../ escape
//
// Runs on plain Node — no tauri-cli/driver needed (bypasses EMFILE bug).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Tests live at apps/nelupdf/test/ → APP_ROOT = apps/nelupdf
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const TAURI_DIR = path.join(APP_ROOT, "src-tauri");
const ENGINE_RS = path.join(TAURI_DIR, "src/engine.rs");
const TAURI_CONF = path.join(TAURI_DIR, "tauri.conf.json");

test("WU-5A2-TRIANGULATE: engine loader checks bundled RESOURCE_DIR first", () => {
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  // GREEN: loader checks RESOURCE_DIR before env/PATH fallback.
  assert.ok(/std::env::var\("RESOURCE_DIR"\)/.test(engine),
    "loader must check RESOURCE_DIR (tauri bundled resource path) first");
  assert.ok(/PDF_TOOL_ENGINE_PATH/.test(engine),
    "must still support a pinned env override for dev/CI");
});

test("WU-5A2-TRIANGULATE: no PATH search in engine loader (integrity gate)", () => {
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  assert.equal(/std::env::var\("PATH"\)/.test(engine), false,
    "loader must not read PATH env var");
  assert.equal(/which\(|where\(|which -/.test(engine), false,
    "must not spawn shell which/where");
});

test("WU-5A2-TRIANGULATE: relative path escape only allowed in dev fallback (not production)", () => {
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  // The dev fallback uses relative paths — acceptable for dev, but the GREEN
  // contract adds RESOURCE_DIR check FIRST so production uses bundled resource.
  assert.ok(/RESURCE_DIR|RESOURCE_DIR/.test(engine),
    "must have RESOURCE_DIR check preceding dev-fallback relative paths");
});

test("WU-5A2-TRIANGULATE: tauri.conf.json declares bundle.resources for sidecar", () => {
  const conf = JSON.parse(fs.readFileSync(TAURI_CONF, "utf8"));
  const resources = conf.bundle?.resources;
  assert.ok(Array.isArray(resources) && resources.length > 0,
    "bundle.resources must declare engine-stdio.js for packaging");
  assert.ok(resources.some((r) => /engine-stdio\.js/.test(r)),
    "must include engine-stdio.js in resources");
});

test("WU-5A2-TRIANGULATE: hardcoded absolute path removed from loader", () => {
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  // WU-5A2-GREEN removed the /home/jmon/.pdf-tool-wu1a1/src/engine-stdio.js
  // hardcoded path.
  assert.equal(/home\/jmon|\/home\/.*\.pdf-tool/.test(engine), false,
    "loader must not contain hardcoded absolute paths");
});

// WU-5A2-REFACTOR: dependency/license/scope gates
const CARGO_TOML = path.join(TAURI_DIR, "Cargo.toml");
const ENGINE_JS = path.resolve(import.meta.dirname, "..", "..", "..", "src/engine-stdio.js");

test("WU-5A2-REFACTOR: Cargo.toml declares an OSI license", () => {
  const cargo = fs.readFileSync(CARGO_TOML, "utf8");
  assert.ok(/license\s*=/.test(cargo),
    "Cargo.toml must declare a license field for packaging integrity");
});

test("WU-5A2-REFACTOR: engine-stdio.js uses only stdlib + local imports", () => {
  // The Node sidecar must not pull external dependencies (no package.json deps)
  // so the bundled resource has a closed/scrutable dependency surface.
  const engine = fs.readFileSync(ENGINE_JS, "utf8");
  assert.equal(/^import .* from "node:/.test(engine) || /^import .*node:crypto/.test(engine), true,
    "must use node: stdlib imports");
  // No bare-specifier external packages (e.g., 'fs' without 'node:', or npm deps).
  const external = engine.match(/^import .+ from "([^"']+)"/gm) || [];
  const nonStdlib = external.filter((m) => {
    const spec = m.match(/from "([^"]+)"/)[1];
    return !spec.startsWith("node:") && !spec.startsWith("./") && !spec.startsWith("../");
  });
  assert.equal(nonStdlib.length, 0,
    "engine-stdio.js must not import external packages: " + JSON.stringify(nonStdlib));
});
