import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractInvoiceFields,
  extractInvoiceFieldsFromLines,
  extractOcrFromPdfPage,
  extractTextFromPdf,
  PdfExtractionError,
} from "./extract.js";
import { detectVendor } from "./vendor-parsers.js";

function loadIsoSnapshot() {
  try {
    return JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../contracts/invoice-learning/v1/iso-4217-snapshot.json",
        ),
        "utf8",
      ),
    );
  } catch (error) {
    throw new Error("ISO-4217 snapshot unavailable", { cause: error });
  }
}

const ISO_SNAPSHOT = loadIsoSnapshot();
const ISO_CODES = new Set(ISO_SNAPSHOT.entries.map(({ code }) => code));
const MISSING = (reason = "NOT_FOUND") => ({ state: "MISSING", reason });
const ID = (prefix, ordinal) =>
  `${prefix}_${ordinal.toString(16).padStart(16, "0")}`;
const PRESENT = (value, fragments) => ({
  state: "PRESENT",
  value,
  provenance: "EXTRACTED_LOCAL",
  evidence: Array.isArray(fragments) ? fragments : [fragments],
});

function documentError(message, code = "pdf_invalid") {
  return new PdfExtractionError(message, code);
}

function assertDocumentId(documentId) {
  if (
    typeof documentId !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(documentId)
  ) {
    throw documentError(
      "document id must be a 22-character opaque identifier",
      "document_id_invalid",
    );
  }
}

function rectFromBbox(bbox) {
  const x = Math.min(9999, Math.max(0, Math.round(Number(bbox?.x ?? 0) * 100)));
  const y = Math.min(9999, Math.max(0, Math.round(Number(bbox?.y ?? 0) * 100)));
  const right = Math.min(
    10000,
    Math.max(
      x + 1,
      Math.round((Number(bbox?.x ?? 0) + Number(bbox?.width ?? 100)) * 100),
    ),
  );
  const bottom = Math.min(
    10000,
    Math.max(
      y + 1,
      Math.round((Number(bbox?.y ?? 0) + Number(bbox?.height ?? 4)) * 100),
    ),
  );
  return { x, y, width: right - x, height: bottom - y };
}

const MAX_OCR_EVIDENCE_FRAGMENTS = 16_384;
const TOKEN_ID_RE = /^t_[0-9a-f]{16}$/;

function ocrGeometryError(reason) {
  return new PdfExtractionError(`OCR evidence ${reason}`, `ocr_${reason}`);
}

/**
 * Convert a PDF bottom-left OCR box to the closed top-left rect convention.
 *
 * The wire contract represents page-relative geometry as integer coordinates on
 * a 0..10000 scale. PDF y=0 starts at the bottom, so the source box is
 * vertically flipped before scaling; all edges are then clamped to the page.
 */
export function normalize_ocr_rect(bbox, pageWidth, pageHeight) {
  if (
    !bbox ||
    ![bbox.x, bbox.y, bbox.width, bbox.height, pageWidth, pageHeight].every(
      Number.isFinite,
    ) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    bbox.width <= 0 ||
    bbox.height <= 0
  ) {
    throw ocrGeometryError("geometry_invalid");
  }
  const left = Math.max(0, Math.min(pageWidth, bbox.x));
  const right = Math.max(left, Math.min(pageWidth, bbox.x + bbox.width));
  const top = Math.max(
    0,
    Math.min(pageHeight, pageHeight - bbox.y - bbox.height),
  );
  const bottomEdge = Math.max(top, Math.min(pageHeight, pageHeight - bbox.y));
  let x = Math.floor((left / pageWidth) * 10000);
  let y = Math.floor((top / pageHeight) * 10000);
  let rightScaled = Math.ceil((right / pageWidth) * 10000);
  let bottomScaled = Math.ceil((bottomEdge / pageHeight) * 10000);
  if (x >= 10000) x = 9999;
  if (y >= 10000) y = 9999;
  rightScaled = Math.min(10000, Math.max(x + 1, rightScaled));
  bottomScaled = Math.min(10000, Math.max(y + 1, bottomScaled));
  return { x, y, width: rightScaled - x, height: bottomScaled - y };
}

export const normalizeOcrRect = normalize_ocr_rect;

export function make_token_id(page, column, row, sequence) {
  const digest = createHash("sha256")
    .update(`${page}:${row}:${column}:${sequence}`)
    .digest("hex")
    .slice(0, 16);
  return `t_${digest}`;
}

export const makeOcrTokenId = make_token_id;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Materialize bounded OCR words and deterministic local line/column groups. */
export function materializeOcrEvidence(tokens, { pageWidth, pageHeight } = {}) {
  if (!Array.isArray(tokens)) throw ocrGeometryError("tokens_invalid");
  if (tokens.length > MAX_OCR_EVIDENCE_FRAGMENTS)
    throw ocrGeometryError("resource_limit");
  const normalized = tokens.map((token, sequence) => {
    if (token?.tokenId !== undefined && !TOKEN_ID_RE.test(token.tokenId))
      throw ocrGeometryError("token_id_invalid");
    const page = Number(token?.page ?? token?.pageNumber);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100 ||
      typeof token?.text !== "string" ||
      token.text.trim() === ""
    )
      throw ocrGeometryError("token_invalid");
    const width = Number(token.pageWidth ?? pageWidth);
    const height = Number(token.pageHeight ?? pageHeight);
    const rect = normalize_ocr_rect(token.bbox, width, height);
    return { token, sequence, page, rect, centerY: rect.y + rect.height / 2 };
  });
  const byPage = new Map();
  for (const token of normalized) {
    if (!byPage.has(token.page)) byPage.set(token.page, []);
    byPage.get(token.page).push(token);
  }
  const fragments = [];
  const lines = [];
  for (const [page, pageTokens] of [...byPage.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    const threshold = Math.max(
      1,
      median(pageTokens.map(({ rect }) => rect.height)) * 1.5,
    );
    const ordered = [...pageTokens].sort(
      (a, b) =>
        a.rect.y - b.rect.y || a.rect.x - b.rect.x || a.sequence - b.sequence,
    );
    const groups = [];
    for (const token of ordered) {
      const current = groups.at(-1);
      if (!current || Math.abs(current.centerY - token.centerY) > threshold) {
        groups.push({ page, centerY: token.centerY, tokens: [token] });
      } else {
        current.tokens.push(token);
        current.centerY =
          (current.centerY * (current.tokens.length - 1) + token.centerY) /
          current.tokens.length;
      }
    }
    for (const [row, group] of groups.entries()) {
      group.tokens.sort(
        (a, b) => a.rect.x - b.rect.x || a.sequence - b.sequence,
      );
      const groupFragments = group.tokens.map((token, column) => {
        const tokenId = make_token_id(page, column, row, token.sequence);
        const fragment = {
          evidenceId: ID("ev", fragments.length),
          page,
          rect: token.rect,
          localRef: { kind: "TOKEN", tokenId },
        };
        fragments.push(fragment);
        token.tokenId = tokenId;
        token.column = column;
        token.row = row;
        token.fragment = fragment;
        return fragment;
      });
      const minX = Math.min(...group.tokens.map(({ rect }) => rect.x));
      const minY = Math.min(...group.tokens.map(({ rect }) => rect.y));
      const maxX = Math.max(
        ...group.tokens.map(({ rect }) => rect.x + rect.width),
      );
      const maxY = Math.max(
        ...group.tokens.map(({ rect }) => rect.y + rect.height),
      );
      lines.push({
        text: group.tokens.map(({ token }) => token.text.trim()).join(" "),
        pageNumber: page,
        bbox: {
          page,
          x: minX / 100,
          y: minY / 100,
          width: (maxX - minX) / 100,
          height: (maxY - minY) / 100,
        },
        ocrFragments: groupFragments,
        // Internal parser seam; token text never crosses the evidence wire.
        ocrTokens: group.tokens.map(
          ({ token, fragment, rect, column, row }) => ({
            ...token,
            fragment,
            rect,
            column,
            row,
          }),
        ),
      });
    }
  }
  return {
    fragments,
    lines,
    tokens: normalized,
    pageCount: byPage.size ? Math.max(...byPage.keys()) : 1,
  };
}

/** Extract scalar fields from raw OCR tokens while preserving positional evidence.
 *  @param {object} tsvRows
 *  @param {{ scalarLabelsOverride?: Array, vendor?: string|null }} [options] */
export function extractInvoiceFieldsPositional(tsvRows, options) {
  const tokens = Array.isArray(tsvRows) ? tsvRows : tsvRows?.tokens;
  const pageWidth =
    tsvRows?.pageWidth ?? tokens?.find((token) => token?.pageWidth)?.pageWidth;
  const pageHeight =
    tsvRows?.pageHeight ??
    tokens?.find((token) => token?.pageHeight)?.pageHeight;
  if (
    !Array.isArray(tokens) ||
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight)
  ) {
    return {
      invoiceDate: null,
      invoiceNumber: null,
      taxLabel: null,
      totals: { subtotal: null, tax: null, total: null },
      matched: [],
      lines: [],
    };
  }
  const materialized = materializeOcrEvidence(tokens, {
    pageWidth,
    pageHeight,
  });
  return {
    ...extractInvoiceFieldsFromLines(materialized.lines, options),
    lines: materialized.lines,
    fragments: materialized.fragments,
  };
}

function evidenceFragmentsFor(source, ordinal) {
  if (source?.ocrFragments?.length) return source.ocrFragments;
  if (!source?.bbox) return [];
  const page = Number.isInteger(source.bbox.page)
    ? source.bbox.page
    : Number(source.pageNumber) || 1;
  return [
    {
      evidenceId: ID("ev", ordinal),
      page: Math.min(100, Math.max(1, page)),
      rect: rectFromBbox(source.bbox),
      localRef: { kind: "TOKEN", tokenId: ID("t", ordinal) },
    },
  ];
}

function fragmentFor(source, ordinal) {
  return evidenceFragmentsFor(source, ordinal)[0] ?? null;
}

function canonicalNumber(raw, maxFraction) {
  if (typeof raw !== "string") return null;
  const input = raw.trim();
  const value =
    input.includes(",") && input.includes(".")
      ? input.replace(/\./g, "").replace(",", ".")
      : input.replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > maxFraction) return null;
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const normalized = normalizedFraction
    ? `${normalizedWhole}.${normalizedFraction}`
    : normalizedWhole;
  return normalized === "" ? "0" : normalized;
}

function lineSource(lines, expression) {
  return lines.find((line) => expression.test(line.text)) ?? null;
}

const ROW_NUMBER = "[+-]?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:[.,]\\d{1,6})?";
const OCR_HEADER_WORDS = [
  "description",
  "qty",
  "quantity",
  "unit",
  "price",
  "amount",
  "line",
];
const COLUMN_IDENTIFIERS = ["description", "quantity", "unitPrice"];

/** Empty cell: absent, blank text, or a fail-closed envelope (MISSING/UNSUPPORTED). */
function emptyCell(cell) {
  if (cell == null || cell === "") return true;
  return (
    typeof cell === "object" &&
    (cell.state === "MISSING" || cell.state === "UNSUPPORTED")
  );
}

/**
 * Decide the table's split-row policy from its visual row fragments, in source order.
 *
 * A fragment whose first column (description) is empty while a later column carries
 * a value is the continuation tail of the row above it: that layout yields CONTINUE.
 * Fragments whose first column carries a value start fresh rows, so a table with no
 * continuation fragments yields NEW_ROW. A continuation that cannot be joined safely
 * — no preceding row to continue, later columns also empty, or a page boundary
 * between the tail and its row — fails closed as UNSUPPORTED; nothing is ever joined
 * across pages by inference.
 */
export function split_row_policy(fragments) {
  if (!Array.isArray(fragments) || fragments.length === 0) return "UNSUPPORTED";
  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];
    const cells = Array.isArray(fragment) ? fragment : fragment?.cells;
    if (!Array.isArray(cells) || cells.length === 0) return "UNSUPPORTED";
    if (!emptyCell(cells[0])) continue;
    const continuation = cells.slice(1).some((cell) => !emptyCell(cell));
    if (!continuation) return "UNSUPPORTED";
    const previousPage =
      fragments[index - 1]?.pageNumber ?? fragments[index - 1]?.page ?? null;
    const page = fragment.pageNumber ?? fragment.page ?? null;
    if (index === 0) return "UNSUPPORTED";
    if (previousPage != null && page != null && previousPage !== page)
      return "UNSUPPORTED";
    return "CONTINUE";
  }
  return "NEW_ROW";
}

/** Backward-compatible camelCase alias for the split-row policy classifier. */
export const splitRowPolicy = split_row_policy;

function makeRow(
  description,
  quantity,
  unitPrice,
  source,
  ordinal,
  cellFragments,
) {
  const fallbackFragments = [8, 9, 10].map((offset) =>
    fragmentFor(source, ordinal * 3 + offset),
  );
  const fragments =
    cellFragments ??
    fallbackFragments.map((fragment) => (fragment ? [fragment] : []));
  const page = fragments.flat().find(Boolean)?.page ?? source?.pageNumber ?? 1;
  const envelope = (value, evidence) =>
    evidence?.length ? PRESENT(value, evidence) : MISSING("EVIDENCE_MISSING");
  return {
    rowId: ID("g", ordinal),
    page,
    ordinal,
    description: envelope(description, fragments[0]),
    quantity: envelope(quantity, fragments[1]),
    unitPrice: envelope(unitPrice, fragments[2]),
  };
}

function ocrHeaderInfo(text) {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const has = (word) => new RegExp(`\\b${word}\\b`).test(normalized);
  const isHeader =
    has("description") &&
    (has("qty") || has("quantity")) &&
    has("unit") &&
    has("price") &&
    (has("amount") || has("total"));
  return { isHeader, ambiguous: false };
}

function parseRows(lines) {
  const rows = [],
    seen = new Set(),
    headers = [],
    issues = [];
  const rowPattern = new RegExp(
    `^(.+?)\\s+(${ROW_NUMBER})\\s+(${ROW_NUMBER})\\s+${ROW_NUMBER}$`,
  );
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index];
    const text = source.text.trim();
    const header = ocrHeaderInfo(text);
    const headerWords = OCR_HEADER_WORDS.filter((word) =>
      text.toLowerCase().includes(word),
    ).length;
    if (headerWords >= 2) {
      if (header.isHeader) headers.push(source);
      if (header.ambiguous || !header.isHeader)
        issues.push("UNSUPPORTED_STRUCTURE");
      continue;
    }
    if (
      !text ||
      /^(invoice|invoice number|invoice date|currency|taxable base|tax(?:es)?|total)\b/i.test(
        text,
      )
    )
      continue;
    const match = text.match(rowPattern);
    if (!match) {
      const next = lines[index + 1]?.text?.trim() ?? "";
      if (
        /^.+\s+$/.test(text) ||
        /\d/.test(text) ||
        (text && new RegExp(`^${ROW_NUMBER}(?:\\s+${ROW_NUMBER})+$`).test(next))
      )
        issues.push("UNSUPPORTED_STRUCTURE");
      continue;
    }
    const description = match[1].trim();
    const quantity = canonicalNumber(match[2], 6);
    const unitPrice = canonicalNumber(match[3], 4);
    if (!description || !quantity || !unitPrice) {
      issues.push("INVALID_FORMAT");
      continue;
    }
    const key = `${description}\\u0000${quantity}\\u0000${unitPrice}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(makeRow(description, quantity, unitPrice, source, rows.length));
    if (rows.length === 500) break;
  }
  return { rows, headers, issues };
}

function ocrHeaderColumns(header) {
  const tokens = Array.isArray(header?.ocrTokens) ? header.ocrTokens : [];
  const find = (patterns) =>
    tokens.find(({ text = "" }) =>
      patterns.includes(text.trim().toLowerCase()),
    );
  const anchors = [
    find(["qty", "quantity"]),
    find(["unit", "unit price"]),
    find(["amount", "line", "line total"]),
  ]
    .map((entry) => entry?.rect?.x)
    .filter(Number.isFinite);
  return anchors.length === 3 ? anchors : null;
}

function assignOcrNumericColumns(numeric, headerColumns) {
  if (
    !headerColumns ||
    numeric.length === 0 ||
    numeric.length > headerColumns.length
  )
    return null;
  const boundaries = [
    -Infinity,
    (headerColumns[0] + headerColumns[1]) / 2,
    (headerColumns[1] + headerColumns[2]) / 2,
    Infinity,
  ];
  const assignments = numeric.map((entry) => {
    const x = entry.rect?.x;
    const column = boundaries.findIndex(
      (boundary, index) => x >= boundary && x < boundaries[index + 1],
    );
    return { entry, column };
  });
  if (
    assignments.some(({ column }) => column < 0) ||
    assignments.some(
      ({ column }, index) => index && column <= assignments[index - 1].column,
    )
  )
    return null;
  return assignments;
}

function ocrRowCandidate(source, headerColumns) {
  const tokens = Array.isArray(source.ocrTokens) ? source.ocrTokens : [];
  const numeric = tokens.filter(({ text = "" }) =>
    new RegExp(`^${ROW_NUMBER}$`).test(text.trim()),
  );
  if (numeric.length === 0 || numeric.length > 3) return null;
  const assignments = assignOcrNumericColumns(numeric, headerColumns);
  if (!assignments) return { ambiguous: true };
  const firstNumber = tokens.indexOf(numeric[0]);
  const descriptionTokens = tokens.slice(0, firstNumber);
  if (descriptionTokens.length === 0) return null;
  const cells = [null, null, null];
  const fragments = [[], [], []];
  for (const { entry, column } of assignments) {
    if (column === 0) {
      cells[1] = canonicalNumber(entry.text.trim(), 6);
      fragments[1] = entry.fragment ? [entry.fragment] : [];
    } else if (column === 1) {
      cells[2] = canonicalNumber(entry.text.trim(), 4);
      fragments[2] = entry.fragment ? [entry.fragment] : [];
    }
  }
  fragments[0] = descriptionTokens.flatMap(({ fragment }) =>
    fragment ? [fragment] : [],
  );
  return {
    description: descriptionTokens.map(({ text }) => text.trim()).join(" "),
    quantity: cells[1],
    unitPrice: cells[2],
    descriptionTokens,
    cellFragments: fragments,
  };
}

function isOcrDescriptionOnly(source) {
  if (!Array.isArray(source?.ocrTokens) || source.ocrTokens.length === 0)
    return false;
  return !source.ocrTokens.some(({ text = "" }) =>
    new RegExp(`^${ROW_NUMBER}$`).test(text.trim()),
  );
}

/** Sort already-clustered OCR lines by page, vertical position, then x extent. */
export function cluster_rows_from_groups(lines) {
  return [...lines].sort((a, b) => {
    const pageA = a.pageNumber ?? 1;
    const pageB = b.pageNumber ?? 1;
    const yA = a.bbox?.y ?? 0;
    const yB = b.bbox?.y ?? 0;
    const xA = a.bbox?.x ?? 0;
    const xB = b.bbox?.x ?? 0;
    return pageA - pageB || yA - yB || xA - xB;
  });
}

/** Backward-compatible camelCase alias for the row-clustering helper. */
export const clusterRowsFromGroups = cluster_rows_from_groups;

/** Build rows from OCR's local token columns without joining across pages. */
function parseOcrRows(lines) {
  const rows = [],
    seen = new Set(),
    headers = [],
    issues = [];
  const clusteredLines = clusterRowsFromGroups(lines);
  for (const source of clusteredLines) {
    const header = ocrHeaderInfo(source.text);
    const headerWords = OCR_HEADER_WORDS.filter((word) =>
      source.text.toLowerCase().includes(word),
    ).length;
    const numeric = (source.ocrTokens ?? []).filter(({ text = "" }) =>
      new RegExp(`^${ROW_NUMBER}$`).test(text.trim()),
    );
    if (headerWords >= 2) {
      if (header.isHeader && numeric.length === 0) headers.push(source);
      if (header.ambiguous || !header.isHeader || numeric.length > 0)
        issues.push("UNSUPPORTED_STRUCTURE");
    }
  }
  const headerColumns = ocrHeaderColumns(headers[0]);
  const hasUsableHeader = headers.length > 0 && headerColumns;
  for (let index = 0; index < clusteredLines.length; index += 1) {
    const source = clusteredLines[index];
    const text = source.text.trim();
    const headerWords = OCR_HEADER_WORDS.filter((word) =>
      text.toLowerCase().includes(word),
    ).length;
    if (headerWords >= 2) continue;
    if (
      !text ||
      /^(invoice|invoice number|invoice date|currency|taxable base|subtotal|tax(?:es)?|total)\b/i.test(
        text,
      )
    )
      continue;
    const numeric = (source.ocrTokens ?? []).filter(({ text: value = "" }) =>
      new RegExp(`^${ROW_NUMBER}$`).test(value.trim()),
    );
    if (numeric.length < 2) continue;
    const candidate = ocrRowCandidate(source, headerColumns);
    if (!candidate) continue;
    if (candidate.ambiguous || !hasUsableHeader) {
      issues.push("UNSUPPORTED_STRUCTURE");
      continue;
    }
    const previous = clusteredLines[index - 1];
    const wrapped =
      previous &&
      previous.pageNumber === source.pageNumber &&
      isOcrDescriptionOnly(previous) &&
      !ocrHeaderInfo(previous.text).isHeader &&
      !/^(invoice|invoice number|currency|taxable base|subtotal|tax(?:es)?|total)\b/i.test(
        previous.text.trim(),
      );
    const descriptionTokens = wrapped
      ? [...previous.ocrTokens, ...candidate.descriptionTokens]
      : candidate.descriptionTokens;
    const description = descriptionTokens
      .map(({ text: value }) => value.trim())
      .join(" ");
    const cellFragments = [
      descriptionTokens.flatMap(({ fragment }) => (fragment ? [fragment] : [])),
      candidate.cellFragments[1],
      candidate.cellFragments[2],
    ];
    if (!description || !candidate.quantity || !candidate.unitPrice) {
      if (
        description &&
        candidate.cellFragments.some(
          (fragments, cell) => cell > 0 && fragments.length === 0,
        )
      )
        issues.push("MISSING_EVIDENCE");
      else issues.push("INVALID_FORMAT");
    }
    if (!description) continue;
    const key = `${description}\u0000${candidate.quantity ?? ""}\u0000${candidate.unitPrice ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(
      makeRow(
        description,
        candidate.quantity,
        candidate.unitPrice,
        source,
        rows.length,
        cellFragments,
      ),
    );
    if (rows.length === 500) break;
  }
  return { rows, headers, issues };
}

function emptyRow(reason = "NOT_FOUND") {
  return {
    rowId: ID("g", 0),
    page: 1,
    ordinal: 0,
    description: MISSING(reason),
    quantity: MISSING(reason),
    unitPrice: MISSING(reason),
  };
}

function missingReasons(record, hasText, extra = []) {
  const reasons = [...extra];
  for (const [name, value] of Object.entries(record)) {
    if (name === "lineItems") continue;
    if (value.state === "MISSING")
      reasons.push(
        {
          EVIDENCE_MISSING: "MISSING_EVIDENCE",
          INVALID_FORMAT: "INVALID_FORMAT",
          UNSUPPORTED: "CURRENCY_INVALID",
          AMBIGUOUS: "AMBIGUOUS_VALUE",
        }[value.reason] ?? "MISSING_REQUIRED_VALUE",
      );
  }
  for (const row of record.lineItems)
    for (const value of [row.description, row.quantity, row.unitPrice]) {
      if (value.state === "MISSING")
        reasons.push(
          value.reason === "EVIDENCE_MISSING"
            ? "MISSING_EVIDENCE"
            : "MISSING_REQUIRED_VALUE",
        );
    }
  if (!hasText) reasons.push("NON_DIGITAL_INPUT");
  return [...new Set(reasons)];
}

function fieldEnvelope(value, source, ordinal, fallbackReason = "NOT_FOUND") {
  if (value == null) return MISSING(fallbackReason);
  const fragments = evidenceFragmentsFor(source, ordinal);
  return fragments.length
    ? PRESENT(value, fragments)
    : MISSING("EVIDENCE_MISSING");
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1900 &&
    year <= 9999 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function addDecimal(a, b) {
  const [aw, af = ""] = a.split("."),
    [bw, bf = ""] = b.split("."),
    scale = Math.max(af.length, bf.length);
  const sum = (
    BigInt(aw + af.padEnd(scale, "0")) + BigInt(bw + bf.padEnd(scale, "0"))
  )
    .toString()
    .padStart(scale + 1, "0");
  return scale
    ? `${sum.slice(0, -scale)}.${sum.slice(-scale).replace(/0+$/, "") || "0"}`
    : sum;
}

function isNegativeInput(lines) {
  return lines.some(({ text = "" }) => /(?:^|[:\s])-[0-9][0-9.,]*/.test(text));
}
function isCreditNote(lines) {
  return lines.some(({ text = "" }) =>
    /\bcredit(?:\s+(?:note|memo)|\s*$)|nota\s+de\s+cr[eé]dito|abono|rectificativa/i.test(
      text,
    ),
  );
}

/**
 * Populate the emitted LearnedTable from the parsed header rows and data rows.
 *
 * splitRowPolicy semantics: the wire policy is the split_row_policy decision over
 * the parsed row fragments in source order — never a hardcoded value. Each parsed
 * row maps to one fragment carrying its three cell envelopes (description,
 * quantity, unitPrice) plus its page. A row whose description is empty while a
 * later cell holds a value is a continuation tail (CONTINUE); rows that each
 * start their own complete row yield NEW_ROW. Empty tables, dangling tails with
 * no preceding row, and tails separated from their row by a page boundary fail
 * closed to UNSUPPORTED — nothing is ever joined across pages by inference.
 */
export function populate_learned_table(headers, rows = []) {
  const pages = [
    ...new Set(
      headers
        .map((line) => line.bbox?.page ?? line.pageNumber)
        .filter(Number.isInteger),
    ),
  ].sort((a, b) => a - b);
  const headerMarkers = pages.slice(1).map((page, index) => ({
    repeatedRowId: ID("g", 1001 + index),
    canonicalRowId: ID("g", 1000),
    page,
    ordinal: index,
  }));
  const fragments = rows.map((row) => ({
    pageNumber: row.page ?? row.pageNumber ?? null,
    cells: [row.description, row.quantity, row.unitPrice],
  }));
  return {
    columns: [0, 1, 2].map((ordinal) => ({
      columnId: ID("g", ordinal + 1),
      identifier: COLUMN_IDENTIFIERS[ordinal],
      ordinal,
    })),
    headerMarkers,
    repeatedHeaderSignature: {
      columnOrder: ["description", "quantity", "unitPrice"],
      repeatedHeaderPolicy: pages.length > 1 ? "REQUIRED" : "ABSENT",
      headerRowCount: Math.max(1, pages.length),
      continuationPageCount: Math.max(0, pages.length - 1),
    },
    splitRowPolicy: split_row_policy(fragments),
  };
}

/** Backward-compatible camelCase alias for the LearnedTable population helper. */
export const populateLearnedTable = populate_learned_table;

export function analyzeInvoiceEvidenceLines(lines) {
  const input = Array.isArray(lines) ? lines : [];
  const parsed = input.some((line) => Array.isArray(line?.ocrTokens))
    ? parseOcrRows(input)
    : parseRows(input);
  const unsupported = [...parsed.issues];
  if (isCreditNote(input) || isNegativeInput(input))
    unsupported.push("CREDIT_NOTE");
  return {
    rows: parsed.rows,
    table: populate_learned_table(parsed.headers, parsed.rows),
    reviewReasons: [...new Set(unsupported)],
    recordOutcome: unsupported.length
      ? unsupported.includes("CREDIT_NOTE")
        ? "UNSUPPORTED"
        : "REVIEW_REQUIRED"
      : "EXTRACTED_UNTRUSTED",
  };
}

function emptyInvoiceRecord() {
  return {
    supplier: MISSING(),
    invoiceNumber: MISSING(),
    invoiceDate: MISSING(),
    currency: MISSING(),
    taxableBase: MISSING(),
    taxes: MISSING(),
    total: MISSING(),
    lineItems: [emptyRow()],
  };
}

function unavailableOcrEvidence(documentId, documentSha256) {
  return {
    invoiceEvidenceSchemaVersion: "1",
    documentId,
    documentSha256,
    extractionMode: "OCR_REQUIRED_UNAVAILABLE",
    pageCount: 1,
    extractedCharacterCount: 0,
    iso4217Snapshot: {
      version: ISO_SNAPSHOT.version,
      checksumSha256: ISO_SNAPSHOT.checksumSha256,
    },
    supplierCandidate: null,
    record: emptyInvoiceRecord(),
    table: analyzeInvoiceEvidenceLines([]).table,
    confidenceBps: 0,
    recordOutcome: "UNSUPPORTED",
    reviewReasons: ["NON_DIGITAL_INPUT"],
    untrusted: true,
    vendor: null,
  };
}

function ocrConfidenceBps(tokens) {
  if (!tokens.length) return 0;
  const weighted = tokens.map(({ token, rect }) => {
    const raw = Number(token.confidenceBps ?? token.confidence ?? 0);
    const confidence = Number.isFinite(raw)
      ? Math.max(
          0,
          Math.min(10000, raw > 100 ? Math.round(raw) : Math.round(raw * 100)),
        )
      : 0;
    return { confidence, area: Math.max(1, rect.width * rect.height) };
  });
  const area = weighted.reduce((sum, value) => sum + value.area, 0);
  return Math.min(
    10000,
    Math.round(
      weighted.reduce((sum, value) => sum + value.confidence * value.area, 0) /
        area,
    ),
  );
}

export async function extractInvoiceEvidence(
  buffer,
  {
    documentId,
    digitalExtractor,
    ocrExtractor,
    ocrOptions,
    scalarLabelsExtension,
  } = {},
) {
  assertDocumentId(documentId);
  const documentSha256 = createHash("sha256").update(buffer).digest("hex");
  const extracted = await (digitalExtractor ?? extractTextFromPdf)(buffer, {
    maxPages: 100,
    maxChars: 80_000,
  });
  let lines = Array.isArray(extracted.pageLines) ? extracted.pageLines : [];
  let text = extracted.text ?? "";
  let extractionMode = "DIGITAL_TEXT";
  let ocrTokens = [];
  let ocrConfidence = null;
  let positionalFields = null;
  let regexFallbackFields = null;
  let positionalExtractionValid = false;
  let ocrTextProvided = false;
  let pageCount = extracted.pages || 1;
  // Detect vendor and build extraction options once
  const detectedVendor =
    text && text.trim() ? (detectVendor(text) ?? null) : null;
  const extractionOptions = scalarLabelsExtension?.length
    ? { scalarLabelsOverride: scalarLabelsExtension, vendor: detectedVendor }
    : null;
  if (text.trim().length === 0) {
    const ocr = await (ocrExtractor ?? extractOcrFromPdfPage)(
      buffer,
      1,
      ocrOptions,
    );
    if (ocr?.error) return unavailableOcrEvidence(documentId, documentSha256);
    extractionMode = "OCR";
    ocrTextProvided =
      typeof ocr?.text === "string" && ocr.text.trim().length > 0;
    ocrTokens = Array.isArray(ocr?.tokens) ? ocr.tokens : [];
    try {
      positionalFields = extractInvoiceFieldsPositional(
        {
          tokens: ocrTokens,
          pageWidth: ocr?.pageWidth,
          pageHeight: ocr?.pageHeight,
        },
        extractionOptions,
      );
      positionalExtractionValid = true;
    } catch {
      positionalFields = null;
    }
    try {
      const materialized = materializeOcrEvidence(ocrTokens, {
        pageWidth: ocr?.pageWidth,
        pageHeight: ocr?.pageHeight,
      });
      lines = materialized.lines;
      ocrTokens = materialized.tokens;
      text =
        typeof ocr?.text === "string" && ocr.text.trim()
          ? ocr.text
          : ocrTokens.map(({ token }) => token.text.trim()).join(" ");
      if (positionalExtractionValid && positionalFields.matched.length === 0) {
        regexFallbackFields = extractInvoiceFields(text);
      }
      pageCount = materialized.pageCount;
      ocrConfidence = ocrConfidenceBps(ocrTokens);
    } catch {
      lines = [];
      text = "";
      ocrTokens = [];
      ocrConfidence = 0;
      return {
        ...unavailableOcrEvidence(documentId, documentSha256),
        extractionMode: "OCR",
        recordOutcome: "REVIEW_REQUIRED",
        reviewReasons: ["NON_DIGITAL_INPUT", "MISSING_EVIDENCE"],
      };
    }
  }
  const analysis = analyzeInvoiceEvidenceLines(lines);
  const supplierSource =
    lines.find(
      (line) =>
        line.text.trim() &&
        !/^(invoice|description|quantity|unit price|line total|invoice number|invoice date|currency|taxable base|taxes|total)\b/i.test(
          line.text.trim(),
        ),
    ) ?? null;
  const supplierName = supplierSource?.text.trim() || null;
  const supplierId = supplierName ? "sc_0000000000000000" : null;
  const supplierFragments = supplierSource
    ? evidenceFragmentsFor(supplierSource, 0)
    : [];
  const supplierCandidate =
    supplierName && supplierFragments.length
      ? {
          supplierCandidateId: supplierId,
          displayName: supplierName,
          evidence: supplierFragments,
        }
      : null;
  const scalarFields = positionalFields?.matched?.length
    ? positionalFields
    : regexFallbackFields;
  const scalarValue = (name) => {
    const value = ["subtotal", "tax", "total"].includes(name)
      ? (scalarFields?.totals?.[name] ?? null)
      : (scalarFields?.[name] ?? null);
    return ["subtotal", "tax", "total"].includes(name)
      ? canonicalNumber(value, 4)
      : value;
  };
  const scalarSource = (name) => {
    const match = scalarFields?.matched?.find((entry) => entry.label === name);
    if (!match) return null;
    if (match.bbox) {
      return (
        positionalFields?.lines?.find(
          (line) =>
            Math.abs((line.bbox?.x ?? -1) - match.bbox.x) < 0.01 &&
            Math.abs((line.bbox?.y ?? -1) - match.bbox.y) < 0.01,
        ) ?? null
      );
    }
    const value = scalarValue(name);
    if (value == null) return null;
    const candidates = lines.filter((line) => {
      const candidate = line.text.trim().replace(/^[\s$€]+|[\s$€]+$/g, "");
      return (
        candidate === String(value) || canonicalNumber(candidate, 4) === value
      );
    });
    return candidates.length === 1 ? candidates[0] : null;
  };
  const field = (expression, normalizer, ordinal, fallback = "NOT_FOUND") => {
    const source = lineSource(lines, expression);
    const raw = source?.text.match(expression)?.[1] ?? null;
    return fieldEnvelope(
      raw == null ? null : normalizer(raw),
      source,
      ordinal,
      fallback,
    );
  };
  const dateSource = lineSource(lines, /invoice\s+date\s*:/i);
  const dateRaw =
    dateSource?.text.match(/invoice\s+date\s*:\s*(\S+)/i)?.[1] ?? null;
  const currencySource = lineSource(lines, /currency\s*:/i);
  const currencyRaw =
    currencySource?.text.match(/currency\s*:\s*(\S+)/i)?.[1] ?? null;
  const record = {
    supplier:
      supplierName && supplierFragments.length
        ? PRESENT(
            { supplierCandidateId: supplierId, displayName: supplierName },
            supplierFragments,
          )
        : MISSING(supplierName ? "EVIDENCE_MISSING" : "NOT_FOUND"),
    invoiceNumber:
      extractionMode === "OCR" && scalarFields?.matched?.length
        ? fieldEnvelope(
            scalarValue("invoiceNumber"),
            scalarSource("invoiceNumber"),
            1,
          )
        : field(/invoice\s+number\s*:\s*([^\s]+)/i, (v) => v.trim(), 1),
    invoiceDate:
      extractionMode === "OCR" && scalarFields?.matched?.length
        ? fieldEnvelope(
            scalarValue("invoiceDate"),
            scalarSource("invoiceDate"),
            2,
          )
        : fieldEnvelope(
            dateRaw && validDate(dateRaw) ? dateRaw : null,
            dateSource,
            2,
            dateRaw ? "INVALID_FORMAT" : "NOT_FOUND",
          ),
    currency: fieldEnvelope(
      currencyRaw &&
        /^[A-Z]{3}$/.test(currencyRaw) &&
        ISO_CODES.has(currencyRaw)
        ? currencyRaw
        : null,
      currencySource,
      3,
      currencyRaw ? "UNSUPPORTED" : "NOT_FOUND",
    ),
    taxableBase:
      extractionMode === "OCR" && scalarValue("subtotal") != null
        ? fieldEnvelope(scalarValue("subtotal"), scalarSource("subtotal"), 4)
        : field(
            /taxable\s+base\s*:\s*([+-]?[\d.,]+)/i,
            (v) => canonicalNumber(v, 4),
            4,
            "INVALID_FORMAT",
          ),
    taxes:
      extractionMode === "OCR" && scalarValue("tax") != null
        ? fieldEnvelope(scalarValue("tax"), scalarSource("tax"), 5)
        : field(
            /tax(?:es)?\s*:\s*([+-]?[\d.,]+)/i,
            (v) => canonicalNumber(v, 4),
            5,
            "INVALID_FORMAT",
          ),
    total:
      extractionMode === "OCR" && scalarValue("total") != null
        ? fieldEnvelope(scalarValue("total"), scalarSource("total"), 6)
        : field(
            /^total\s*:\s*([+-]?[\d.,]+)/i,
            (v) => canonicalNumber(v, 4),
            6,
            "INVALID_FORMAT",
          ),
    lineItems: analysis.rows.length
      ? analysis.rows
      : [
          emptyRow(
            extractionMode === "OCR" && ocrTokens.length
              ? "EVIDENCE_MISSING"
              : "NOT_FOUND",
          ),
        ],
  };
  const semanticReasons = [...analysis.reviewReasons];
  if (extractionMode === "OCR") semanticReasons.push("NON_DIGITAL_INPUT");
  if (extractionMode === "OCR" && ocrTokens.length === 0)
    semanticReasons.push("MISSING_EVIDENCE");
  if (
    [record.taxableBase, record.taxes, record.total].every(
      (value) => value.state === "PRESENT",
    ) &&
    addDecimal(record.taxableBase.value, record.taxes.value) !==
      record.total.value
  )
    semanticReasons.push("ARITHMETIC_INVALID");
  const reasons = missingReasons(
    record,
    text.trim().length > 0,
    semanticReasons,
  );
  const valueCount = 7 + record.lineItems.length * 3;
  const presentCount =
    Object.values(record).filter(
      (v) => !Array.isArray(v) && v.state === "PRESENT",
    ).length +
    record.lineItems.reduce(
      (count, row) =>
        count +
        [row.description, row.quantity, row.unitPrice].filter(
          (v) => v.state === "PRESENT",
        ).length,
      0,
    );
  const unsupported = reasons.some((reason) =>
    ["CREDIT_NOTE", "UNSUPPORTED_STRUCTURE"].includes(reason),
  );
  return {
    invoiceEvidenceSchemaVersion: "1",
    documentId,
    documentSha256,
    extractionMode,
    pageCount: Math.max(1, Math.min(100, pageCount)),
    extractedCharacterCount: Math.min(80_000, text.length),
    iso4217Snapshot: {
      version: ISO_SNAPSHOT.version,
      checksumSha256: ISO_SNAPSHOT.checksumSha256,
    },
    supplierCandidate,
    record,
    table: analysis.table,
    confidenceBps:
      ocrConfidence ?? Math.round((presentCount / valueCount) * 10_000),
    recordOutcome:
      extractionMode === "OCR"
        ? ocrTokens.length &&
          (ocrTextProvided ||
            analysis.reviewReasons.length ||
            ocrTokens.length <= 2 ||
            positionalFields?.invoiceNumber ||
            positionalFields?.totals?.subtotal ||
            positionalFields?.totals?.tax)
          ? "REVIEW_REQUIRED"
          : "UNSUPPORTED"
        : reasons.length
          ? unsupported || !text.trim()
            ? "UNSUPPORTED"
            : "REVIEW_REQUIRED"
          : "EXTRACTED_UNTRUSTED",
    reviewReasons: reasons,
    untrusted: true,
    vendor: detectedVendor,
  };
}

export const produceInvoiceEvidence = extractInvoiceEvidence;
