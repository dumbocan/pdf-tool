import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { extractInvoiceEvidence } from "../src/invoice-evidence.js";
import { layoutFingerprint, replayTemplate } from "../src/template-replay.js";

const FIRST = readFileSync(new URL("../fixtures/invoice-learning/synthetic.same-layout.first.pdf", import.meta.url));
const SECOND = readFileSync(new URL("../fixtures/invoice-learning/synthetic.same-layout.second.pdf", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(new URL("../contracts/invoice-learning/v1/corpus-manifest.json", import.meta.url), "utf8"));
const SECOND_HASH = "89fc51ae2e874ab46450fc14ce1d1110ccf68b496d13eaa06a8ba95e8d68d7fa";
const DOCUMENT_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const MATCHING_KEY = `sup_${"4".repeat(32)}`;
const fieldNames = ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total"];
const anchorId = (index) => `a_${index.toString(16).padStart(16, "0")}`;

function templateFor(evidence) {
  const anchors = fieldNames.map((name, index) => ({
    identifier: anchorId(index),
    role: "FIELD_LABEL",
    pageRelation: "ANY_PAGE",
    rectangle: { ...evidence.record[name].evidence[0].rect },
    toleranceBps: { x: 200, y: 200 },
  }));
  const tableAnchor = anchorId(fieldNames.length);
  anchors.push({
    identifier: tableAnchor,
    role: "TABLE_HEADER",
    pageRelation: "ANY_PAGE",
    rectangle: { ...evidence.record.lineItems[0].description.evidence[0].rect },
    toleranceBps: { x: 200, y: 200 },
  });
  const selectors = Object.fromEntries(fieldNames.map((name, index) => [name, {
    kind: "FIELD", target: name, identifier: anchorId(index), occurrence: "FIRST", normalization: [],
  }]));
  selectors.lineItems = {
    rowSelector: { kind: "ROWS", tableEvidence: "LOCAL_TABLE", headerIdentifier: tableAnchor, requiredHeaderPolicy: "REQUIRED", rowOrder: "SOURCE_ORDER" },
    description: { kind: "CELL", column: "description", identifier: tableAnchor, occurrence: "ROW_ORDER", normalization: [] },
    quantity: { kind: "CELL", column: "quantity", identifier: tableAnchor, occurrence: "ROW_ORDER", normalization: [] },
    unitPrice: { kind: "CELL", column: "unitPrice", identifier: tableAnchor, occurrence: "ROW_ORDER", normalization: [] },
  };
  const template = {
    templateSchemaVersion: "1", executionPolicyVersion: "1",
    templateId: `tpl_${"5".repeat(32)}`, matchingKey: MATCHING_KEY, parentTemplateId: null,
    selectors, requiredAnchors: anchors, optionalAnchors: [],
    repeatedHeaderSignature: evidence.table.repeatedHeaderSignature,
    columnOrder: ["description", "quantity", "unitPrice"], confidenceFloorBps: 9000,
    layoutFingerprint: "0".repeat(64),
    provenance: { source: "MANUAL", actionId: `act_${"6".repeat(32)}`, createdAt: "2026-01-01T00:00:00.000Z" },
  };
  template.layoutFingerprint = layoutFingerprint(template);
  return template;
}

test("replays the approved second fixture locally with zero corrections before review", async () => {
  const manifestBefore = structuredClone(MANIFEST);
  assert.deepEqual(MANIFEST.entries.map(({ entryId }) => entryId), [
    "synthetic.same-layout.first", "synthetic.same-layout.second",
    "private.same-layout.first", "private.same-layout.second",
  ]);
  assert.equal(MANIFEST.entries[1].pdfSha256, SECOND_HASH);
  assert.equal(createHash("sha256").update(SECOND).digest("hex"), SECOND_HASH);

  const firstEvidence = await extractInvoiceEvidence(FIRST, { documentId: DOCUMENT_ID });
  const secondEvidence = await extractInvoiceEvidence(SECOND, { documentId: DOCUMENT_ID });
  const template = templateFor(firstEvidence);
  const replay = replayTemplate(secondEvidence, template, {
    approvedProjection: {
      matchingKey: MATCHING_KEY,
      pdfSha256: SECOND_HASH,
      layoutVersion: "A3-LAYOUT-V1",
      currency: "EUR",
      expectedRowCount: 3,
    },
  });

  assert.equal(replay.replayOutcome, "REPLAY_LOCAL");
  assert.equal(replay.templateId, template.templateId);
  assert.equal(replay.layoutFingerprint, template.layoutFingerprint);
  assert.deepEqual(replay.replayCounters, {
    providerRequestCount: 0,
    automaticCorrectionCount: 0,
    userEditCount: 0,
  });
  assert.equal(replay.invoiceEvidence.record.invoiceNumber.value, "SYN-2026-002");
  assert.equal(replay.invoiceEvidence.record.invoiceNumber.provenance, "REPLAY_LOCAL");
  assert.equal(replay.invoiceEvidence.record.lineItems.length, 3);
  assert.equal(template.matchingKey, MATCHING_KEY);
  assert.equal(secondEvidence.record.invoiceNumber.provenance, "EXTRACTED_LOCAL");
  assert.deepEqual(MANIFEST, manifestBefore);
});

test("keeps the approved version unchanged and routes a mismatch to review", async () => {
  const evidence = await extractInvoiceEvidence(SECOND, { documentId: DOCUMENT_ID });
  const template = templateFor(await extractInvoiceEvidence(FIRST, { documentId: DOCUMENT_ID }));
  const before = structuredClone(template);
  const mismatch = replayTemplate(evidence, template, {
    approvedProjection: { matchingKey: `sup_${"7".repeat(32)}` },
  });

  assert.equal(mismatch.replayOutcome, "LAYOUT_MISMATCH");
  assert.deepEqual(template, before);
  assert.deepEqual(mismatch.replayCounters, {
    providerRequestCount: 0,
    automaticCorrectionCount: 0,
    userEditCount: 0,
  });
});
