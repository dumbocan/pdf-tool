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

test("CLI --extract-path flag is fail-closed: exit 2 and unsafe_path_contract_removed_v1 on stderr", async () => {
  const { code, stderr } = await runCli(
    ["--extract-path", "/tmp/invoice.pdf"],
    { PDF_NO_PROMPT: "1" },
  );
  assert.equal(code, 2, "--extract-path must exit with code 2 (POSIX reserved for misuse)");
  assert.match(
    stderr,
    /unsafe_path_contract_removed_v1/,
    "stderr must announce the versioned migration envelope",
  );
});

test("CLI --extract-path=value form is also fail-closed", async () => {
  const { code, stderr } = await runCli(
    ["--extract-path=/tmp/another.pdf"],
    { PDF_NO_PROMPT: "1" },
  );
  assert.equal(code, 2);
  assert.match(stderr, /unsafe_path_contract_removed_v1/);
});

test("CLI extract-path subcommand is also fail-closed", async () => {
  const { code, stderr } = await runCli(
    ["extract-path", "/tmp/invoice.pdf"],
    { PDF_NO_PROMPT: "1" },
  );
  assert.equal(code, 2);
  assert.match(stderr, /unsafe_path_contract_removed_v1/);
});

test("CLI --extract-path never echoes the supplied path on stderr", async () => {
  // Defense in depth: even if the typed envelope leaked through, the
  // caller's path must not appear (otherwise arbitrary filesystem paths
  // would round-trip through error logs and process listings).
  const { code, stderr } = await runCli(
    ["--extract-path", "/etc/passwd-secret-needle-xyz"],
    { PDF_NO_PROMPT: "1" },
  );
  assert.equal(code, 2);
  assert.doesNotMatch(
    stderr,
    /passwd-secret-needle-xyz/,
    "the supplied path must never appear in stderr",
  );
});

test("CLI --extract-path rejects before any fs work even when the file does not exist", async () => {
  // If the guard ran after stat/readFile, a missing path would surface as
  // ENOENT or "no such file" — not the typed migration envelope. The
  // typed error is itself the proof that no fs access was attempted.
  const missing = `/tmp/pdf-tool-no-such-file-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`;
  const { code, stderr, stdout } = await runCli(
    ["--extract-path", missing],
    { PDF_NO_PROMPT: "1" },
  );
  assert.equal(code, 2);
  assert.match(stderr, /unsafe_path_contract_removed_v1/);
  assert.doesNotMatch(stderr, /ENOENT|no such file|cannot find/i);
  assert.doesNotMatch(stdout, /unsafe_path_contract_removed_v1/);
});