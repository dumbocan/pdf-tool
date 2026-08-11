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
import { scanFolder, listPdfFiles } from "../src/folder-scan.js";

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
  const header = ["archivo", "proveedor", "numero_factura", "fecha", "subtotal", "impuesto", "total", "impuesto_label", "articulos"].join(",");
  const lines = rows.map((r) =>
    [r.file, r.vendor, r.invoiceNumber, r.invoiceDate, r.subtotal, r.tax, r.total, r.taxLabel, r.lineItems]
      .map(csvCell)
      .join(","),
  );
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
    "✅ Listo. Resumen de la carpeta: " + folder,
    "",
    `  Facturas procesadas: ${total}`,
    `  Con datos extraídos: ${ok}`,
    scanned > 0 ? `  Sin texto (escaneadas?): ${scanned} — usá --ocr la próxima vez` : "",
    errores > 0 ? `  Con errores: ${errores}` : "",
    vendors.length ? `  Proveedores detectados: ${vendors.join(", ")}` : "",
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
  console.log("Configuración de pdf-tool");
  console.log("---------------------------");
  const current = readEnv();
  const wantAi = await prompt("¿Querés que las facturas desconocidas se lean con IA? (s/N): ");
  if (!/^s/i.test(wantAi)) {
    console.log("OK, sin IA. Las facturas de proveedores conocidos se leen igual.");
    return;
  }
  const key = await prompt("Pegá tu clave de MiniMax (https://platform.minimax.io): ");
  if (!key) {
    console.log("Sin clave — lo dejamos sin IA por ahora. Podés volver con: pdf-tool config");
    return;
  }
  const model = await prompt(`Modelo (Enter = ${current.MINIMAX_MODEL || "MiniMax-M3"}): `);
  const baseUrl = await prompt(`Dirección del servicio (Enter = ${current.MINIMAX_BASE_URL || "https://api.minimax.io/v1"}): `);
  const merged = {
    ...current,
    MINIMAX_API_KEY: key,
    MINIMAX_MODEL: model || current.MINIMAX_MODEL || "MiniMax-M3",
    MINIMAX_BASE_URL: baseUrl || current.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
  };
  const body = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  await writeFile(ENV_PATH, body, { mode: 0o600 });
  console.log("");
  console.log("✅ Configuración guardada.");
  console.log("   Ahora las facturas que no reconozca se leen con IA (usá --llm en el comando facturas).");

  // Renaming setup
  console.log("");
  const wantRename = await prompt("¿Querés renombrar los PDF procesados con tu formato? (s/N): ");
  if (/^s/i.test(wantRename)) {
    const current2 = readEnv();
    const pattern = await prompt(
      `Formato del nombre. Podés usar: {fecha} {proveedor} {palabra} {numero}\n` +
      `Ejemplo: {fecha}_{proveedor}_{palabra} → 2026-08-01_miller_alquiler-trasteros.pdf\n` +
      `(Enter para dejar: ${current2.PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}"}): `,
    );
    const merged2 = {
      ...readEnv(),
      PDF_NAME_PATTERN: pattern || current2.PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}",
      PDF_RENAME: "1",
    };
    await writeFile(ENV_PATH, Object.entries(merged2).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
    console.log("");
    console.log("   La palabra clave (3-4 palabras de qué es la factura) se genera automáticamente:");
    console.log("   • con IA (si configuraste clave): resumen inteligente (ej. 'alquiler trasteros')");
    console.log("   • sin IA: de las primeras palabras de los artículos");
    console.log("");
    console.log("   Las próximas facturas se renombrarán automáticamente (usá --rename, y --llm para el resumen con IA).");
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
  const hint = existing ? ` (o Enter para usar: ${existing})` : "";
  const raw = await prompt(`Arrastrá la carpeta donde están tus facturas a esta ventana y presioná Enter${hint}:
> `);
  const cleaned = (raw || "").replace(/^['"]|['"]$/g, "").trim();
  const chosen = cleaned || existing;
  if (!chosen) {
    console.error("No escribiste ninguna carpeta. Probá de nuevo: pdf-tool facturas");
    process.exit(1);
  }
  if (!existsSync(chosen)) {
    console.error(`No existe la carpeta: ${chosen}`);
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

  if (command === "config" || command === "clave") {
    await runConfig(rest);
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    console.log("pdf-tool v" + VERSION);
    return;
  }
  if (command === "ayuda" || command === "help" || command === "-h" || command === "--help" || !command) {
    console.log(`
pdf-tool — extrae datos de tus facturas en PDF.

CÓMO USARLO:
  pdf-tool facturas
      Te guía paso a paso:
        1. Elegís la CARPETA DE ENTRADA (podés ARRASTRARLA a la ventana)
        2. Elegís dónde guardar el resultado (Enter = misma carpeta)
        3. Elegís si renombrar los PDF y con qué formato (configurable en
           pdf-tool config: {fecha}_{proveedor}_{palabra})
      Guarda facturas.csv con número, fecha, totales y artículos.

  pdf-tool facturas /ruta/a/tus/facturas --ocr
      Indicás la carpeta directamente; --ocr lee las escaneadas.

  pdf-tool facturas /ruta/a/tus/facturas --rename --llm
      Renombra los PDF con tu formato y resumen con IA.

  pdf-tool facturas /ruta/a/tus/facturas --out mi-lista.csv
      Guarda el resultado en otro archivo.

  pdf-tool config
      Configurá tu clave de IA, el formato de nombres y las palabras clave
      por proveedor.

  pdf-tool facturas <carpeta> --rename
      Además de guardar el CSV, renombra los PDF con tu formato
      (fecha_proveedor_palabra, configurable en pdf-tool config).

  pdf-tool ayuda
      Muestra esta ayuda.
`);
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
    let useLlm = rest.includes("--llm");
    if (doRename && !rest.includes("--llm") && envNow.MINIMAX_API_KEY) {
      useLlm = /^s/i.test(await prompt("¿Querés el resumen con IA para los nombres? (s/N): "));
    }
    // output folder: ask if not given via --out
    const outIdx = rest.indexOf("--out");
    let outPath =
      rest.find((a) => a.startsWith("--out="))?.split("=")[1] ??
      (outIdx >= 0 ? rest[outIdx + 1] : undefined);
    if (!outPath) {
      const rawOut = await prompt(`¿Dónde guardo el resultado? (Enter = misma carpeta: ${folder}): `);
      const cleanedOut = (rawOut || "").replace(/^['"]|['"]$/g, "").trim();
      outPath = path.join(cleanedOut || folder, "facturas.csv");
    }

    console.log(`Escaneando ${folder} ...`);
    const files = await listPdfFiles(folder).catch(() => []);
    if (files.length === 0) {
      console.error("No encontré archivos PDF en esa carpeta. Revisá la ruta.");
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
    console.log(`📄 Resultado guardado en: ${outPath}`);
    if (doRename) {
      const renamed = await renamePdfs(rows, folder, readEnv());
      if (renamed.length) {
        // Keep the CSV in sync: point the archivo column at the renamed files.
        const byName = new Map(renamed.map((r) => [r.from, r.to]));
        for (const row of rows) {
          if (byName.has(row.file)) row.file = byName.get(row.file);
        }
        await writeFile(outPath, csvFromRows(rows));
        console.log(`\n📁 Renombradas ${renamed.length} facturas:`);
        for (const r of renamed.slice(0, 10)) console.log(`   ${r.from} → ${r.to}`);
        if (renamed.length > 10) console.log(`   ... y ${renamed.length - 10} más`);
        console.log("   (formato: " + (readEnv().PDF_NAME_PATTERN || "{fecha}_{proveedor}_{palabra}") + ")");
      } else {
        console.log("\n⚠ No se renombró nada (¿ya tenían el formato o hubo errores?).");
      }
    }
    return;
  }
  console.error(`Comando desconocido: "${command}". Escribí "pdf-tool ayuda".`);
  process.exit(2);
}

main().catch((error) => {
  console.error("Error: " + (error?.message ?? error));
  process.exit(1);
});
