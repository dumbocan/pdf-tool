// Minimal i18n for the pdf-tool CLI (Spanish / English).
// Language selection: PDF_TOOL_LANG env var, or the PDF_TOOL_LANG saved in
// .env, or the system locale (es-* -> es, otherwise en). UI copy is the only
// localized surface; code, comments and identifiers stay English.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STRINGS = {
  es: {
    done_summary: "✅ Listo. Resumen de la carpeta: {folder}",
    invoices_processed: "  Facturas procesadas: {n}",
    with_data: "  Con datos extraídos: {n}",
    scanned_hint: "  Sin texto (¿escaneadas?): {n} — usá --ocr la próxima vez",
    with_errors: "  Con errores: {n}",
    vendors_detected: "  Proveedores detectados: {v}",
    config_title: "Configuración de pdf-tool",
    config_sep: "---------------------------",
    provider_pick: "Elegí tu proveedor de IA:",
    provider_prompt: "Número (o Enter = salir sin IA): ",
    provider_bad: "No entendí. Escribí el número del proveedor (ej: 1).",
    provider_key: "Pegá tu clave de {provider} (no se muestra mientras escribís; Enter = dejar la que ya tenés): ",
    no_ai: "OK, sin IA. Las facturas de proveedores conocidos se leen igual.",
    no_key: "Sin clave — lo dejamos sin IA por ahora. Podés volver con: pdf-tool config",
    no_base_url: "Falta la dirección del servicio. Volvé a correr: pdf-tool config",
    model_pick: "Elegí el modelo de {provider}:",
    model_prompt: "Número (Enter = {def}): ",
    model_other: "Otro (escribo el nombre)",
    model_custom: "Nombre exacto del modelo (Enter = {default}): ",
    ask_base: "Dirección del servicio (Enter = {url}): ",
    config_saved: "✅ Configuración guardada.",
    config_llm_hint: "   Ahora las facturas que no reconozca se leen con IA (usá --llm en el comando facturas).",
    ask_rename: "¿Renombro los PDF con tu formato? (s/N): ",
    ask_pattern: "Formato del nombre (Enter = {default}):\n  {fecha} = fecha · {proveedor} = proveedor · {palabra} = palabra clave · {numero} = número\n  Ejemplo: 2026-08-01_miller_box.pdf\n",
    keyword_expl: "   La palabra clave (3-4 palabras de qué es la factura) se genera automáticamente:",
    keyword_ai: "   • con IA (si configuraste clave): resumen inteligente (ej. 'alquiler trasteros')",
    keyword_noai: "   • sin IA: de las primeras palabras de los artículos",
    rename_next: "   Las próximas facturas se renombrarán automáticamente (usá --rename, y --llm para el resumen con IA).",
    ask_folder: "Arrastrá la carpeta donde están tus facturas a esta ventana y presioná Enter{hint}:\n> ",
    folder_default_hint: " (o Enter para usar: {path})",
    no_folder: "No escribiste ninguna carpeta. Probá de nuevo: pdf-tool facturas",
    folder_missing: "No existe la carpeta: {path}",
    scanning: "Escaneando {folder} ...",
    no_pdfs: "No encontré archivos PDF en esa carpeta. Revisá la ruta.",
    ask_ai_names: "¿Querés el resumen con IA para los nombres? (s/N): ",
    ask_out: "¿Dónde guardo el resultado? (Enter = misma carpeta: {folder}): ",
    renamed_n: "📁 Renombradas {n} facturas:",
    renamed_more: "   ... y {n} más",
    renamed_none: "\n⚠ No se renombró nada (¿ya tenían el formato o hubo errores?).",
    renamed_format: "   (formato: {pattern})",
    unknown_cmd: "Comando desconocido: \"{cmd}\". Escribí \"pdf-tool ayuda\".",
    help_title: "\npdf-tool — extrae datos de tus facturas en PDF.\n",
    help_usage: "CÓMO USARLO:",
    help_scan: "  pdf-tool facturas\n      Te guía paso a paso:\n        1. Elegís la CARPETA DE ENTRADA (podés ARRASTRARLA a la ventana)\n        2. Elegís dónde guardar el resultado (Enter = misma carpeta)\n        3. Elegís si renombrar los PDF y con qué formato (configurable en\n           pdf-tool config: {fecha}_{proveedor}_{palabra})\n      Guarda facturas.csv con número, fecha, totales y artículos.\n",
    help_scan_direct: "  pdf-tool facturas /ruta/a/tus/facturas --ocr\n      Indicás la carpeta directamente; --ocr lee las escaneadas.\n",
    help_scan_rename: "  pdf-tool facturas /ruta/a/tus/facturas --rename --llm\n      Renombra los PDF con tu formato y resumen con IA.\n",
    help_config: "  pdf-tool config\n      Configurá tu clave de IA, el formato de nombres y las palabras clave\n      por proveedor.\n",
    help_help: "  pdf-tool ayuda\n      Muestra esta ayuda.\n",
    help_out: "  pdf-tool facturas <carpeta> --out salida.csv\n      Guarda el resultado en otro archivo.\n",
    result_saved: "📄 Resultado guardado en: {path}",
    error: "Error: {msg}",
  },
  en: {
    done_summary: "✅ Done. Summary for folder: {folder}",
    invoices_processed: "  Invoices processed: {n}",
    with_data: "  With data extracted: {n}",
    scanned_hint: "  No text (scanned?): {n} — use --ocr next time",
    with_errors: "  With errors: {n}",
    vendors_detected: "  Vendors detected: {v}",
    config_title: "pdf-tool configuration",
    config_sep: "---------------------------",
    provider_pick: "Pick your AI provider:",
    provider_prompt: "Number (or Enter = skip AI): ",
    provider_bad: "Didn't understand. Type the provider number (e.g. 1).",
    provider_key: "Paste your {provider} API key (hidden while typing; Enter = keep current): ",
    no_ai: "OK, no AI. Invoices from known vendors are still read.",
    no_key: "No key — leaving AI off for now. You can come back with: pdf-tool config",
    no_base_url: "Missing service URL. Run again: pdf-tool config",
    model_pick: "Pick the {provider} model:",
    model_prompt: "Number (Enter = {def}): ",
    model_other: "Other (type the name)",
    model_custom: "Exact model name (Enter = {default}): ",
    ask_base: "Service URL (Enter = {url}): ",
    config_saved: "✅ Configuration saved.",
    config_llm_hint: "   Unknown invoices will now be read with AI (use --llm with the facturas command).",
    ask_rename: "Rename the PDFs with your format? (y/N): ",
    ask_pattern: "Name format (Enter = {default}):\n  {fecha} = date · {proveedor} = vendor · {palabra} = keyword · {numero} = number\n  Example: 2026-08-01_miller_box.pdf\n",
    keyword_expl: "   The keyword (3-4 words about what the invoice is for) is generated automatically:",
    keyword_ai: "   • with AI (if you configured a key): smart summary (e.g. 'storage rental')",
    keyword_noai: "   • without AI: from the first words of the line items",
    rename_next: "   Next invoices will be renamed automatically (use --rename, and --llm for the AI summary).",
    ask_folder: "Drag the folder with your invoices into this window and press Enter{hint}:\n> ",
    folder_default_hint: " (or Enter to use: {path})",
    no_folder: "You didn't type a folder. Try again: pdf-tool facturas",
    folder_missing: "Folder does not exist: {path}",
    scanning: "Scanning {folder} ...",
    no_pdfs: "No PDF files found in that folder. Check the path.",
    ask_ai_names: "Do you want the AI summary for the names? (y/N): ",
    ask_out: "Where should I save the result? (Enter = same folder: {folder}): ",
    renamed_n: "📁 Renamed {n} invoices:",
    renamed_more: "   ... and {n} more",
    renamed_none: "\n⚠ Nothing was renamed (already in format, or errors?).",
    renamed_format: "   (format: {pattern})",
    unknown_cmd: "Unknown command: \"{cmd}\". Type \"pdf-tool ayuda\".",
    help_title: "\npdf-tool — extract data from your PDF invoices.\n",
    help_usage: "HOW TO USE IT:",
    help_scan: "  pdf-tool facturas\n      Guides you step by step:\n        1. Choose the INPUT FOLDER (you can DRAG it into the window)\n        2. Choose where to save the result (Enter = same folder)\n        3. Choose whether to rename the PDFs and the format (configurable in\n           pdf-tool config: {fecha}_{proveedor}_{palabra})\n      Saves facturas.csv with number, date, totals and articles.\n",
    help_scan_direct: "  pdf-tool facturas /path/to/your/invoices --ocr\n      Set the folder directly; --ocr reads scanned ones.\n",
    help_scan_rename: "  pdf-tool facturas /path/to/your/invoices --rename --llm\n      Renames the PDFs with your format and AI summary.\n",
    help_config: "  pdf-tool config\n      Configure your AI key, the name format and the keywords per vendor.\n",
    help_help: "  pdf-tool ayuda\n      Shows this help.\n",
    help_out: "  pdf-tool facturas <folder> --out output.csv\n      Saves the result to another file.\n",
    result_saved: "📄 Result saved to: {path}",
    error: "Error: {msg}",
  },
};

function detectLang() {
  const fromEnv = process.env.PDF_TOOL_LANG;
  if (fromEnv === "es" || fromEnv === "en") return fromEnv;
  try {
    const envPath = path.join(ROOT, ".env");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split("\n")) {
        const m = line.match(/^\s*PDF_TOOL_LANG\s*=\s*(es|en)\s*$/);
        if (m) return m[1];
      }
    }
  } catch {
    // ignore
  }
  const locale = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").toLowerCase();
  return locale.startsWith("es") ? "es" : "en";
}

export const lang = detectLang();

export function t(key, params = {}) {
  let text = (STRINGS[lang] ?? STRINGS.es)[key] ?? STRINGS.es[key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
