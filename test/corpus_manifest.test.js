// B0f: deterministic engine contract/fixture test for CorpusManifestV1.
//
// The manifest is a synthetic-only fixture: synthetic entries carry B0d-evidenced
// safe values, and private entries carry clearly labeled synthetic test-only
// values that exercise the approved PrivateCorpusEntryV1 shape. No real private
// data, PDF, screenshot, token, value, or byte is read, stored, or fabricated.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MANIFEST_PATH = resolve(
  ROOT,
  "contracts/invoice-learning/v1/corpus-manifest.json",
);
const FIXTURES_DIR = resolve(ROOT, "fixtures/invoice-learning");

const EXPECTED_IDS = [
  "synthetic.same-layout.first",
  "synthetic.same-layout.second",
  "private.same-layout.first",
  "private.same-layout.second",
];

const SYNTHETIC_KEYS = [
  "entryId",
  "kind",
  "fixturePath",
  "pdfSha256",
  "pageCount",
  "currency",
  "layoutVersion",
  "requiredFieldList",
  "expectedRowCount",
  "repeatedHeaderCoverage",
  "safeVisualMetadata",
];

const PRIVATE_KEYS = [
  "entryId",
  "kind",
  "opaqueLocalId",
  "opaqueSha256",
  "equivalence",
  "layoutVersion",
  "commandCount",
  "resultCount",
  "safeConclusion",
];

const VISUAL_KEYS = [
  "page",
  "zoomBps",
  "viewportWidth",
  "viewportHeight",
  "workflow",
  "containsSensitiveContent",
];

const SYNTHETIC_REQUIRED = [
  "supplier",
  "invoiceNumber",
  "invoiceDate",
  "currency",
  "taxableBase",
  "taxes",
  "total",
];

const SHA256_RE = /^[0-9a-f]{64}$/;
const REPO_SAFE_PATH_RE =
  /^(?![/\\])(.*?\/)*[A-Za-z0-9._-]+$/;

function sha256hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/**
 * Validates a CorpusManifestV1 object in place. Throws an AssertionError
 * on any deviation from the exact synthetic-only contract.
 */
function validateCorpusManifest(m) {
  // --- top-level schema: exactly two keys, no checksum, no extras ---
  assert.deepEqual(
    Object.keys(m),
    ["corpusManifestSchemaVersion", "entries"],
    "manifest top-level keys must be exactly corpusManifestSchemaVersion, entries in order",
  );
  assert.equal(
    m.corpusManifestSchemaVersion,
    "1",
    "corpusManifestSchemaVersion must be \"1\"",
  );
  assert.equal(
    Array.isArray(m.entries),
    true,
    "entries must be an array",
  );
  assert.equal(
    m.entries.length,
    4,
    "manifest must have exactly four entries",
  );

  // --- exact entry IDs in exact order ---
  for (let i = 0; i < 4; i++) {
    assert.equal(
      m.entries[i].entryId,
      EXPECTED_IDS[i],
      `entry[${i}].entryId must be "${EXPECTED_IDS[i]}"`,
    );
  }

  // --- synthetic entries (indices 0 and 1) ---
  const SYNTHETIC_PATH_RE =
    /^fixtures\/invoice-learning\/synthetic\.same-layout\.(first|second)\.pdf$/;
  for (let i = 0; i < 2; i++) {
    const e = m.entries[i];
    assert.deepEqual(
      Object.keys(e),
      SYNTHETIC_KEYS,
      `synthetic entry[${i}] must have exactly the approved SyntheticCorpusEntryV1 keys in order`,
    );
    assert.equal(e.kind, "SYNTHETIC", `synthetic entry[${i}] kind`);
    assert.match(e.fixturePath, SYNTHETIC_PATH_RE, `synthetic entry[${i}] fixturePath`);
    assert.match(e.pdfSha256, SHA256_RE, `synthetic entry[${i}] pdfSha256 format`);
    assert.equal(e.pageCount, 2, `synthetic entry[${i}] pageCount`);
    assert.equal(e.currency, "EUR", `synthetic entry[${i}] currency`);
    assert.equal(e.layoutVersion, "A3-LAYOUT-V1", `synthetic entry[${i}] layoutVersion`);
    assert.deepEqual(
      e.requiredFieldList,
      SYNTHETIC_REQUIRED,
      `synthetic entry[${i}] requiredFieldList`,
    );
    assert.equal(e.expectedRowCount, 3, `synthetic entry[${i}] expectedRowCount`);
    assert.equal(
      e.repeatedHeaderCoverage,
      "ALL_CONTINUATION_PAGES",
      `synthetic entry[${i}] repeatedHeaderCoverage`,
    );
    const vm = e.safeVisualMetadata;
    assert.deepEqual(
      Object.keys(vm),
      VISUAL_KEYS,
      "safeVisualMetadata must have exactly the approved keys in order",
    );
    assert.ok(
      Number.isInteger(vm.page) && vm.page >= 1 && vm.page <= 100,
      "safeVisualMetadata.page",
    );
    assert.ok(
      Number.isInteger(vm.zoomBps) && vm.zoomBps >= 100 && vm.zoomBps <= 400,
      "safeVisualMetadata.zoomBps",
    );
    assert.ok(
      Number.isInteger(vm.viewportWidth) &&
        vm.viewportWidth >= 320 &&
        vm.viewportWidth <= 4096,
      "safeVisualMetadata.viewportWidth",
    );
    assert.ok(
      Number.isInteger(vm.viewportHeight) &&
        vm.viewportHeight >= 240 &&
        vm.viewportHeight <= 4096,
      "safeVisualMetadata.viewportHeight",
    );
    assert.equal(vm.workflow, "REVIEW_OVERLAY_AND_REPLAY");
    assert.equal(vm.containsSensitiveContent, false);
  }

  // --- private entries (indices 2 and 3): clearly synthetic test values ---
  for (let i = 0; i < 2; i++) {
    const e = m.entries[i + 2];
    assert.deepEqual(
      Object.keys(e),
      PRIVATE_KEYS,
      `private entry[${i}] must have exactly the approved PrivateCorpusEntryV1 keys in order`,
    );
    assert.equal(e.kind, "PRIVATE", `private entry[${i}] kind`);
    assert.equal(e.entryId, EXPECTED_IDS[i + 2]);
    assert.ok(e.opaqueLocalId, `private entry[${i}] opaqueLocalId must exist`);
    assert.match(
      e.opaqueLocalId,
      /^[A-Za-z0-9._-]+$/,
      `private entry[${i}] opaqueLocalId must be an AsciiToken`,
    );
    assert.ok(
      e.opaqueLocalId.length >= 1 && e.opaqueLocalId.length <= 128,
      `private entry[${i}] opaqueLocalId length`,
    );
    // Clearly synthetic: the opaque local ID must self-identify as test-only.
    assert.match(
      e.opaqueLocalId,
      /synth|test/i,
      `private entry[${i}] opaqueLocalId must be clearly labeled synthetic test value`,
    );
    // Clearly synthetic: the opaque hash must be a sentinel pattern
    // (long run of a single repeated character) that cannot be a real hash.
    assert.match(e.opaqueSha256, SHA256_RE, `private entry[${i}] opaqueSha256 format`);
    const repetition = e.opaqueSha256.match(/^(.)\1+$/);
    assert.ok(
      repetition !== null ||
        /^(.)\1{59,}$/.test(e.opaqueSha256),
      `private entry[${i}] opaqueSha256 must be a clearly synthetic sentinel, not a real hash`,
    );
assert.equal(
          e.equivalence,
          "SAME_LAYOUT",
          `private entry[${i}] equivalence`,
        );
        assert.ok(e.layoutVersion, `private entry[${i}] layoutVersion`);
    assert.match(e.layoutVersion, /^[A-Za-z0-9._-]+$/);
    assert.ok(
      Number.isInteger(e.commandCount) && e.commandCount >= 0 && e.commandCount <= 4096,
      `private entry[${i}] commandCount`,
    );
    assert.ok(
      Number.isInteger(e.resultCount) && e.resultCount >= 0 && e.resultCount <= 4096,
      `private entry[${i}] resultCount`,
    );
    assert.equal(e.safeConclusion, "SAME_LAYOUT_CONFIRMED");
  }
}

// ---------------------------------------------------------------------------
// Happy-path: the committed manifest passes the full contract.
// ---------------------------------------------------------------------------

test("manifest file exists at the engine-authoritative path", () => {
  assert.ok(existsSync(MANIFEST_PATH));
});

test("manifest has exact top-level schema: only corpusManifestSchemaVersion and entries, no checksum", () => {
  const m = loadManifest();
  assert.deepEqual(Object.keys(m), [
    "corpusManifestSchemaVersion",
    "entries",
  ]);
  assert.equal(m.corpusManifestSchemaVersion, "1");
  // Explicit: no checksum member of any name may exist.
  for (const k of Object.keys(m)) {
    assert.ok(
      !/checksum/i.test(k),
      `manifest must not contain a checksum member: ${k}`,
    );
  }
});

test("manifest has exactly four entries in the exact closed ordered union", () => {
  const m = loadManifest();
  assert.equal(m.entries.length, 4);
  const ids = m.entries.map((e) => e.entryId);
  assert.deepEqual(ids, EXPECTED_IDS);
});

test("each entry has the exact approved key set and order (no extra/missing members)", () => {
  const m = loadManifest();
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(Object.keys(m.entries[i]), SYNTHETIC_KEYS);
  }
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(Object.keys(m.entries[i + 2]), PRIVATE_KEYS);
  }
});

test("synthetic entries match the B0d-evidenced safe evidence shape", () => {
  const m = loadManifest();
  for (let i = 0; i < 2; i++) {
    const e = m.entries[i];
    assert.equal(e.kind, "SYNTHETIC");
    assert.equal(e.pageCount, 2);
    assert.equal(e.currency, "EUR");
    assert.equal(e.layoutVersion, "A3-LAYOUT-V1");
    assert.deepEqual(e.requiredFieldList, SYNTHETIC_REQUIRED);
    assert.equal(e.expectedRowCount, 3);
    assert.equal(e.repeatedHeaderCoverage, "ALL_CONTINUATION_PAGES");
    const vm = e.safeVisualMetadata;
    assert.equal(vm.workflow, "REVIEW_OVERLAY_AND_REPLAY");
    assert.equal(vm.containsSensitiveContent, false);
  }
});

test("synthetic pdfSha256 values match the actual safe synthetic PDF fixtures on disk", () => {
  const m = loadManifest();
  for (let i = 0; i < 2; i++) {
    const e = m.entries[i];
    const pdfPath = resolve(FIXTURES_DIR, `synthetic.same-layout.${i === 0 ? "first" : "second"}.pdf`);
    assert.ok(existsSync(pdfPath), `synthetic PDF fixture must exist: ${pdfPath}`);
    const pdfBytes = readFileSync(pdfPath);
    const actual = sha256hex(pdfBytes);
    assert.equal(
      actual,
      e.pdfSha256,
      `synthetic entry ${i} pdfSha256 must match actual PDF hash`,
    );
  }
});

test("private entries use clearly synthetic, non-real opaque IDs and hashes", () => {
  const m = loadManifest();
  for (let i = 0; i < 2; i++) {
    const e = m.entries[i + 2];
    // opaqueLocalId must explicitly say "synth" or "test"
    assert.match(e.opaqueLocalId, /synth|test/i);
    // opaqueSha256 must be a sentinel (long repeated-char run), not a real hash
    assert.ok(/^(.)\1{59,}$/.test(e.opaqueSha256));
    assert.equal(e.equivalence, "SAME_LAYOUT");
    assert.equal(e.safeConclusion, "SAME_LAYOUT_CONFIRMED");
    assert.equal(e.layoutVersion, "A3-LAYOUT-V1");
    assert.equal(typeof e.commandCount, "number");
    assert.equal(typeof e.resultCount, "number");
  }
});

// ---------------------------------------------------------------------------
// Privacy: no private data or file persistence is involved.
// ---------------------------------------------------------------------------

test("manifest contains no private file paths, PDF references, or private-value patterns", () => {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const m = JSON.parse(raw);

  // Private entries must not carry fixturePath, pdfSha256, or any path.
  for (let i = 0; i < 2; i++) {
    const pe = m.entries[i + 2];
    for (const forbidden of ["fixturePath", "pdfSha256", "path", "filePath", "pdfPath"]) {
      assert.ok(
        !(forbidden in pe),
        `private entry must not contain ${forbidden}`,
      );
    }
  }

  // The raw file must not contain private directory paths or home references.
  assert.ok(!/\/home\/jmon\/pdf-tool/.test(raw), "must not reference the protected /home/jmon/pdf-tool repo");
  assert.ok(!/\.pdf-tool-wu1a1\/private/.test(raw), "must not reference a real private fixture path");

  // No PDF base64, screenshot, or encoded content.
  assert.ok(!/[\/\\]fixtures[\/\\]private[\/\\]/.test(raw), "must not reference private fixture directories");
  assert.ok(!/data:application\/pdf/.test(raw), "must not embed PDF data URIs");
  assert.ok(!/iVBOR\w{100,}/.test(raw), "must not embed screenshot/image base64");
});

test("private opaqueSha256 values are distinct and not derived from any real data", () => {
  const m = loadManifest();
  const hashes = m.entries.slice(2, 4).map((e) => e.opaqueSha256);
  assert.equal(hashes[0], "1".repeat(64));
  assert.equal(hashes[1], "2".repeat(64));
  assert.notEqual(hashes[0], hashes[1]);
  // Sentinel pattern: each value is one repeated character.
  assert.match(hashes[0], /^(.)\1{63}$/);
  assert.match(hashes[1], /^(.)\1{63}$/);
});

// ---------------------------------------------------------------------------
// Negative / fail-closed contract tests (mutated copies of the manifest).
// ---------------------------------------------------------------------------

function cloneManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

test("rejects manifest with a checksumSha256 top-level member", () => {
  const m = cloneManifest();
  m.checksumSha256 = "0".repeat(64);
  assert.throws(() => validateCorpusManifest(m), /top-level keys/);
});

test("rejects manifest with an extra top-level member", () => {
  const m = cloneManifest();
  m.metadata = { foo: "bar" };
  assert.throws(() => validateCorpusManifest(m), /top-level keys/);
});

test("rejects manifest with fewer than four entries", () => {
  const m = cloneManifest();
  m.entries.pop();
  assert.throws(() => validateCorpusManifest(m), /exactly four/);
});

test("rejects manifest with more than four entries", () => {
  const m = cloneManifest();
  m.entries.push({ ...m.entries[0] });
  assert.throws(() => validateCorpusManifest(m), /exactly four/);
});

test("rejects manifest with entries in wrong order", () => {
  const m = cloneManifest();
  [m.entries[0], m.entries[2]] = [m.entries[2], m.entries[0]];
  assert.throws(() => validateCorpusManifest(m), /entryId must be/);
});

test("rejects manifest with an incorrect entryId", () => {
  const m = cloneManifest();
  m.entries[0].entryId = "synthetic.same-layout.first.bak";
  assert.throws(() => validateCorpusManifest(m), /entryId must be/);
});

test("rejects synthetic entry with an extra member", () => {
  const m = cloneManifest();
  m.entries[0].checksumSha256 = "0".repeat(64);
  assert.throws(() => validateCorpusManifest(m), /SyntheticCorpusEntryV1 keys/);
});

test("rejects synthetic entry with a missing member", () => {
  const m = cloneManifest();
  delete m.entries[0].pdfSha256;
  assert.throws(() => validateCorpusManifest(m), /SyntheticCorpusEntryV1 keys/);
});

test("rejects private entry with an extra member (e.g. a real file path)", () => {
  const m = cloneManifest();
  m.entries[2].filePath = "/home/jmon/pdf-tool/private/invoice.pdf";
  assert.throws(() => validateCorpusManifest(m), /PrivateCorpusEntryV1 keys/);
});

test("rejects private entry with a missing member", () => {
  const m = cloneManifest();
  delete m.entries[2].opaqueLocalId;
  assert.throws(() => validateCorpusManifest(m), /PrivateCorpusEntryV1 keys/);
});

test("rejects private entry whose kind is not PRIVATE", () => {
  const m = cloneManifest();
  m.entries[2].kind = "SYNTHETIC";
  assert.throws(() => validateCorpusManifest(m), /kind/);
});

test("rejects synthetic entry whose currency is not EUR or a valid ISO code", () => {
  const m = cloneManifest();
  m.entries[0].currency = "eur";
  assert.throws(() => validateCorpusManifest(m), /currency/);
});

test("rejects private entry with wrong equivalence", () => {
  const m = cloneManifest();
  m.entries[2].equivalence = "DIFFERENT_LAYOUT";
  assert.throws(() => validateCorpusManifest(m), /equivalence/);
});

test("rejects private entry whose opaqueSha256 looks like a real hash", () => {
  const m = cloneManifest();
  // A real-looking hash has no 60+ char run of a single character.
  m.entries[2].opaqueSha256 =
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
  assert.throws(
    () => validateCorpusManifest(m),
    /clearly synthetic sentinel/,
  );
});

test("rejects duplicate entryIds", () => {
  const m = cloneManifest();
  m.entries[3].entryId = m.entries[2].entryId;
  assert.throws(() => validateCorpusManifest(m), /entryId must be/);
});

test("rejects private entry whose opaqueLocalId is not clearly synthetic", () => {
  const m = cloneManifest();
  m.entries[2].opaqueLocalId = "priv-opaque-id-from-real-data-001";
  assert.throws(
    () => validateCorpusManifest(m),
    /clearly labeled synthetic test value/,
  );
});

test("rejects synthetic fixturePath that escapes the fixtures directory", () => {
  const m = cloneManifest();
  m.entries[0].fixturePath = "../private/invoice.pdf";
  assert.throws(() => validateCorpusManifest(m), /fixturePath/);
});

test("the committed manifest passes full validation", () => {
  const m = loadManifest();
  assert.doesNotThrow(() => validateCorpusManifest(m));
});
