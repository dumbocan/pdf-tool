import { randomBytes } from "node:crypto";

export const DIAGNOSTIC_PREFIX = "NELUPDF_DIAG ";
export const DIAGNOSTIC_SCHEMA_VERSION = 1;
export const MAX_DIAGNOSTIC_BYTES = 4096;

const COMPONENTS = new Set(["node", "rust", "frontend"]);
const OUTCOMES = new Set(["started", "success", "failed", "skipped", "cancelled"]);
export const DIAGNOSTIC_STAGES = new Set([
  "selected", "queued", "read_started", "read_completed", "registration_started",
  "registration_completed", "registration_failed", "extraction_started",
  "extraction_completed", "extraction_failed", "review_requested", "review_rendered",
  "review_closed", "review_confirmed", "review_pdf_load_started", "review_pdf_load_completed",
  "review_pdf_load_failed", "review_page_render_started", "review_page_render_completed",
  "review_page_render_failed", "result_committed", "cancellation", "batch_completed",
  "command_register", "command_extract", "command_response", "sidecar_started",
  "sidecar_completed", "sidecar_timeout", "sidecar_stderr_discarded", "pdf_validated",
  "pdf_loaded", "page_progress", "digital_summary", "ocr_decision", "ocr_started",
  "ocr_fallback", "ocr_completed", "ocr_failed", "positional_grouped", "parser_candidates",
  "parser_selected", "fields_matched", "response_completed", "response_failed",
]);
const METRIC_KEYS = new Set([
  "bytes", "pages", "currentPage", "chars", "textItems", "lines", "candidates", "matched", "elapsedMs",
  "bboxPresent", "bboxMissing", "parserId", "extractionMode", "status", "errorCode",
  "matchedLabels",
]);
const STRING_METRICS = new Set(["parserId", "extractionMode", "status", "errorCode"]);
export const DIAGNOSTIC_STRING_ALLOWLISTS = Object.freeze({
  parserId: new Set(["plain-text", "invoice-fields", "mercadona-tabular", "mercadona", "miller-tabular", "empark-tabular", "acastimar-tabular", "doctoragua-tabular"]),
  extractionMode: new Set(["digital_text", "ocr", "ocr_required_unavailable"]),
  status: new Set(["complete", "truncated", "partial"]),
  errorCode: new Set(["internal", "registration_failed", "drag_drop_listener", "engine_unavailable", "engine_lost", "timeout", "invalid_pdf", "pdf_parse_failed", "ocr_empty", "ocr_timeout", "ocr_output_too_large", "ocr_engine_error", "ocr_language_missing", "ocr_unavailable", "ocr_invalid_input", "input_too_large", "page_limit", "response_too_large", "capacity_exhausted", "ocr_resource_limit", "invalid_request", "unauthorized_document", "protocol_mismatch", "cancelled", "review_pdf_load_failed", "review_page_render_failed", "canvas_unavailable", "review_cancelled"]),
  matchedLabels: new Set(["invoiceNumber", "invoiceDate", "simplifiedInvoiceDate", "subtotal", "tax", "total", "taxLabel"]),
});

export function createOperationCorrelationId() {
  return randomBytes(16).toString("base64url");
}

export function validateDiagnosticEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("diagnostic_invalid");
  const keys = new Set(Object.keys(event));
  if (keys.size !== 8 || !["schemaVersion", "timestamp", "component", "stage", "outcome", "elapsedMs", "operationCorrelationId", "metrics"].every((key) => keys.has(key))) throw new Error("diagnostic_fields");
  if (event.schemaVersion !== DIAGNOSTIC_SCHEMA_VERSION || typeof event.timestamp !== "string" || event.timestamp.length === 0 || event.timestamp.length > 40) throw new Error("diagnostic_version");
  if (!COMPONENTS.has(event.component) || !DIAGNOSTIC_STAGES.has(event.stage) || !OUTCOMES.has(event.outcome)) throw new Error("diagnostic_enum");
  if (!Number.isInteger(event.elapsedMs) || event.elapsedMs < 0 || event.elapsedMs > 86_400_000) throw new Error("diagnostic_elapsed");
  if (typeof event.operationCorrelationId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(event.operationCorrelationId)) throw new Error("diagnostic_correlation");
  if (!event.metrics || typeof event.metrics !== "object" || Array.isArray(event.metrics)) throw new Error("diagnostic_metrics");
  for (const [key, value] of Object.entries(event.metrics)) {
    if (!METRIC_KEYS.has(key)) throw new Error("diagnostic_metric_fields");
    if (key === "matchedLabels") {
      if (!Array.isArray(value) || value.length > 32 || value.some((label) => !DIAGNOSTIC_STRING_ALLOWLISTS.matchedLabels.has(label))) throw new Error("diagnostic_metric_value");
    } else if (STRING_METRICS.has(key) ? typeof value !== "string" || !DIAGNOSTIC_STRING_ALLOWLISTS[key].has(value) : !Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("diagnostic_metric_value");
  }
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_DIAGNOSTIC_BYTES) throw new Error("diagnostic_size");
  return event;
}

export function diagnosticLine(stage, outcome, metrics = {}, operationCorrelationId, elapsedMs = 0) {
  const event = validateDiagnosticEvent({
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    timestamp: new Date().toISOString(),
    component: "node",
    stage,
    outcome,
    elapsedMs,
    operationCorrelationId: operationCorrelationId ?? createOperationCorrelationId(),
    metrics,
  });
  return `${DIAGNOSTIC_PREFIX}${JSON.stringify(event)}\n`;
}

export function emitDiagnostic(stage, outcome, metrics, operationCorrelationId, elapsedMs) {
  try { process.stderr.write(diagnosticLine(stage, outcome, metrics, operationCorrelationId, elapsedMs)); } catch { /* diagnostics are non-fatal */ }
}
