// Phase 2 of llm-assisted-parser-anonymized (TDD).
// Tests for the `proposeParserV1` operation core: fail-closed provider gate,
// re-sanitization boundary, adapter invocation, response validation, audit
// events, and typed error envelopes.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  handleProposeParserCore,
  validateProposeParserV1Request,
  validateSuggestionEntries,
  ProposeParserError,
} from "../src/propose-parser.js";

function frameMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32BE(payload.length, 0);
  payload.copy(buf, 4);
  return buf;
}

function parseFrame(buf) {
  const len = buf.readUInt32BE(0);
  return { json: JSON.parse(buf.slice(4, 4 + len).toString("utf8")) };
}

function runAdapter(inputBuf) {
  return new Promise((resolve) => {
    const proc = spawn("node", ["src/engine-stdio.js"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (d) => stdout.push(d));
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("close", (code) => {
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code });
    });
    proc.stdin.write(inputBuf);
    proc.stdin.end();
  });
}

const DOC_ID = "aB3_xY9kQr2TvW5nZ7pL1d"; // 22 chars, valid per assertDocumentId
const REQ_ID = "123e4567-e89b-42d3-a456-426614174000";

function makeRequest(overrides = {}) {
  return {
    protocolVersion: 1,
    requestId: REQ_ID,
    documentId: DOC_ID,
    documentSha256: "ab".repeat(32),
    extractionMode: "OCR",
    providerId: "minimax",
    modelId: "minimax-m3",
    anonymizedTokenStream: {
      pageWidth: 1000,
      pageHeight: 1000,
      tokens: [
        { text: "FACTURA", page: 1, bbox: { x: 10, y: 10, width: 50, height: 10 }, confidenceBps: 9500 },
        { text: "<ref>", page: 1, bbox: { x: 70, y: 10, width: 40, height: 10 }, confidenceBps: 9500 },
        { text: "Fecha", page: 1, bbox: { x: 10, y: 30, width: 40, height: 10 }, confidenceBps: 9500 },
        { text: "01/06/2026", page: 1, bbox: { x: 60, y: 30, width: 60, height: 10 }, confidenceBps: 9500 },
      ],
    },
    currentScalarLabels: {
      invoiceDate: "(?:fecha\\s+factura|date\\s+of\\s+issue)",
      invoiceNumber: "(?:n[º°]?\\s*factura|invoice\\s+number)",
      subtotal: "(?:base\\s+imponible|subtotal)",
      tax: "(?:igic|iva)",
      total: "(?:total)",
    },
    purpose: "parser_suggestion_v1",
    ...overrides,
  };
}

class FakeAudit {
  constructor() {
    this.events = [];
  }
  emit(event) {
    this.events.push(event);
  }
}

// --- 2.1: disabled provider → typed provider_disabled ---------------------

test("disabled provider → provider_disabled error, no adapter call", async () => {
  const audit = new FakeAudit();
  let adapterCalled = false;
  const result = await handleProposeParserCore(makeRequest(), {
    providerStatus: { status: "disabled", reason: "release_gate_pending" },
    adapter: async () => {
      adapterCalled = true;
      return { suggestion: { kind: "regex_table_extension", entries: [] } };
    },
    audit,
  });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "provider_disabled");
  assert.equal(adapterCalled, false, "adapter must not be called when disabled");
  assert.ok(audit.events.some((e) => e.kind === "proposeParserV1_registry_state"));
});

// --- 2.1: sanitization hole → sanitization_incomplete ---------------------

test("sanitization hole (raw PII in input) → sanitization_incomplete, adapter not called", async () => {
  const audit = new FakeAudit();
  let adapterCalled = false;
  // Force the sanitizer to NOT redact by passing a token the module does not
  // catch (this simulates a sanitization-hole path the audit re-scan catches).
  const req = makeRequest({
    anonymizedTokenStream: {
      pageWidth: 1000,
      pageHeight: 1000,
      tokens: [
        // A token that passes sanitization untouched (no PII pattern) is fine;
        // but to simulate a hole we feed an unsanitized NIF that MUST trip the
        // re-scan. sanitizeTokensForLLM WILL redact it, so to force the hole we
        // stub `sanitize` to pass the payload through unmodified.
        { text: "B12345678", page: 1, bbox: { x: 0, y: 0, width: 10, height: 10 }, confidenceBps: 9000 },
      ],
    },
  });
  const result = await handleProposeParserCore(req, {
    providerStatus: { status: "enabled" },
    sanitize: (tokens) => ({ tokens, audit: { placeholderCount: 0 } }), // no-op sanitizer = hole
    adapter: async () => {
      adapterCalled = true;
      return { suggestion: { kind: "regex_table_extension", entries: [] } };
    },
    audit,
  });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "sanitization_incomplete");
  assert.equal(adapterCalled, false, "adapter must not be called on sanitization hole");
  assert.ok(audit.events.some((e) => e.kind === "proposeParserV1_sanitization_call"));
});

// --- 2.1: valid sanitized input → success envelope ------------------------

test("valid sanitized input + enabled provider → success envelope with suggestion", async () => {
  const audit = new FakeAudit();
  const adapterEntries = [
    {
      field: "invoiceNumber",
      regex: "n[º°]?\\s*factura",
      labelLanguage: "es",
      evidenceShape: "alphanumeric_ref",
    },
  ];
  const result = await handleProposeParserCore(makeRequest(), {
    providerStatus: { status: "enabled" },
    adapter: async () => ({ suggestion: { kind: "regex_table_extension", entries: adapterEntries } }),
    audit,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data.suggestion.kind, "regex_table_extension");
  assert.equal(result.data.suggestion.entries.length, 1);
  assert.equal(result.data.suggestion.entries[0].field, "invoiceNumber");
  // Audit order: registry_state → sanitization_call → egress_attempt → egress_response
  const kinds = audit.events.map((e) => e.kind);
  const registryIdx = kinds.indexOf("proposeParserV1_registry_state");
  const sanitizeIdx = kinds.indexOf("proposeParserV1_sanitization_call");
  const egressIdx = kinds.indexOf("proposeParserV1_egress_attempt");
  const responseIdx = kinds.indexOf("proposeParserV1_egress_response");
  assert.ok(registryIdx >= 0 && sanitizeIdx > registryIdx && egressIdx > sanitizeIdx && responseIdx > egressIdx,
    `audit order wrong: ${kinds.join(", ")}`);
});

// --- 2.1: invalid LLM response → provider_response_invalid -----------------

test("malformed regex in suggestion → provider_response_invalid", async () => {
  const audit = new FakeAudit();
  const badEntries = [
    { field: "invoiceNumber", regex: "[unclosed", labelLanguage: "es", evidenceShape: "alphanumeric_ref" },
  ];
  const result = await handleProposeParserCore(makeRequest(), {
    providerStatus: { status: "enabled" },
    adapter: async () => ({ suggestion: { kind: "regex_table_extension", entries: badEntries } }),
    audit,
  });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "provider_response_invalid");
});

// --- 2.4: missing fields → invalid_request ---------------------------------

test("missing documentId → invalid_request", async () => {
  const req = makeRequest();
  delete req.documentId;
  const result = await handleProposeParserCore(req, { providerStatus: { status: "disabled" } });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "invalid_request");
});

// --- 2.4: token array exceeds 16384 → invalid_request ----------------------

test("token array exceeds 16384 → invalid_request before sanitization", async () => {
  const tokens = Array.from({ length: 16385 }, (_, i) => ({
    text: "x",
    page: 1,
    bbox: { x: i, y: 0, width: 1, height: 1 },
    confidenceBps: 9000,
  }));
  const req = makeRequest({
    anonymizedTokenStream: { pageWidth: 1000, pageHeight: 1000, tokens },
  });
  const result = await handleProposeParserCore(req, { providerStatus: { status: "disabled" } });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "invalid_request");
});

// --- 2.4: provider registry malformed → internal (defensive) ---------------

test("providerStatus missing → provider_disabled (defensive)", async () => {
  const result = await handleProposeParserCore(makeRequest(), { providerStatus: null });
  assert.equal(result.status, "error");
  assert.equal(result.error.code, "provider_disabled");
});

// --- direct validator unit tests -------------------------------------------

test("validateSuggestionEntries accepts a valid entry", () => {
  assert.equal(
    validateSuggestionEntries([
      { field: "invoiceNumber", regex: "n[º°]?\\s*factura", labelLanguage: "es", evidenceShape: "alphanumeric_ref" },
    ]),
    true,
  );
});

test("validateSuggestionEntries rejects unknown field", () => {
  assert.throws(
    () => validateSuggestionEntries([
      { field: "notAField", regex: "x", labelLanguage: "es", evidenceShape: "amount" },
    ]),
    (err) => err instanceof ProposeParserError && err.code === "provider_response_invalid",
  );
});

test("validateSuggestionEntries rejects catastrophic regex constructs", () => {
  // Backreference-heavy or greedy constructs are outside the allowed char set.
  assert.throws(
    () => validateSuggestionEntries([
      { field: "invoiceNumber", regex: "(a+)+$", labelLanguage: "es", evidenceShape: "alphanumeric_ref" },
    ]),
    (err) => err instanceof ProposeParserError && err.code === "provider_response_invalid",
  );
});

test("validateProposeParserV1Request accepts the happy-path request", () => {
  assert.equal(validateProposeParserV1Request(makeRequest()), true);
});

test("validateProposeParserV1Request rejects lowercase extractionMode", () => {
  const req = makeRequest({ extractionMode: "ocr" });
  assert.throws(() => validateProposeParserV1Request(req), ProposeParserError);
});
