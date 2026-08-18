#!/usr/bin/env node
// pdf-tool — friendly CLI for processing invoice PDFs from a folder.
// UI strings are Spanish because the target user is a non-engineer Spanish
// speaker (the tool is meant to be approachable, like the OpenClaw installer).
//
// Commands:
//   pdf-tool facturas <carpeta> [--ocr] [--out salida.csv]
//   pdf-tool version
//   pdf-tool ayuda

import { writeFile, appendFile, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { scanFolder, listPdfFiles } from "../src/folder-scan.js";
import { PROVIDERS } from "../src/providers.js";
import { t } from "../src/i18n.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "0.0.0";

function csvCell(value) {
  let s = value == null ? "" : String(value);
  // Neutralize spreadsheet formula injection (CWE-1236): a leading = + - @
  // would be evaluated by Excel/LibreOffice when the CSV is opened.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvFromRows(rows) {
  // DB-ready format: ONE row per article (line item), with the invoice context
  // repeated. Invoices without parsed articles still get one row (empty article
  // columns) so nothing is lost. A script can load this directly into a DB.
  const header = [
    "archivo", "proveedor", "numero_factura", "fecha",
    "subtotal", "impuesto", "total", "impuesto_label",
    "articulo", "cantidad", "precio_unitario", "importe_articulo", "impuesto_articulo",
  ].join(",");
  const lines = [];
  for (const r of rows) {
    const ctx = [r.file, r.vendor, r.invoiceNumber, r.invoiceDate, r.subtotal, r.tax, r.total, r.taxLabel];
    const articles = Array.isArray(r.articles) && r.articles.length ? r.articles : [null];
    for (const a of articles) {
      lines.push(
        [...ctx, a ? a.description : "", a ? a.units : "", a ? a.unit_price : "", a ? a.amount : "", a ? a.tax_rate : ""]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return header + "\n" + lines.join("\n") + "\n";
}

function friendlySummary(rows, folder) {
  const total = rows.length;
  const ok = rows.filter((r) => r.invoiceNumber || r.total).length;
  const scanned = rows.filter((r) => r.textChars === 0).length;
  const errores = rows.filter((r) => r.error).length;
  const vendors = [...new Set(rows.map((r) => r.vendor).filter(Boolean))];
  const lines = [
    "",
    t("done_summary", { folder }),
    "",
    t("invoices_processed", { n: total }),
    t("with_data", { n: ok }),
    scanned > 0 ? t("scanned_hint", { n: scanned }) : "",
    errores > 0 ? t("with_errors", { n: errores }) : "",
    vendors.length ? t("vendors_detected", { v: vendors.join(", ") }) : "",
    "",
  ];
  return lines.filter(Boolean).join("\n");
}

function prompt(question) {
  // Non-interactive (docker run, cron, piped): skip the question and use
  // defaults — flags like --rename / --llm / --out decide the behavior.
  if (!process.stdin.isTTY) return Promise.resolve("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

const ENV_PATH = path.join(ROOT, ".env");

    function readEnv() {
      if (!existsSync(ENV_PATH)) return {};
      const out = {};
      for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      return out;
    }

    // Modelos realmente instalados en Ollama (best effort: si Ollama no corre,
    // se usa la lista estática del catálogo).
    function installedOllamaModels() {
      try {
        const res = spawnSync("ollama", ["list"], { encoding: "utf8", timeout: 4000 });
        if (res.status !== 0 || !res.stdout) return [];
        const names = res.stdout
          .split("\n")
          .slice(1)
          .map((l) => l.trim().split(/\s+/)[0])
          .filter((n) => n && n !== "NAME")
          .map((n) => (n.endsWith(":latest") ? n.slice(0, -7) : n));
        return [...new Set(names)];
      } catch {
        return [];
      }
    }

    // Lista numerada de modelos para que el usuario no tenga que saber nombres.
    async function pickModel(current, provider) {
      const currentModel = current.LLM_MODEL ?? current.MINIMAX_MODEL ?? "";
      let available = [...(provider.models ?? [])];
      if (provider.id === "ollama") {
        const installed = installedOllamaModels();
        if (installed.length) available = installed;
      }
      // Proveedor "custom" o sin lista: el usuario escribe el nombre exacto.
      if (provider.id === "custom" || available.length === 0) {
        const custom = await prompt(t("model_custom", { default: currentModel }));
        return custom.trim() || currentModel || "";
      }
      const def = currentModel || available[0];
      console.log("");
      console.log(t("model_pick", { provider: provider.name }));
      available.forEach((m, i) => console.log(`  [${i + 1}] ${m}`));
      console.log(`  [${available.length + 1}] ${t("model_other")}`);
      const answer = await prompt(t("model_prompt", { def }));
      const trimmed = answer.trim();
      if (!trimmed) return def;
      const idx = Number.parseInt(trimmed, 10) - 1;
      if (idx >= 0 && idx < available.length) return available[idx];
      if (Number.parseInt(trimmed, 10) === available.length + 1) {
        const custom = await prompt(t("model_custom", { default: "" }));
        return custom.trim() || def;
      }
      return trimmed; // escribió el nombre exacto directamente
    }

    async function runConfig(args) {
  const setIdx = args.indexOf("--set");
  if (setIdx >= 0) {
    const kv = args[setIdx + 1] ?? "";
    const eq = kv.indexOf("=");
    if (eq < 0) {
      console.error('Formato: pdf-tool config --set MINIMAX_API_KEY=tu-clave');
      process.exit(2);
    }
    const key = kv.slice(0, eq);
    const value = kv.slice(eq + 1);
    const current = readEnv();
    const body = Object.entries({ ...current, [key]: value })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
    await writeFile(ENV_PATH, body, { mode: 0o600 });
    console.log("✅ Clave guardada en " + ENV_PATH);
    return;
  }

  console.log("");
  console.log(t("config_title"));
  console.log(t("config_sep"));
  const current = readEnv();
  console.log("");
  console.log(t("provider_pick"));
  PROVIDERS.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.name} — ${p.tagline}`);
  });
  console.log("");
  const pick = await prompt(t("provider_prompt"));
  const idx = Number.parseInt(pick, 10) - 1;
  const provider = PROVIDERS[idx] ?? (pick ? PROVIDERS.find((p) => p.id === pick.toLowerCase()) : null);
  if (!provider) {
    console.log(t("no_ai"));
    return;
  }
  // Clave (los proveedores locales sin key la omiten)
  let key = current.LLM_API_KEY ?? current.MINIMAX_API_KEY ?? "";
  if (provider.needsKey) {
    const answer = await prompt(t("provider_key", { provider: provider.name }));
    if (answer) key = answer.trim();
  } else if (!key) {
    key = "local";
  }
  if (!key) {
    console.log(t("no_key"));
    return;
  }
  const model = await pickModel(current, provider);
  const defaultUrl = current.LLM_BASE_URL ?? current.MINIMAX_BASE_URL ?? provider.baseUrl;
  const urlAnswer = await prompt(t("ask_base", { url: defaultUrl }));
  const baseUrl = urlAnswer || defaultUrl;
  if (!baseUrl) {
    console.log(t("no_base_url"));
    return;
  }
  const merged = {
    ...current,
    PROVIDER: provider.id,
    LLM_API_KEY: key,
    LLM_BASE_URL: baseUrl,
    LLM_MODEL: model,
  };
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  await writeFile(ENV_PATH, body, { mode: 0o600 });
  console.log("");
  console.log(t("config_saved"));
  console.log(t("config_llm_hint"));

  // Renaming setup
  console.log("");
  const wantRename = await prompt(t("ask_rename"));
  if (/^s/i.test(wantRename)) {
    const current2 = readEnv();
    const pattern = await prompt(
      t("ask_pattern", { default: current2.PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}" }),
    );
    const merged2 = {
      ...readEnv(),
      PDF_NAME_PATTERN: pattern || current2.PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}",
      PDF_RENAME: "1",
    };
    await writeFile(ENV_PATH, Object.entries(merged2).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
    console.log("");
    console.log(t("keyword_expl"));
    console.log(t("keyword_ai"));
    console.log(t("keyword_noai"));
    console.log("");
    console.log(t("rename_next"));
  }
}

async function askForFolder() {
  // Non-engineer friendly: the user drags the folder into the terminal, which
  // pastes its path (possibly quoted). Fall back to a Documents/Facturas default.
  const candidates = [
    path.join(process.env.HOME || "", "Documentos", "Facturas"),
    path.join(process.env.HOME || "", "Documents", "Facturas"),
    path.join(process.env.HOME || "", "Escritorio", "Facturas"),
    path.join(process.env.HOME || "", "Desktop", "Facturas"),
  ];
  const existing = candidates.find((c) => existsSync(c));
  const hint = existing ? t("folder_default_hint", { path: existing }) : "";
  const raw = await prompt(t("ask_folder", { hint }));
  const cleaned = (raw || "").replace(/^['"]|['"]$/g, "").trim();
  const chosen = cleaned || existing;
  if (!chosen) {
    console.error(t("no_folder"));
    process.exit(1);
  }
  if (!existsSync(chosen)) {
    console.error(t("folder_missing", { path: chosen }));
    process.exit(1);
  }
  return chosen;
}

function sanitizeFilenamePart(value, fallback) {
  const cleaned = String(value ?? "").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

const STOPWORDS = new Set([
  "de", "del", "el", "la", "los", "las", "un", "una", "con", "por", "para", "y", "o", "en", "a",
  "factura", "periodo", "período", "numero", "número", "modulo", "módulo", "importe", "total",
  "precio", "unidad", "uds", "descripcion", "descripción", "cant", "nº", "no", "ref", "nif", "cif",
]);

function deterministicKeyword(row) {
  // Fallback when no LLM summary is available: take the content words of the
  // first line item description (strip numbers, dates, codes and stopwords).
  const first = row.lineItems?.split(";")[0]?.split("::")[0] ?? "";
  const words = first
    .toLowerCase()
    .replace(/\d+([.,]\d+)?/g, " ")
    .replace(/[^a-zñáéíóú\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 3).join("-") || "";
}

async function renamePdfs(rows, folder, env) {
  // Rename each processed PDF to the user's pattern, e.g.
  // {fecha}_{proveedor}_{palabra} -> 2026-08-01_miller_alquiler-trasteros.pdf
  const pattern = env.PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}";
  const used = new Set();
  const renamed = [];
  for (const row of rows) {
    if (row.error || !row.file) continue;
    const vendor = row.vendor || "desconocido";
    const keyword = row.keyword || deterministicKeyword(row) || vendor;
    const date = row.invoiceDate || "";
    const name = pattern
      .replaceAll("{fecha}", sanitizeFilenamePart(date, "sin-fecha"))
      .replaceAll("{proveedor}", sanitizeFilenamePart(vendor, "desconocido"))
      .replaceAll("{palabra}", sanitizeFilenamePart(keyword, vendor))
      .replaceAll("{numero}", sanitizeFilenamePart(row.invoiceNumber, "sin-numero"));
        const base = name || `factura-${row.file.replace(/\.pdf$/i, "")}`;
        let target = `${base}.pdf`;
        if (row.file.toLowerCase() === target.toLowerCase()) {
          // Already conformant (idempotency): never rename a file a second time.
          used.add(target.toLowerCase());
          continue;
        }
        let n = 1;
    while (used.has(target.toLowerCase()) || existsSync(path.join(folder, target))) {
      target = `${base}-${n}.pdf`;
      n += 1;
    }
    used.add(target.toLowerCase());
    const from = path.join(folder, row.file);
    const to = path.join(folder, target);
    try {
      await rename(from, to);
      renamed.push({ from: row.file, to: target });
    } catch {
      // keep going; the CSV still references the original name
    }
  }
  return renamed;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "";
  const rest = args.slice(1);

  // WU-3A1: fail-closed path-bearing CLI guard. The HTTP /extract-path route
  // and the MCP extract_pdf_from_path tool already return
  // unsafe_path_contract_removed_v1 (WU-2B/2C + WU-1B3). The CLI must reject
  // the same way before any stat/realpath/readFile/extraction work. The typed
  // error string is the literal contract, not i18n, so consumers can match on
  // it. Folder-batch (facturas <folder>) is a deterministic local-process
  // operation under the invoking OS user's authority per design §6.6 line 645
  // and stays unchanged.
  if (
    command === "extract-path" ||
    args.some((a) => a === "--extract-path" || a.startsWith("--extract-path="))
  ) {
    console.error("unsafe_path_contract_removed_v1");
    process.exit(2);
  }

  if (command === "config" || command === "clave") {
    await runConfig(rest);
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    console.log("pdf-tool v" + VERSION);
    return;
  }
  if (command === "ayuda" || command === "help" || command === "-h" || command === "--help" || !command) {
    console.log(t("help_title") + t("help_usage") + t("help_scan") + t("help_scan_direct") + t("help_scan_rename") + t("help_config") + t("help_out") + t("help_help"));
    return;
  }
  if (command === "facturas" || command === "folder" || command === "scan") {
    // skip --out <value> pairs so the folder is not confused with a flag value
    let folder;
    for (let i = 0; i < rest.length; i += 1) {
      const a = rest[i];
      if (a === "--out") { i += 1; continue; }
      if (!a.startsWith("--")) { folder = a; break; }
    }
    if (!folder) {
      folder = await askForFolder();
    }
    const useOcr = rest.includes("--ocr");
    const envNow = readEnv();
    let doRename = rest.includes("--rename") || envNow.PDF_RENAME === "1";
    if (!rest.includes("--rename") && envNow.PDF_RENAME !== "1" && !rest.includes("--no-rename")) {
      doRename = /^s/i.test(await prompt("¿Renombro los PDF con tu formato? (s/N): "));
    }
    if (rest.includes("--llm")) {
      // Fail-closed legacy raw-LLM flag (WU-2D). Slice 3 requires every LLM
      // call to flow through PrivacyTransactionService mediation, so the
      // CLI never asks the LLM directly. 503 maps to a non-zero exit code
      // because POSIX caps exit codes at 255.
      console.error(t("llm_preview_disabled"));
      process.exit(3);
    }
    const useLlm = false;
    // output folder: ask if not given via --out
    const outIdx = rest.indexOf("--out");
    let outPath =
      rest.find((a) => a.startsWith("--out="))?.split("=")[1] ??
      (outIdx >= 0 ? rest[outIdx + 1] : undefined);
    if (!outPath) {
      const rawOut = await prompt(t("ask_out", { folder }));
      const cleanedOut = (rawOut || "").replace(/^['"]|['"]$/g, "").trim();
      outPath = path.join(cleanedOut || folder, "facturas.csv");
    }

    console.log(t("scanning", { folder }));
    const files = await listPdfFiles(folder).catch(() => []);
    if (files.length === 0) {
      console.error(t("no_pdfs"));
      process.exit(1);
    }
    let processed = 0;
    const rows = await scanFolder(folder, {
      useOcr,
      useLlm,
      onProgress: () => {
        processed += 1;
        process.stdout.write(`\r  Procesando ${processed}/${files.length} ...`);
      },
    });
    process.stdout.write("\r" + " ".repeat(40) + "\r");
    await writeFile(outPath, csvFromRows(rows));
    console.log(friendlySummary(rows, folder));
    console.log(t("result_saved", { path: outPath }));
    if (doRename) {
      const renamed = await renamePdfs(rows, folder, readEnv());
      if (renamed.length) {
        // Keep the CSV in sync: point the archivo column at the renamed files.
        const byName = new Map(renamed.map((r) => [r.from, r.to]));
        for (const row of rows) {
          if (byName.has(row.file)) row.file = byName.get(row.file);
        }
        await writeFile(outPath, csvFromRows(rows));
        console.log(t("renamed_n", { n: renamed.length }));
        for (const r of renamed.slice(0, 10)) console.log(`   ${r.from} → ${r.to}`);
        if (renamed.length > 10) console.log(t("renamed_more", { n: renamed.length - 10 }));
        console.log(t("renamed_format", { pattern: readEnv().PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}" }));
      } else {
        console.log(t("renamed_none"));
      }
    }
    return;
  }
  console.error(t("unknown_cmd", { cmd: command }));
  process.exit(2);
}

main().catch((error) => {
  console.error(t("error", { msg: error?.message ?? error }));
  process.exit(1);
});
