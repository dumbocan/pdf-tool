import { createHash } from "node:crypto";
import canonicalize from "canonicalize";

export class ContractError extends Error {
  constructor(code, reason, message = reason) { super(message); this.name = "ContractError"; this.code = code; this.reason = reason; }
}
const reject = (reason, message = reason) => { throw new ContractError("semantic_invalid", reason, message); };
function validString(value) {
  for (let i = 0; i < value.length; i += 1) { const unit = value.charCodeAt(i); if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(i + 1); if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) reject("INVALID_UNICODE", "Lone surrogate is not allowed"); i += 1; } else if (unit >= 0xdc00 && unit <= 0xdfff) reject("INVALID_UNICODE", "Lone surrogate is not allowed"); }
}
export function assertJcsInput(value, seen = new Set()) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { validString(value); return value; }
  if (typeof value === "number") { if (!Number.isFinite(value)) reject("NON_FINITE_NUMBER", "Finite numbers are required"); if (Math.abs(value) > Number.MAX_SAFE_INTEGER) reject("UNSAFE_NUMBER", "Numbers must be safely representable"); return value; }
  if (typeof value !== "object" || typeof value === "bigint" || typeof value === "function") reject("NON_I_JSON", "Only JSON values are allowed");
  if (seen.has(value)) reject("CIRCULAR_REFERENCE", "Circular reference detected");
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => assertJcsInput(item, seen));
  else { const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) reject("NON_I_JSON", "Only JSON objects are allowed"); Object.keys(value).forEach((key) => { validString(key); assertJcsInput(value[key], seen); }); }
  seen.delete(value); return value;
}
export function canonicalizeJcs(value) { assertJcsInput(value); const result = canonicalize(value); if (typeof result !== "string") reject("NON_I_JSON", "Canonicalization produced no JSON"); return result; }
export function hashJcs(value) { return createHash("sha256").update(Buffer.from(canonicalizeJcs(value), "utf8")).digest("hex"); }
export const canonicalizeJson = canonicalizeJcs;
export const sha256Jcs = hashJcs;
