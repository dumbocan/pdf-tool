import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import test from "node:test";
import { extractInvoiceEvidence } from "../src/invoice-evidence.js";
import { layoutFingerprint, replayTemplate } from "../src/template-replay.js";
import { parseFrame } from "../src/engine-protocol.js";

const PDF = readFileSync(new URL("../fixtures/invoice-learning/synthetic.same-layout.second.pdf", import.meta.url));
const ID = "AAAAAAAAAAAAAAAAAAAAAA";
const KEY = `sup_${"2".repeat(32)}`;
const aid = (n) => `a_${n.toString(16).padStart(16, "0")}`;
const rect = (e) => ({ ...e.evidence[0].rect });
const documentRef = { documentId: ID, name: "second.pdf", byteLength: PDF.length, sha256: createHash("sha256").update(PDF).digest("hex"), pdfBase64: PDF.toString("base64") };

function templateFor(evidence, optional = false) {
  const names = ["supplier", "invoiceNumber", "invoiceDate", "currency", "taxableBase", "taxes", "total"];
  const anchors = names.map((name, i) => ({ identifier: aid(i), role: "FIELD_LABEL", pageRelation: "ANY_PAGE", rectangle: rect(evidence.record[name]), toleranceBps: { x: 200, y: 200 } }));
  anchors.push({ identifier: aid(7), role: "TABLE_HEADER", pageRelation: "ANY_PAGE", rectangle: rect(evidence.record.lineItems[0].description), toleranceBps: { x: 200, y: 200 } });
  if (optional) anchors.push({ identifier: aid(8), role: "FIELD_LABEL", pageRelation: "ANY_PAGE", rectangle: { x: 9990, y: 9990, width: 10, height: 10 }, toleranceBps: { x: 0, y: 0 } });
  const selectors = Object.fromEntries(names.map((name, i) => [name, { kind: "FIELD", target: name, identifier: aid(i), occurrence: "FIRST", normalization: [] }]));
  selectors.lineItems = { rowSelector: { kind: "ROWS", tableEvidence: "LOCAL_TABLE", headerIdentifier: aid(7), requiredHeaderPolicy: "REQUIRED", rowOrder: "SOURCE_ORDER" }, description: { kind: "CELL", column: "description", identifier: aid(7), occurrence: "ROW_ORDER", normalization: [] }, quantity: { kind: "CELL", column: "quantity", identifier: aid(7), occurrence: "ROW_ORDER", normalization: [] }, unitPrice: { kind: "CELL", column: "unitPrice", identifier: aid(7), occurrence: "ROW_ORDER", normalization: [] } };
  const value = { templateSchemaVersion: "1", executionPolicyVersion: "1", templateId: `tpl_${"1".repeat(32)}`, matchingKey: KEY, parentTemplateId: null, selectors, requiredAnchors: anchors.slice(0, 8), optionalAnchors: anchors.slice(8), repeatedHeaderSignature: evidence.table.repeatedHeaderSignature, columnOrder: ["description", "quantity", "unitPrice"], confidenceFloorBps: optional ? 9000 : 9000, layoutFingerprint: "0".repeat(64), provenance: { source: "MANUAL", actionId: `act_${"3".repeat(32)}`, createdAt: "2026-01-01T00:00:00.000Z" } };
  value.layoutFingerprint = layoutFingerprint(value);
  return value;
}

async function evidence() { return extractInvoiceEvidence(PDF, { documentId: ID }); }
function frame(value) { const body = Buffer.from(JSON.stringify(value)); const out = Buffer.alloc(body.length + 4); out.writeUInt32BE(body.length); body.copy(out, 4); return out; }

test("replays an approved same-layout template deterministically and provider-free", async () => {
  const input = await evidence();
  const template = templateFor(input);
  const options = { approvedProjection: { matchingKey: KEY, pdfSha256: input.documentSha256, layoutVersion: "A3-LAYOUT-V1", currency: "EUR", expectedRowCount: 3 } };
  const first = replayTemplate(input, template, options);
  const second = replayTemplate(input, template, options);
  assert.deepEqual(second, first);
  assert.equal(first.replayOutcome, "REPLAY_LOCAL");
  assert.deepEqual(first.replayCounters, { providerRequestCount: 0, automaticCorrectionCount: 0, userEditCount: 0 });
  assert.equal(first.invoiceEvidence.record.invoiceNumber.provenance, "REPLAY_LOCAL");
  assert.equal(first.invoiceEvidence.record.lineItems.length, 3);
  assert.equal(input.record.invoiceNumber.provenance, "EXTRACTED_LOCAL");
  assert.equal(template.confidenceFloorBps, 9000);
});

test("rejects an out-of-tolerance required anchor without changing the approved template", async () => {
  const input = await evidence();
  const template = templateFor(input);
  input.record.supplier.evidence[0].rect.x += 201;
  assert.equal(replayTemplate(input, template, { approvedProjection: { matchingKey: KEY } }).replayOutcome, "LAYOUT_MISMATCH");
});

test("fails closed for key, ISO, missing-evidence, and confidence mismatches", async () => {
  const input = await evidence();
  const template = templateFor(input);
  assert.equal(replayTemplate(input, template, { approvedProjection: { matchingKey: "sup_" + "4".repeat(32), pdfSha256: input.documentSha256, layoutVersion: "A3-LAYOUT-V1", currency: "EUR", expectedRowCount: 3 } }).replayOutcome, "LAYOUT_MISMATCH");
  const badIso = structuredClone(input); badIso.iso4217Snapshot.version = "ISO4217-1900-01-01";
  assert.equal(replayTemplate(badIso, template, { approvedProjection: { matchingKey: KEY } }).replayOutcome, "FAILURE");
  const missing = structuredClone(input); missing.record.total = { state: "MISSING", reason: "EVIDENCE_MISSING" };
  assert.equal(replayTemplate(missing, template, { approvedProjection: { matchingKey: KEY } }).replayOutcome, "REVIEW_REQUIRED");
  assert.equal(replayTemplate(input, templateFor(input, true), { approvedProjection: { matchingKey: KEY } }).replayOutcome, "LOW_CONFIDENCE");
});

test("dispatches replayTemplateV1 through framed stdio without a provider path", async () => {
  const input = await evidence();
  const request = { protocolVersion: 1, kind: "replayTemplateV1", requestId: "550e8400-e29b-41d4-a716-446655440000", operationCorrelationId: "cor_0123456789abcdef0123456789abcdef", capability: "invoice_learning_v1", invoiceEvidenceSchemaVersion: "1", templateSchemaVersion: "1", executionPolicyVersion: "1", document: documentRef, template: templateFor(input) };
  const result = await new Promise((resolve) => { const child = spawn(process.execPath, ["bin/pdf-tool-engine.mjs"], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env } }); const out = []; child.stdout.on("data", (chunk) => out.push(chunk)); child.on("close", (code) => resolve({ code, json: parseFrame(Buffer.concat(out)).json })); child.stdin.end(frame(request)); });
  assert.equal(result.code, 0);
  assert.equal(result.json.kind, "replayTemplateV1");
  assert.equal(result.json.status, "ok");
  assert.equal(result.json.data.replayOutcome, "REPLAY_LOCAL");
});
