import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CLI = fileURLToPath(new URL("../bin/pdf-tool.mjs", import.meta.url));

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("CLI --llm flag is fail-closed: non-zero exit and provider_disabled message on stderr", async () => {
  const { code, stderr } = await runCli(["facturas", "ignored", "--llm"], {
    PDF_RENAME: "1",
    PDF_NO_PROMPT: "1",
  });
  assert.notEqual(code, 0, "--llm must exit non-zero");
  assert.match(
    stderr,
    /LLM preview is disabled/,
    "stderr must announce the disabled preview",
  );
});

test("CLI --llm flag stays fail-closed even when MINIMAX_API_KEY is set", async () => {
  const { code, stderr } = await runCli(
    ["facturas", "ignored", "--llm"],
    { PDF_RENAME: "1", MINIMAX_API_KEY: "test-key" },
  );
  assert.notEqual(code, 0);
  assert.match(stderr, /LLM preview is disabled/);
});

// WU-3D1: the CLI --llm flag must wire through PrivacyTransactionService.prepare().
// We can't intercept imports in the spawned subprocess, so we monkey-patch
// the privacy-service module export the CLI imports before it spawns. The
// MONKEY_PATCH_PREPARE env var asks the loader shim (added below) to swap
// the export; the test then runs the CLI and verifies both the wiring and
// the fail-closed exit.
test("CLI --llm flag wires through PrivacyTransactionService.prepare() before exiting", async () => {
  const { code, stderr } = await runCli(["facturas", "ignored", "--llm"], {
    PDF_RENAME: "1",
    PDF_TOOL_LLM_WIRE_PROBE: "1",
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /LLM preview is disabled/);
  // The probe writes one JSON line to stderr that records the prepare args.
  const probeLine = stderr
    .split("\n")
    .find((line) => line.startsWith("[llm-wire-probe]"));
  assert.ok(probeLine, "probe line must be emitted when wire probe is on");
  const probe = JSON.parse(probeLine.slice("[llm-wire-probe]".length).trim());
  assert.equal(probe.calls, 1);
  assert.equal(probe.args.providerId, "minimax");
  assert.equal(probe.args.modelId, "MiniMax-M3");
  assert.equal(probe.args.purpose, "extract_invoice");
  assert.equal(probe.args.disclosureVersion, "v1");
  assert.equal(probe.args.transformedPolicyVersion, "pseudonymize-v1");
  assert.equal(typeof probe.args.documentId, "string");
  assert.equal(probe.args.documentId.length, 22);
});
