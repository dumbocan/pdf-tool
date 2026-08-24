import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import canonicalize from "canonicalize";

export const SNAPSHOT_SOURCE = "ISO_4217";
export const SNAPSHOT_PUBLICATION = "2026-01-01";
export const SNAPSHOT_VERSION = `ISO4217-${SNAPSHOT_PUBLICATION}`;
export const SNAPSHOT_ENTRY_COUNT = 163;
export const SNAPSHOT_CHECKSUM = "7045f002db5129f0d4cffead8565775500d657494dd84d8296eb20fd305977cc";
export const SNAPSHOT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../contracts/invoice-learning/v1/iso-4217-snapshot.json");
const invalid = (reason) => { throw new Error(`Invalid ISO 4217 snapshot: ${reason}`); };

export function snapshotChecksum(snapshot) {
  const text = canonicalize({ source: snapshot.source, version: snapshot.version, entries: snapshot.entries });
  if (typeof text !== "string") invalid("JCS encoding");
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function validateIso4217Snapshot(snapshot, audited) {
  if (!audited || audited.source !== SNAPSHOT_SOURCE || audited.publication !== SNAPSHOT_PUBLICATION) invalid("audited source");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || Object.keys(snapshot).sort().join(",") !== "checksumSha256,entries,source,version") invalid("shape");
  if (snapshot.source !== SNAPSHOT_SOURCE) invalid("source");
  if (snapshot.version !== SNAPSHOT_VERSION) invalid("publication version");
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length !== SNAPSHOT_ENTRY_COUNT) invalid("entries");
  let previous = "";
  for (const entry of snapshot.entries) {
    if (!entry || Object.keys(entry).sort().join(",") !== "code,minorUnit" || !/^[A-Z]{3}$/.test(entry.code) || !Number.isInteger(entry.minorUnit) || entry.minorUnit < 0 || entry.minorUnit > 3 || entry.code <= previous) invalid("entry");
    previous = entry.code;
  }
  const computedChecksum = snapshotChecksum(snapshot);
  if (!/^[0-9a-f]{64}$/.test(snapshot.checksumSha256) || snapshot.checksumSha256 !== SNAPSHOT_CHECKSUM || snapshot.checksumSha256 !== computedChecksum) invalid("checksum");
  return snapshot;
}

export function materializeIso4217Snapshot(audited) {
  if (!audited || typeof audited !== "object" || Array.isArray(audited) || Object.keys(audited).sort().join(",") !== "entries,publication,source" || !Array.isArray(audited.entries)) invalid("audited source");
  const body = { source: audited.source, version: `ISO4217-${audited.publication}`, entries: audited.entries.map((entry) => ({ ...entry })) };
  return validateIso4217Snapshot({ ...body, checksumSha256: snapshotChecksum(body) }, audited);
}

export function loadIso4217Snapshot(filePath = SNAPSHOT_PATH) {
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(filePath, "utf8")); } catch { invalid("JSON"); }
  return validateIso4217Snapshot(snapshot, { source: SNAPSHOT_SOURCE, publication: SNAPSHOT_PUBLICATION });
}
