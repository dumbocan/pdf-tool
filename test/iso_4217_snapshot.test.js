import assert from "node:assert/strict";
import test from "node:test";
import {
  loadIso4217Snapshot, materializeIso4217Snapshot, snapshotChecksum, validateIso4217Snapshot,
} from "../src/iso-4217-snapshot.js";

const audit = { source: "ISO_4217", publication: "2026-01-01" };
const entries = [{ code: "JPY", minorUnit: 0 }, { code: "USD", minorUnit: 2 }];
const candidate = () => {
  const body = { source: "ISO_4217", version: "ISO4217-2026-01-01", entries: entries.map((e) => ({ ...e })) };
  return { ...body, checksumSha256: snapshotChecksum(body) };
};
const approvedCandidate = () => {
  const approved = loadIso4217Snapshot();
  const body = { source: approved.source, version: approved.version, entries: approved.entries.map((e) => ({ ...e })) };
  return { ...body, checksumSha256: snapshotChecksum(body) };
};

test("loads the audited snapshot and preserves approved examples", () => {
  const snapshot = loadIso4217Snapshot();
  assert.equal(snapshot.source, "ISO_4217");
  assert.equal(snapshot.version, "ISO4217-2026-01-01");
  assert.equal(snapshot.entries.length, 163);
  assert.equal(snapshot.checksumSha256, "7045f002db5129f0d4cffead8565775500d657494dd84d8296eb20fd305977cc");
  assert.equal(snapshot.entries.find((e) => e.code === "JPY").minorUnit, 0);
  assert.equal(snapshot.entries.find((e) => e.code === "USD").minorUnit, 2);
  assert.equal(snapshot.entries.find((e) => e.code === "KWD").minorUnit, 3);
  assert.equal(snapshot.entries.some((e) => e.code === "CLF" || e.code === "UYW"), false);
});

test("rejects a sorted, self-checksummed but unapproved two-entry candidate", () => {
  assert.throws(() => validateIso4217Snapshot(candidate(), audit), /Invalid ISO/);
  assert.throws(() => materializeIso4217Snapshot({ ...audit, entries }), /Invalid ISO/);
});

test("materializes the approved audited snapshot from the sole JSON artifact", () => {
  const approved = loadIso4217Snapshot();
  assert.deepEqual(materializeIso4217Snapshot({
    source: approved.source, publication: "2026-01-01", entries: approved.entries,
  }), approved);
});

for (const [name, value] of [
  ["absent audited input", null], ["wrong source", { ...audit, source: "OTHER" }],
  ["stale publication", { ...audit, publication: "2025-01-01" }],
]) test(`rejects ${name}`, () => assert.throws(() => validateIso4217Snapshot(approvedCandidate(), value), /Invalid ISO/));

for (const [name, change] of [
  ["source mismatch", (s) => { s.source = "OTHER"; }],
  ["version mismatch", (s) => { s.version = "ISO4217-2025-01-01"; }],
  ["duplicate entries", (s) => { s.entries = [s.entries[0], s.entries[0], ...s.entries.slice(2)]; }],
  ["unsorted entries", (s) => { s.entries.reverse(); }],
  ["invalid minor unit", (s) => { s.entries[0].minorUnit = 4; }],
  ["checksum mismatch", (s) => { s.checksumSha256 = "0".repeat(64); }],
]) test(`rejects ${name}`, () => {
  const snapshot = approvedCandidate(); change(snapshot);
  assert.throws(() => validateIso4217Snapshot(snapshot, audit), /Invalid ISO/);
});
