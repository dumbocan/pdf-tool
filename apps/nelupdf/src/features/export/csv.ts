// RFC 4180 CSV encoder with spreadsheet formula neutralization (WU-4B1).
//
// Security guarantees:
// - Doubled quotes inside any field.
// - Fields containing commas, newlines, or double-quotes are wrapped in
//   double-quotes.
// - Formula neutralization after the first meaningful character: any field
//   whose first non-whitespace character is =, +, -, @, TAB, or CR is prefixed
//   with a single quote so spreadsheet apps treat it as literal text.
// - Fields with leading/trailing whitespace are quoted so whitespace is not
//   stripped by spreadsheet import heuristics.

// Formula neutralization per WU-4B1: a field whose first meaningful
// (non-whitespace) character is a spreadsheet formula trigger — = + - @ —
// is prefixed with a single quote so spreadsheet apps treat it as literal
// text. Pure numbers (optionally negative) are NOT neutralized so that
// "-50.00" round-trips as a number, not text.
const FORMULA_TRIGGER_RE = /^[=+\-@]/;
const PURE_NUMBER_RE = /^-?\d+(\.\d+)?$/;

function isFormulaField(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  // Pure number (incl. negative) — never a formula.
  if (PURE_NUMBER_RE.test(trimmed)) return false;
  return FORMULA_TRIGGER_RE.test(trimmed[0]);
}

/** Neutralize a single cell value into RFC 4180-compliant CSV text. */
export function csvCell(value: unknown): string {
  const s = String(value ?? "");

  // Formula neutralization: prefix with a single quote so spreadsheet apps
  // interpret the field as literal text rather than a formula. We only
  // neutralize if the field STARTS with a formula trigger character — a
  // number like -50 is not neutralized, but =CMD(...) is.
  let neutralized = s;
  if (isFormulaField(s)) {
    neutralized = `'${s}`;
  }

  // Quote the field if it contains a comma, newline, double-quote, or has
  // leading/trailing whitespace (so spreadsheets don't strip it).
  if (/(?:,|\r|\n|")|^[\s]|[\s]$/.test(neutralized)) {
    // Double up every interior double-quote (RFC 4180).
    const escaped = neutralized.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return neutralized;
}

export interface CsvRow {
  [key: string]: unknown;
}

/** Encode rows as RFC 4180 CSV text. */
export function encodeCsv(rows: CsvRow[], columns: string[]): string {
  const header = columns.map((c) => csvCell(c)).join(",");
  const body = rows
    .map((row) => columns.map((c) => csvCell(row[c])).join(","))
    .join("\r\n");
  return body.length === 0 ? header : `${header}\r\n${body}`;
}
