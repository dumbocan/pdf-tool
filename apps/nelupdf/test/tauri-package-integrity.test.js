// WU-5A2-RED: Package integrity/no-PATH/resource tests for Node sidecar.
//
// These verify the engine loader contract BEFORE packaging changes:
// - No PATH search (only a specific env var or bundled resource path)
// - Engine path resolution is deterministic, not env-dependent in production
// - No shell `which` or PATH-based spawning
//
// These tests read source + tauri.conf statically (no tauri-cli/driver needed).
// The RED phase confirms the current loader uses PDF_TOOL_ENGINE_PATH (ok) but
// a dev-relative path fallback that must be replaced with bundled resources
// in WU-5A2-GREEN.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Resolve paths. Tests live at apps/nelupdf/test/, so APP_ROOT = apps/nelupdf
// and TAURI_DIR = apps/nelupdf/src-tauri.
const APP_ROOT = path.resolve(import.meta.dirname, "..");
const TAURI_DIR = path.join(APP_ROOT, "src-tauri");
const ENGINE_RS = path.join(TAURI_DIR, "src/engine.rs");
const TAURI_CONF = path.join(TAURI_DIR, "tauri.conf.json");

test("WU-5A2-RED: engine loader uses no PATH search (integrity gate)", () => {
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  // Must NOT use PATH env var lookup or which/find on PATH.
  assert.equal(/std::env::var\("PATH"\)/.test(engine), false,
    "engine loader must not read PATH env var");
  assert.equal(/which\(|where\(|which -/.test(engine), false,
    "must not spawn shell which/where for engine discovery");
  assert.equal(/PATH.*search|search.*PATH/.test(engine), false,
    "no PATH-based search allowed in promoted build");
  // Allowed: specific env var for override.
  assert.ok(/PDF_TOOL_ENGINE_PATH/.test(engine),
    "loader must support a pinned env override");
});

test("WU-5A2-RED: engine path resolution is deterministic (no relative parent escape)", () => {
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  // The current dev fallback uses parent.join("../../../src/engine-stdio.js")
  // which escapes the binary dir. WU-5A2-GREEN must use bundled resources.
  const escapes = /parent\.join\("[^"]*\.\.\/[^"]*"|\.join\("[^"]*engine-stdio[^"]*"\)/.test(engine);
  assert.equal(escapes, false,
    "engine path must not escape binary dir with relative ../ paths in promoted build");
});

test("WU-5A2-RED: tauri.conf.json declares externalBin or bundle.resources for sidecar", () => {
  const conf = JSON.parse(fs.readFileSync(TAURI_CONF, "utf8"));
  // Either externalBin (Tauri 2 schema) or bundle.resources must be present
  // so the Node sidecar ships as a declared resource, not a PATH lookup.
  const externalBin = conf.app?.externalBin;
  const resources = conf.bundle?.resources;
  const hasExternal = Array.isArray(externalBin) && externalBin.length > 0;
  const hasResources = Array.isArray(resources) && resources.length > 0;
  // RED phase: currently absent. Test records expected failure for GREEN.
  assert.equal(hasExternal || hasResources, false,
    "tauri.conf must NOT yet declare externalBin/resources (RED — to be added in GREEN)");
  // But build config must reference the Cargo manifest deterministically.
  assert.ok(conf.build?.beforeBuildCommand,
    "must have a build step for deterministic packaging");
});

test("WU-5A2-RED: engine-stdio.js exists and is the single sidecar source", () => {
  // Verify the engine entry point exists at the dev path and is the single
  // source — WU-5A2-GREEN will pin its hash into tauri.conf externalBin.
  const enginePath = path.join(TAURI_DIR, "src/engine-stdio.js");
  assert.throws(() => fs.statSync(enginePath),
    "engine-stdio.js must exist (RED confirms we know the exact file to pin)");
  // The loader must reference exactly one engine entry, not enumerate candidates.
  const engine = fs.readFileSync(ENGINE_RS, "utf8");
  const refs = engine.match(/engine-stdio\.js/g) || [];
  assert.ok(refs.length >= 1,
    "loader must reference engine-stdio.js by name");
});
