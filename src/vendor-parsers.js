// Per-vendor deterministic invoice parsers for the businesses Javier works with.
// Each parser is a pure regex extractor over the already-extracted PDF text.
// Values are plain strings / numbers and always labeled untrusted — the same
// contract as the generic extractInvoiceFields() in extract.js.
//
// Vendors are detected by unique markers in the text, then parsed with
// vendor-specific label patterns (layouts differ: "Refª." vs "FACTURA Nº",
// column-aligned totals tables, etc.). When no vendor matches, callers fall
// back to the generic extractor or the MiniMax LLM path.

export const VENDOR_NAMES = ["mercadona", "miller", "empark", "acastimar", "doctoragua"];

const VENDOR_MARKERS = [
  { name: "mercadona", markers: [/MERCADONA\s+S\.A\./i] },
  {
    name: "miller",
    markers: [/LENCAR\s+CANARIAS/i, /POL\.IN\.\s*MILLER/i],
  },
  {
    name: "empark",
    markers: [/EMPARK\s+APARCAMIENTOS/i, /PARQUE\s+D[AÁ]RSENA/i],
  },
  {
    name: "acastimar",
    markers: [/ACASTIMAR,\s*S\.L\./i, /FACTURA\s+VENTA\b/i],
  },
    { name: "doctoragua", markers: [/doctoragua\.es/i, /DOCTOR AGUA/i, /B52537339/i] },
];

export function detectVendor(text) {
  const input = typeof text === "string" ? text : "";
  for (const entry of VENDOR_MARKERS) {
    if (entry.markers.some((re) => re.test(input))) return entry.name;
  }
  return null;
}

function toIsoDate(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  // YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YYYY
  m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD-MM-YYYY
  m = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function escapeRe(s) {
  return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseAmount(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^\d,.]/g, "");
  if (!cleaned) return null;
  // "1.298,05" (es-ES thousands) -> "1298.05"; "131,59" -> "131.59"; "12.00" stays.
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return cleaned.replace(/\./g, "").replace(",", ".");
  }
  return cleaned.replace(",", ".");
}

// --- MILLER (Lencar Canarias) ---
// Header "Fecha de factura: 01/08/2026", number "F2939/26" (Refª. column),
// totals table "Base imponible | Importe IGIC | Total Factura" followed by
// "131,59 9,21 140,80".
const MILLER_NUMBER_RE = /\b(F\d{3,4}\/\d{2})\b/i;
const MILLER_DATE_RE = /Fecha\s+de\s+factura:\s*(\d{2}\/\d{2}\/\d{4})/i;
const MILLER_TOTALS_RE =
  /Base\s+imponible\s+Importe\s+IGIC\s+Total\s+Factura\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i;

function parseMiller(text) {
  const fields = {};
  const number = text.match(MILLER_NUMBER_RE)?.[1] ?? null;
  if (number) fields.invoiceNumber = number;
  const date = toIsoDate(text.match(MILLER_DATE_RE)?.[1] ?? null);
  if (date) fields.invoiceDate = date;
  const totals = text.match(MILLER_TOTALS_RE);
  if (totals) {
    fields.totals = {
      subtotal: parseAmount(totals[1]),
      tax: parseAmount(totals[2]),
      total: parseAmount(totals[3]),
    };
  }
  fields.taxLabel = /\bIGIC\b/i.test(text) ? "IGIC" : /\bIVA\b/i.test(text) ? "IVA" : null;
  return { fields, vendor: "miller" };
}

// --- EMPARK ---
// "FACTURA Nº L2026S5151/10105", "Fecha de Emisión 2026-08-01",
// "TOTAL Líquido 11,21 € TOTAL IGIC 0,79 € TOTAL 12,00 €".
const EMPARK_NUMBER_RE = /FACTURA\s+N[ºo]\s+([A-Z0-9\/]+)/i;
const EMPARK_DATE_RE = /Fecha\s+de\s+Emisi[oó]n[\s\S]{0,150}?(\d{4}-\d{2}-\d{2})/i;
const EMPARK_TOTALS_RE =
  /TOTAL\s+L[ií]quido\s+([\d.,]+)\s*€\s+TOTAL\s+IGIC\s+([\d.,]+)\s*€\s+TOTAL\s+([\d.,]+)\s*€/i;

function parseEmpark(text) {
  const fields = {};
  const number = text.match(EMPARK_NUMBER_RE)?.[1] ?? null;
  if (number) fields.invoiceNumber = number;
  const date = toIsoDate(text.match(EMPARK_DATE_RE)?.[1] ?? null);
  if (date) fields.invoiceDate = date;
  const totals = text.match(EMPARK_TOTALS_RE);
  if (totals) {
    fields.totals = {
      subtotal: parseAmount(totals[1]),
      tax: parseAmount(totals[2]),
      total: parseAmount(totals[3]),
    };
  }
  fields.taxLabel = /\bIGIC\b/i.test(text) ? "IGIC" : /\bIVA\b/i.test(text) ? "IVA" : null;
  return { fields, vendor: "empark" };
}

// --- ACASTIMAR ---
// "FACTURA VENTA 26-722", "Fecha operación: 04-06-2026",
// "Importe neto BaseIVA 1.298,05 1.298,05" and "Importe Factura(EUR): 1.298,05".
const ACASTIMAR_NUMBER_RE = /FACTURA\s+VENTA\s+(\d{2,4}-\d{2,4})/i;
const ACASTIMAR_DATE_RE = /Fecha\s+operaci[oó]n:\s*(\d{2}-\d{2}-\d{4})/i;
const ACASTIMAR_TOTALS_RE = /Importe\s+neto\s+BaseIVA\s+([\d.,]+)\s+([\d.,]+)/i;
const ACASTIMAR_TOTAL_RE = /Importe\s+Factura\(EUR\):\s*([\d.,]+)/i;

function parseAcastimar(text) {
  const fields = {};
  const number = text.match(ACASTIMAR_NUMBER_RE)?.[1] ?? null;
  if (number) fields.invoiceNumber = number;
  const date = toIsoDate(text.match(ACASTIMAR_DATE_RE)?.[1] ?? null);
  if (date) fields.invoiceDate = date;
  const totals = text.match(ACASTIMAR_TOTALS_RE);
  if (totals) {
    fields.totals = {
      subtotal: parseAmount(totals[1]),
      tax: null,
      total: parseAmount(totals[2]),
    };
  } else {
    const totalOnly = text.match(ACASTIMAR_TOTAL_RE);
    if (totalOnly) {
      fields.totals = {
        subtotal: null,
        tax: null,
        total: parseAmount(totalOnly[1]),
      };
    }
  }
  fields.taxLabel = /\bIGIC\b/i.test(text) ? "IGIC" : /\bIVA\b/i.test(text) ? "IVA" : null;
  return { fields, vendor: "acastimar" };
}

// --- DOCTOR AGUA S.L. (auto-generated from doctor-agua-clean.pdf) ---

const DOCTORAGUA_NUMBER_RE = /FACTURA #\s*([A-Z0-9][A-Z0-9/\-.]{2,})/i;
const DOCTORAGUA_DATE_RE = /Fecha\s*[\s\S]{0,150}?(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/i;
const DOCTORAGUA_SUBTOTAL_RE = /BASE IMPONIBLE\s*([\d.,]+)/i;
const DOCTORAGUA_TAX_RE = /IMPUESTO\s*([\d.,]+)/i;
const DOCTORAGUA_TOTAL_RE = /TOTAL\s*([\d.,]+)/i;

function parseDoctoragua(text) {
  const fields = {};
  const number = text.match(DOCTORAGUA_NUMBER_RE)?.[1] ?? null;
  if (number) fields.invoiceNumber = number;
  const date = toIsoDate(text.match(DOCTORAGUA_DATE_RE)?.[1] ?? null);
  if (date) fields.invoiceDate = date;
  const sub = DOCTORAGUA_SUBTOTAL_RE ? text.match(DOCTORAGUA_SUBTOTAL_RE)?.[1] ?? null : null;
  const tax = DOCTORAGUA_TAX_RE ? text.match(DOCTORAGUA_TAX_RE)?.[1] ?? null : null;
  const total = DOCTORAGUA_TOTAL_RE ? text.match(DOCTORAGUA_TOTAL_RE)?.[1] ?? null : null;
  if (sub || tax || total) {
    fields.totals = {
      subtotal: sub ? parseAmount(sub) : null,
      tax: tax ? parseAmount(tax) : null,
      total: total ? parseAmount(total) : null,
    };
  }
  fields.taxLabel = /\bIGIC\b/i.test(text) ? "IGIC" : /\bIVA\b/i.test(text) ? "IVA" : null;
  return { fields, vendor: "doctoragua" };
}

const PARSERS = {
  miller: parseMiller,
  empark: parseEmpark,
  acastimar: parseAcastimar,
  doctoragua: parseDoctoragua,
};

// Parse with the vendor-specific extractor. Returns null when the vendor is
// unknown. The result mirrors the extractInvoiceFields() shape so callers can
// merge it: non-null vendor fields override the generic base.
export function parseVendorInvoice(text) {
  const vendor = detectVendor(text);
  if (!vendor) return null;
  const parser = PARSERS[vendor];
  if (!parser) return null;
  return parser(typeof text === "string" ? text : "");
}

const MAX_LINE_REGION = 60_000;

function boundedRegion(text, start, end) {
  const from = start ? text.indexOf(start) : 0;
  if (from < 0) return text.slice(0, MAX_LINE_REGION);
  const to = end ? text.indexOf(end, from) : text.length;
  const region = to >= 0 ? text.slice(from, to) : text.slice(from);
  // Cap so a missing end marker cannot turn the lazy regexes into a
  // super-linear CPU burn on crafted input.
  return region.slice(0, MAX_LINE_REGION);
}

// Column headers that can leak into the first line-item description when the
// bounded region starts at the header row ("Refª. Descripción Uds. Precio ud...").
const LINE_HEADER_TOKENS = [
  "Refª", "Descripción", "Uds", "Precio ud", "Dto", "Importe", "IGIC",
  "Cant", "Código", "Precio Unit", "Precio Unitario", "Precio Neto", "Total",
  "Uni", "Artículo", "Importe(EUR)", "Albarán", "Su Pedido",
  "Detalle de Facturación", "Importes em EUR", "Base Imponible", "IMPUESTO", "TOTAL",
];

function cleanLineDescription(value) {
  // Drop "Número de serie"/"Números de serie" fragments and collapse whitespace.
  let out = String(value ?? "")
    .replace(/n[úu]mero\s+de\s+serie\s*:\s*[A-Z0-9]+/gi, "")
    .replace(/n[úu]meros\s+de\s+serie\s*:\s*[A-Z0-9]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Strip a leading run of column-header tokens (token may carry a trailing
  // period, e.g. "Dto." / "Uds.").
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of LINE_HEADER_TOKENS) {
      const re = new RegExp(`^${escapeRe(token)}\\.?\\s+`);
      if (re.test(out)) {
        out = out.replace(re, "");
        changed = true;
        break;
      }
    }
  }
  // The line items follow the client block, which often ends with the client
  // phone ("Teléfono : 626824200"); cut there so the first description starts
  // at the first article instead of the header/address noise.
  const phoneCut = out.match(/Tel[ée]fono\s*:\s*[\d\s]+/i);
  if (phoneCut) out = out.slice(phoneCut.index + phoneCut[0].length);
  return out.trim();
}

// Per-vendor line-item row parsers. Each returns an array of rows with the
// numeric columns the layout prints (qty, unit price, amount, tax rate...).
const VENDOR_LINE_PARSERS = {
  miller(text) {
    const region = boundedRegion(text, "Refª", "Recibo Resumen");
    return [...region.matchAll(
      /([\s\S]{1,250}?M[OÓ]DULO\s+Nº\s*:\s*[A-Z0-9]+)\s+(\d+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/g,
    )].map((m) => ({
      description: cleanLineDescription(m[1]),
      units: parseAmount(m[2]),
      unit_price_eur: parseAmount(m[3]),
      amount_eur: parseAmount(m[4]),
      tax_rate: parseAmount(m[5]),
    }));
  },
  empark(text) {
    const region = boundedRegion(text, "Detalle de Facturación", "Detalle del IGIC");
    return [...region.matchAll(
      /([\s\S]{1,250}?)(\d+)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*%/g,
    )].map((m) => ({
      description: cleanLineDescription(m[1]),
      units: parseAmount(m[2]),
      unit_price_eur: parseAmount(m[3]),
      amount_eur: parseAmount(m[4]),
      tax_rate: parseAmount(m[5]),
    }));
  },
  acastimar(text) {
    const region = boundedRegion(text, "Precio Unitario", "Importe neto");
    return [...region.matchAll(
      /([\s\S]{1,250}?)(\d+,\d{2})\s+(\d+,\d{2})\s+(\d+,\d{2})\s+([A-Z0-9.]+)\s+(\d+,\d{2})\s+(\d+,\d{2})/g,
    )].map((m) => ({
      description: cleanLineDescription(m[1]),
      list_price_eur: parseAmount(m[2]),
      unit_price_eur: parseAmount(m[3]),
      discount_pct: parseAmount(m[4]),
      reference: m[5],
      amount_eur: parseAmount(m[6]),
      units: parseAmount(m[7]),
    }));
  },
};

export function parseVendorLineItems(text, vendor) {
  const parser = VENDOR_LINE_PARSERS[vendor];
  if (!parser) return [];
  return parser(typeof text === "string" ? text : "");
}

export const _internal = { toIsoDate, parseAmount, cleanLineDescription };
