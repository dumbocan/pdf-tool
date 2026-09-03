import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractInvoiceEvidence } from "../src/invoice-evidence.js";
import { approveTemplateDraft, layoutFingerprint, validateTemplateDraft } from "../src/template-replay.js";

const PDF = readFileSync(new URL("../fixtures/invoice-learning/synthetic.same-layout.first.pdf", import.meta.url));
const DOCUMENT_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const MATCHING_KEY = `sup_${"1".repeat(32)}`;
const id = (n) => `a_${n.toString(16).padStart(16, "0")}`;
const fields = ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total"];

function templateFor(evidence) {
  const anchors = fields.map((name, index) => ({ identifier: id(index), role: "FIELD_LABEL", pageRelation: "ANY_PAGE", rectangle: { ...evidence.record[name].evidence[0].rect }, toleranceBps: { x: 200, y: 200 } }));
  anchors.push({ identifier: id(7), role: "TABLE_HEADER", pageRelation: "ANY_PAGE", rectangle: { ...evidence.record.lineItems[0].description.evidence[0].rect }, toleranceBps: { x: 200, y: 200 } });
  const selectors = Object.fromEntries(fields.map((name, index) => [name, { kind: "FIELD", target: name, identifier: id(index), occurrence: "FIRST", normalization: [] }]));
  selectors.lineItems = {
    rowSelector: { kind: "ROWS", tableEvidence: "LOCAL_TABLE", headerIdentifier: id(7), requiredHeaderPolicy: "REQUIRED", rowOrder: "SOURCE_ORDER" },
    description: { kind: "CELL", column: "description", identifier: id(7), occurrence: "ROW_ORDER", normalization: [] },
    quantity: { kind: "CELL", column: "quantity", identifier: id(7), occurrence: "ROW_ORDER", normalization: [] },
    unitPrice: { kind: "CELL", column: "unitPrice", identifier: id(7), occurrence: "ROW_ORDER", normalization: [] },
  };
  const draft = {
    templateSchemaVersion: "1", executionPolicyVersion: "1", templateId: `tpl_${"1".repeat(32)}`, matchingKey: MATCHING_KEY, parentTemplateId: null,
    selectors, requiredAnchors: anchors, optionalAnchors: [], repeatedHeaderSignature: evidence.table.repeatedHeaderSignature,
    columnOrder: ["description", "quantity", "unitPrice"], confidenceFloorBps: 9000, layoutFingerprint: "0".repeat(64),
    provenance: { source: "MANUAL", actionId: `act_${"2".repeat(32)}`, createdAt: "2026-01-01T00:00:00.000Z" },
  };
  draft.layoutFingerprint = layoutFingerprint(draft);
  return draft;
}

test("first synthetic invoice supplies complete evidence for a manual learning decision", async () => {
  const evidence = await extractInvoiceEvidence(PDF, { documentId: DOCUMENT_ID });
  assert.equal(createHash("sha256").update(PDF).digest("hex"), "dfa6637854c9b70bdb1e053e2d4c2e22d97452dde8b23b0915d467a154162260");
  assert.equal(evidence.recordOutcome, "EXTRACTED_UNTRUSTED");
  assert.equal(evidence.untrusted, true);
  assert.equal(evidence.record.lineItems.length, 3);
  assert.ok(fields.every((name) => evidence.record[name].state === "PRESENT" && evidence.record[name].evidence.length > 0));
  assert.ok(evidence.record.lineItems.every((row) => [row.description, row.quantity, row.unitPrice].every((value) => value.state === "PRESENT" && value.evidence.length > 0)));
  assert.equal(evidence.record.supplier.value.displayName, "Demo Office Supplies Ltd.");
});

test("manual template approval is separate and produces an immutable value-free version", async () => {
  const evidence = await extractInvoiceEvidence(PDF, { documentId: DOCUMENT_ID });
  const draft = templateFor(evidence);
  assert.equal(validateTemplateDraft(draft), true);
  assert.throws(() => approveTemplateDraft({ state: "DRAFT", template: draft }, { recordConfirmed: false }));
  const approved = approveTemplateDraft({ state: "DRAFT", template: draft }, { recordConfirmed: true });
  assert.equal(Object.isFrozen(approved), true);
  assert.equal(approved.matchingKey, MATCHING_KEY);
  assert.equal(Object.hasOwn(approved, "invoiceNumber"), false);
  assert.throws(() => { approved.confidenceFloorBps = 0; }, TypeError);
});
