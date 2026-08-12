#!/usr/bin/env node
// Generate a per-vendor invoice parser from a real invoice PDF.
//
// Usage:
//   node scripts/generate-vendor-parser.mjs <invoice.pdf> [--name <slug>] [--dry-run]
//
// Flow (shared with the web UI via src/parser-generator.js):
//   text -> LLM layout analysis -> sanitized codegen -> write into the working
//   tree (vendor-parsers.js + fixture + test) -> self-validation + vendor suite.
//
// This script NEVER commits: the generated parser lands in the working tree for
// review before it ships. Requires LLM_API_KEY (run: pdf-tool config).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateParser } from "../src/parser-generator.js";

const args = process.argv.slice(2);
const pdfPath = args.find((a) => !a.startsWith("--"));
const nameIdx = args.indexOf("--name");
const nameFlag =
  args.find((a) => a.startsWith("--name="))?.split("=")[1] ??
  (nameIdx >= 0 ? args[nameIdx + 1] : undefined);
const dryRun = args.includes("--dry-run");
if (!pdfPath) {
  console.error("Usage: node scripts/generate-vendor-parser.mjs <invoice.pdf> [--name <slug>] [--dry-run]");
  process.exit(2);
}

const buffer = await readFile(pdfPath);
const result = await generateParser({
  buffer,
  filename: path.basename(pdfPath),
  name: nameFlag,
  dryRun,
});

if (result.error) {
  console.error(result.error);
  process.exit(2);
}

console.log("=== Pattern analysis ===");
console.log(JSON.stringify(result.patterns, null, 1).slice(0, 1200));
console.log("\n=== Generated parser (self-validation) ===");
console.log(
  "invoiceNumber:", result.fields.invoiceNumber ?? "MISS",
  "| date:", result.fields.invoiceDate ?? "MISS",
  "| totals:", JSON.stringify(result.fields.totals ?? null),
);

if (dryRun) {
  console.log("\n=== Generated source (dry-run, not written) ===");
  console.log(result.source);
  console.log("\n--- PARSERS entry ---");
  console.log(`  ${result.slug}: parse${result.slug[0].toUpperCase()}${result.slug.slice(1)},`);
  process.exit(0);
}

console.log("\n=== Validation ===");
console.log(result.validation);
if (result.validationFailed) process.exit(1);
