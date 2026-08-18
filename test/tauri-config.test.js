// WU-1G1-TRIANGULATE / WU-5A1-TRIANGULATE: source-level verification tests
// for production CSP, capability inventory, and removed opener plugin.
//
// These tests run on plain Node — no Tauri driver required — and assert on
// the serialized configuration so a regression that re-introduces network
// or opener access is caught in CI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const TAURI_CONF = path.join(ROOT, "apps/nelupdf/src-tauri/tauri.conf.json");
const TAURI_CAP = path.join(ROOT, "apps/nelupdf/src-tauri/capabilities/default.json");
const CARGO_TOML = path.join(ROOT, "apps/nelupdf/src-tauri/Cargo.toml");
const LIB_RS = path.join(ROOT, "apps/nelupdf/src-tauri/src/lib.rs");
const APP_TSX = path.join(ROOT, "apps/nelupdf/src/App.tsx");

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function readJson(p) {
  return JSON.parse(readText(p));
}

test("tauri.conf.json: CSP is defined and restrictive (no general network)", () => {
  const conf = readJson(TAURI_CONF);
  const csp = conf.app?.security?.csp;
  assert.ok(csp, "csp must be defined (not null)");
  // No HTTP/HTTPS sources — production CSP must not allow network.
  assert.equal(csp.match(/https?:/g), null, "CSP must not contain http:/https: sources");
  assert.equal(csp.match(/'unsafe-eval'/g), null, "CSP must not allow unsafe-eval");
  assert.ok(csp.includes("default-src 'none'"), "CSP should start with default-src 'none'");
  assert.ok(csp.includes("object-src 'none'"), "CSP must block object/embed");
  // Script must only come from 'self' — no 'unsafe-inline'.
  const scriptMatch = csp.match(/script-src([^;]*)/);
  assert.ok(scriptMatch, "CSP must define script-src");
  assert.ok(!scriptMatch[1].includes("'unsafe-inline'"), "scripts must not be inline");
  // Styles may use 'unsafe-inline' (Tailwind) but scopes are bounded.
  assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"), "styles need unsafe-inline for Tailwind");
  // Connect must not allow external network (only self + localhost for dev HMR).
  const connectMatch = csp.match(/connect-src([^;]*)/);
  assert.ok(connectMatch, "CSP must define connect-src");
  assert.ok(!connectMatch[1].includes("http:"), "connect-src must not allow http:");
  assert.ok(!connectMatch[1].includes("https:"), "connect-src must not allow https:");
});

test("tauri.conf.json: capabilities only permit core:default (no opener)", () => {
  const caps = readJson(TAURI_CAP);
  const perms = caps.permissions || [];
  assert.ok(perms.includes("core:default"), "must include core:default");
  assert.equal(perms.includes("opener:default"), false, "opener:default must be removed");
  assert.equal(perms.length, 1, "only core:default permission should be granted");
});

test("Cargo.toml: tauri-plugin-opener dependency is absent", () => {
  const cargo = readText(CARGO_TOML);
  assert.equal(/tauri-plugin-opener/.test(cargo), false, "opener plugin must not be a dependency");
});

test("lib.rs: opener plugin init is not registered", () => {
  const lib = readText(LIB_RS);
  assert.equal(/tauri_plugin_opener/.test(lib), false, "opener plugin must not be initialized");
  assert.equal(/plugin\(/.test(lib), false, "no plugin registration calls");
});

test("App.tsx: no retired HTTP transport surfaces", () => {
  const app = readText(APP_TSX);
  assert.equal(/fetch\(/.test(app), false, "must not use fetch()");
  assert.equal(/VITE_MOTOR_URL/.test(app), false, "must not reference VITE_MOTOR_URL");
  assert.equal(/127\.0\.0\.1:3000/.test(app), false, "must not reference loopback motor URL");
  assert.equal(/extract-path/.test(app), false, "native path forwarding must be disabled");
});
