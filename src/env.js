// Shared environment loading for pdf-tool.
// Precedence: process.env wins (explicit shell/container vars override the
// .env file); the .env file fills any gaps. This is the standard dotenv
// behavior and keeps the CLI, folder-scan, server and Docker consistent.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env",
);

export function loadEnvFile(envPath = DEFAULT_ENV_PATH) {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !out[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function envWithFile(envPath = DEFAULT_ENV_PATH) {
  return { ...loadEnvFile(envPath), ...process.env };
}
