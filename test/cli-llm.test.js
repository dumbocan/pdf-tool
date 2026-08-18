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
