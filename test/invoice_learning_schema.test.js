import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const ROOT = resolve(import.meta.dirname, "..");
const CONTRACT = resolve(ROOT, "contracts/invoice-learning/v1");
const PATHS = {
  invoice: resolve(CONTRACT, "invoice-learning.schema.json"),
  template: resolve(CONTRACT, "template.schema.json"),
  proposal: resolve(CONTRACT, "proposal.schema.json"),
};
function load(name) {
  return JSON.parse(readFileSync(PATHS[name], "utf8"));
}
function visitSchemas(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value.type === "object") {
    assert.equal(value.additionalProperties, false, "normative objects must be closed");
    assert.deepEqual(value.required, Object.keys(value.properties), "required members must equal declared members");
  }
  if (value.nullable !== undefined) assert.fail("OpenAPI nullable is not valid JSON Schema nullability");
  for (const child of Object.values(value)) visitSchemas(child, seen);
}
function keys(schema, definition) {
  return Object.keys(schema.$defs[definition].properties);
}
const EXPECTED = {
  invoice: {
    NormalizedRectV1: ["x", "y", "width", "height"],
    EvidenceFragmentV1: ["evidenceId", "page", "rect", "localRef"],
    LineItemV1: ["rowId", "page", "ordinal", "description", "quantity", "unitPrice"],
    ExtractedInvoiceRecordV1: ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total", "lineItems"],
    InvoiceEvidenceV1: ["invoiceEvidenceSchemaVersion", "documentId", "documentSha256", "extractionMode", "pageCount", "extractedCharacterCount", "iso4217Snapshot", "supplierCandidate", "record", "table", "confidenceBps", "recordOutcome", "reviewReasons", "untrusted", "vendor"],
  },
  template: {
    AnchorV1: ["identifier", "role", "pageRelation", "rectangle", "toleranceBps"],
    FieldSelectorV1: ["kind", "target", "identifier", "occurrence", "normalization"],
    TemplateSelectorsV1: ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total", "lineItems"],
    TemplateV1: ["templateSchemaVersion", "executionPolicyVersion", "templateId", "matchingKey", "parentTemplateId", "selectors", "requiredAnchors", "optionalAnchors", "repeatedHeaderSignature", "columnOrder", "confidenceFloorBps", "layoutFingerprint", "provenance"],
  },
  proposal: {
    ProposalSuggestionV1: ["templateSchemaVersion", "executionPolicyVersion", "selectors", "repeatedHeaderSignature", "columnOrder"],
    ProposalProjectionV1: ["projectionSchemaVersion", "templateSchemaVersion", "proposalResponseSchemaVersion", "purpose", "transactionId", "documentId", "projectionSha256", "matchingKey", "providerId", "modelId", "policyVersion", "disclosureVersion", "expiresAt", "tokens", "groups", "relationships", "counts"],
    ProjectionHashInputV1: ["projectionSchemaVersion", "tokens", "groups", "relationships", "counts"],
  },
};
test("the three documents are Draft 2020-12 closed schemas", () => {
  for (const schema of Object.values(PATHS).map((_, i) => load(Object.keys(PATHS)[i]))) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(typeof schema.$ref, "string");
    visitSchemas(schema);
  }
});
test("normative aliases have exact member sets", () => {
  for (const [document, definitions] of Object.entries(EXPECTED)) {
    const schema = load(document);
    for (const [definition, members] of Object.entries(definitions)) {
      assert.deepEqual(keys(schema, definition), members, `${document}.${definition}`);
    }
  }
});
test("evidence, template, and proposal literals are closed and versioned", () => {
  const invoice = load("invoice");
  const template = load("template");
  const proposal = load("proposal");
  assert.deepEqual(invoice.$defs.InvoiceEvidenceV1.properties.untrusted.const, true);
  assert.deepEqual(invoice.$defs.InvoiceEvidenceV1.properties.extractionMode.enum, ["DIGITAL_TEXT", "OCR", "OCR_REQUIRED_UNAVAILABLE"]);
  assert.deepEqual(invoice.$defs.InvoiceEvidenceV1.properties.recordOutcome.enum, ["EXTRACTED_UNTRUSTED", "REVIEW_REQUIRED", "LOW_CONFIDENCE", "LAYOUT_MISMATCH", "UNSUPPORTED", "FAILURE", "PROTOCOL_MISMATCH"]);
  assert.deepEqual(template.$defs.TemplateV1.properties.templateSchemaVersion.const, "1");
  assert.deepEqual(template.$defs.TemplateV1.properties.executionPolicyVersion.const, "1");
  assert.deepEqual(proposal.$defs.ProposalSuggestionV1.properties.columnOrder.const, ["description", "quantity", "unitPrice"]);
  assert.deepEqual(proposal.$defs.ProposalProjectionV1.properties.purpose.const, "invoice_template_proposal");
});
test("bounds and explicit nullability are encoded without loose sentinels", () => {
  const invoice = load("invoice");
  const template = load("template");
  assert.equal(invoice.$defs.InvoiceEvidenceV1.properties.pageCount.maximum, 100);
  assert.equal(invoice.$defs.InvoiceEvidenceV1.properties.extractedCharacterCount.maximum, 80000);
  assert.equal(invoice.$defs.LineItemV1.properties.ordinal.maximum, 4095);
  assert.equal(invoice.$defs.ExtractedInvoiceRecordV1.properties.lineItems.maxItems, 500);
  assert.equal(template.$defs.TemplateV1.properties.parentTemplateId.anyOf[1].type, "null");
  assert.equal(invoice.$defs.InvoiceEvidenceV1.properties.supplierCandidate.anyOf[1].type, "null");
  for (const [name] of Object.entries(PATHS)) {
    const raw = readFileSync(PATHS[name], "utf8");
    assert.doesNotMatch(raw, /\"nullable\"|\"additionalProperties\":true/);
  }
});
test("a duplicate-key payload is rejected before JSON parsing", () => {
  const raw = '{"invoiceEvidenceSchemaVersion":"1","invoiceEvidenceSchemaVersion":"1"}';
  const duplicate = /\"([^\"]+)\"\s*:\s*[^,}]+,\s*\"\1\"\s*:/s;
  assert.match(raw, duplicate);
  assert.throws(() => {
    if (duplicate.test(raw)) throw new Error("duplicate_key");
    JSON.parse(raw);
  }, /duplicate_key/);
});
