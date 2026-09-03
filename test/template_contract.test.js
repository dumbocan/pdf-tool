import assert from "node:assert/strict";
import test from "node:test";
import {
  approveTemplateDraft,
  layoutFingerprint,
  layoutFingerprintInput,
  validateTemplateDraft,
} from "../src/template-replay.js";

const id = (n) => `a_${n.toString(16).padStart(16, "0")}`;
const anchor = (identifier, role = "FIELD_LABEL") => ({
  identifier, role, pageRelation: "FIRST_PAGE",
  rectangle: { x: 100, y: 100, width: 500, height: 200 },
  toleranceBps: { x: 200, y: 200 },
});
const field = (target, identifier) => ({
  kind: "FIELD", target, identifier, occurrence: "FIRST", normalization: [],
});
function template() {
  const anchors = ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total"]
    .map((_, i) => anchor(id(i)));
  anchors.push(anchor(id(7), "TABLE_HEADER"));
  const selectors = Object.fromEntries([
    "supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total",
  ].map((name, i) => [name, field(name, anchors[i].identifier)]));
  return {
    templateSchemaVersion: "1", executionPolicyVersion: "1", templateId: `tpl_${"1".repeat(32)}`,
    matchingKey: `sup_${"2".repeat(32)}`, parentTemplateId: null,
    selectors: { ...selectors, lineItems: {
      rowSelector: { kind: "ROWS", tableEvidence: "LOCAL_TABLE", headerIdentifier: id(7), requiredHeaderPolicy: "REQUIRED", rowOrder: "SOURCE_ORDER" },
      description: { kind: "CELL", column: "description", identifier: id(7), occurrence: "ROW_ORDER", normalization: [] },
      quantity: { kind: "CELL", column: "quantity", identifier: id(7), occurrence: "ROW_ORDER", normalization: [] },
      unitPrice: { kind: "CELL", column: "unitPrice", identifier: id(7), occurrence: "ROW_ORDER", normalization: [] },
    } }, requiredAnchors: anchors, optionalAnchors: [],
    repeatedHeaderSignature: { columnOrder: ["description", "quantity", "unitPrice"], repeatedHeaderPolicy: "REQUIRED", headerRowCount: 1, continuationPageCount: 1 },
    columnOrder: ["description", "quantity", "unitPrice"], confidenceFloorBps: 9000,
    layoutFingerprint: "0".repeat(64), provenance: { source: "MANUAL", actionId: `act_${"3".repeat(32)}`, createdAt: "2026-01-01T00:00:00.000Z" },
  };
}

test("valid draft is closed and approval freezes an immutable template", () => {
  const draft = template();
  draft.layoutFingerprint = layoutFingerprint(draft);
  assert.equal(validateTemplateDraft(draft), true);
  const approved = approveTemplateDraft({ state: "DRAFT", template: draft }, { recordConfirmed: true });
  assert.equal(Object.isFrozen(approved), true);
  assert.equal(approved.layoutFingerprint, draft.layoutFingerprint);
  assert.throws(() => { approved.confidenceFloorBps = 1; }, TypeError);
});

test("fingerprint input is exactly structural and ignores volatile metadata", () => {
  const value = template();
  const input = layoutFingerprintInput(value);
  assert.deepEqual(Object.keys(input), ["invoiceEvidenceSchemaVersion", "templateSchemaVersion", "executionPolicyVersion", "matchingKey", "requiredAnchors", "optionalAnchors", "repeatedHeaderSignature", "columnOrder"]);
  const changed = { ...value, templateId: `tpl_${"9".repeat(32)}`, provenance: { ...value.provenance, actionId: `act_${"9".repeat(32)}` } };
  assert.equal(layoutFingerprint(value), layoutFingerprint(changed));
});

test("invalid selector grammar, geometry, normalization, and approval preconditions fail closed", () => {
  const bad = template();
  bad.layoutFingerprint = layoutFingerprint(bad);
  bad.selectors.currency.normalization = ["DECIMAL_COMMA_TO_DOT"];
  assert.throws(() => validateTemplateDraft(bad));
  const missingTolerance = template();
  delete missingTolerance.requiredAnchors[0].toleranceBps;
  assert.throws(() => validateTemplateDraft(missingTolerance));
  const draft = template();
  draft.layoutFingerprint = layoutFingerprint(draft);
  assert.throws(() => approveTemplateDraft({ state: "DRAFT", template: draft }, { recordConfirmed: false }));
});
