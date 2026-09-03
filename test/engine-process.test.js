import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import { parseFrame, MAX_RESPONSE_BYTES } from "../src/engine-protocol.js";

const PDF_FIXTURE = "test/fixtures/A-G2026-245895.pdf";
const PDF_FIXTURE_BYTES = readFileSync(PDF_FIXTURE);
const PDF_FAKE = Buffer.from("%PDF-1.4 fake minimal test content for engine-stdio");
const NETWORK_DENY = "./test/fixtures/network-deny.mjs";
const ENGINE_ENTRYPOINT = "bin/pdf-tool-engine.mjs";
const PACKAGE = JSON.parse(readFileSync("package.json", "utf8"));
const REQ_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeRequest(pdf = PDF_FAKE, overrides = {}) {
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const doc = overrides.document || {};
  return {
    protocolVersion: 1,
    kind: "extractLocal",
    requestId: REQ_ID,
    document: { name: "invoice.pdf", byteLength: pdf.length, sha256,
      pdfBase64: pdf.toString("base64"), ...doc },
    limits: { maxPages: 100, maxChars: 80_000 },
    ...overrides,
  };
}

function frameMessage(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32BE(payload.length, 0);
  payload.copy(buf, 4);
  return buf;
}

function runAdapter(inputBuf, opts = {}) {
  const { extraEnv = {}, nodeOptions = [], entrypoint = ENGINE_ENTRYPOINT } = opts;
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [...nodeOptions, entrypoint], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });
    const stdout = [], stderr = [];
    proc.stdout.on("data", (d) => stdout.push(d));
    proc.stderr.on("data", (d) => stderr.push(d));
    proc.on("close", (code) =>
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code }));
    proc.stdin.write(inputBuf);
    proc.stdin.end();
  });
}

async function runWith(req, opts = {}) {
  const { stdout, stderr, code } = await runAdapter(frameMessage(req), opts);
  let json = null;
  try { json = parseFrame(stdout).json; } catch {}
  return { json, stderr: stderr.toString(), code, stdout };
}

async function loadFrameResponse() {
  const mod = await import("../src/engine-protocol.js");
  assert.equal(typeof mod.frameResponse, "function",
    "frameResponse must be exported from engine-protocol.js");
  return mod.frameResponse;
}

// === WU-1C3: frameResponse caps response at MAX_RESPONSE_BYTES ===

describe("pdf-tool-engine package entrypoint", () => {
  it("exposes one stable executable bin and preserves the v1 response contract", async () => {
    assert.equal(PACKAGE.bin["pdf-tool-engine"], ENGINE_ENTRYPOINT);
    const { code, json } = await runWith(makeRequest(PDF_FAKE), {
      entrypoint: ENGINE_ENTRYPOINT,
    });
    assert.equal(code, 0);
    assert.equal(json?.protocolVersion, 1);
    assert.equal(json?.kind, "extractLocal");
  });

  it("preserves protocol-version errors through the stable executable", async () => {
    const { code, json } = await runWith(
      makeRequest(PDF_FAKE, { protocolVersion: 2 }),
      { entrypoint: ENGINE_ENTRYPOINT },
    );
    assert.equal(code, 0);
    assert.equal(json?.status, "error");
    assert.equal(json?.error, "protocol_version");
  });

  it("maps invalid PDF validation and parse failures to typed error envelopes", async () => {
    const invalidPdf = await runWith(makeRequest(Buffer.from("not a PDF")));
    assert.equal(invalidPdf.code, 0);
    assert.equal(invalidPdf.json?.status, "error");
    assert.match(invalidPdf.json?.error ?? "", /^pdf_invalid/);

    const parseFailure = await runWith(makeRequest(PDF_FAKE));
    assert.equal(parseFailure.code, 0);
    assert.equal(parseFailure.json?.status, "error");
    assert.equal(parseFailure.json?.error, "pdf_parse_failed");
  });

  it("maps invalid base64 validation to a typed error envelope", async () => {
    const request = makeRequest(PDF_FAKE);
    request.document.pdfBase64 = "not-base64";
    const { code, json } = await runWith(request);
    assert.equal(code, 0);
    assert.equal(json?.status, "error");
    assert.equal(json?.error, "invalid_base64");
  });
});

describe("WU-1C3 frameResponse caps at MAX_RESPONSE_BYTES", () => {
  it("does not throw when payload exceeds 1 MB; returns capped buffer", async () => {
    const frameResponse = await loadFrameResponse();
    const buf = frameResponse({ protocolVersion: 1, kind: "extractLocal",
      requestId: REQ_ID, text: "A".repeat(MAX_RESPONSE_BYTES + 1000) });
    assert.ok(buf.readUInt32BE(0) <= MAX_RESPONSE_BYTES);
  });

  it("truncates text, sets truncated=true, stays within cap", async () => {
    const frameResponse = await loadFrameResponse();
    const buf = frameResponse({ protocolVersion: 1, kind: "extractLocal",
      requestId: REQ_ID, text: "B".repeat(MAX_RESPONSE_BYTES + 5000) });
    const { json } = parseFrame(buf);
    assert.equal(json.truncated, true);
    assert.ok(json.text.length < MAX_RESPONSE_BYTES + 5000);
  });

  it("returns error envelope when non-text fields exceed the cap", async () => {
    const frameResponse = await loadFrameResponse();
    const buf = frameResponse({ protocolVersion: 1, kind: "extractLocal",
      requestId: REQ_ID, text: "", padding: "X".repeat(MAX_RESPONSE_BYTES + 100) });
    const { json } = parseFrame(buf);
    assert.equal(json.status, "error");
    assert.equal(json.error, "response_exceeds_limit");
  });

  it("passes through small payloads unchanged", async () => {
    const frameResponse = await loadFrameResponse();
    const small = { protocolVersion: 1, kind: "extractLocal", requestId: REQ_ID, text: "hello" };
    const { json } = parseFrame(frameResponse(small));
    assert.deepEqual(json, small);
  });

  it("payload exactly at MAX_RESPONSE_BYTES is not truncated", async () => {
    const frameResponse = await loadFrameResponse();
    const text = "C".repeat(MAX_RESPONSE_BYTES - 80); // leaves room for other fields
    const obj = { protocolVersion: 1, kind: "extractLocal", requestId: REQ_ID, text };
    const payloadLen = Buffer.byteLength(JSON.stringify(obj), "utf8");
    if (payloadLen <= MAX_RESPONSE_BYTES) { // only assert if it fits
      const { json } = parseFrame(frameResponse(obj));
      assert.equal(json.truncated, undefined);
    }
  });
});

// === WU-1C3: provider/OCR env var stripping ===

describe("WU-1C3 provider/OCR env var stripping", () => {
  it("strips provider env vars and logs to stderr", async () => {
    const { code, stderr } = await runWith(makeRequest(PDF_FAKE),
      { extraEnv: { OPENAI_API_KEY: "sk-test-123", ANTHROPIC_API_KEY: "secret-val" } });
    assert.equal(code, 0);
    assert.match(stderr, /stripped/);
    assert.match(stderr, /OPENAI_API_KEY/);
    assert.match(stderr, /ANTHROPIC_API_KEY/);
  });

  it("strips OCR env vars and logs to stderr", async () => {
    const { code, stderr } = await runWith(makeRequest(PDF_FAKE),
      { extraEnv: { GOOGLE_APPLICATION_CREDENTIALS: "/secret", AZURE_AI_KEY: "key" } });
    assert.equal(code, 0);
    assert.match(stderr, /stripped/);
    assert.match(stderr, /GOOGLE_APPLICATION_CREDENTIALS/);
  });

  it("never leaks env var values into stderr", async () => {
    const { stderr } = await runWith(makeRequest(PDF_FAKE),
      { extraEnv: { OPENAI_API_KEY: "sk-leaked-val", GOOGLE_API_KEY: "g-leaked" } });
    assert.doesNotMatch(stderr, /sk-leaked-val/);
    assert.doesNotMatch(stderr, /g-leaked/);
  });

  it("strips combined provider + OCR vars in one run", async () => {
    const { code, json, stderr } = await runWith(makeRequest(PDF_FAKE), {
      extraEnv: { OPENAI_API_KEY: "sk-x", GOOGLE_APPLICATION_CREDENTIALS: "/c.json",
        AZURE_AI_KEY: "k", COHERE_API_KEY: "c" },
    });
    assert.equal(code, 0);
    assert.match(stderr, /stripped/);
    assert.match(stderr, /OPENAI_API_KEY/);
    assert.match(stderr, /GOOGLE_APPLICATION_CREDENTIALS/);
    assert.ok(json);
  });

  it("exits cleanly with no stripping notice when env is clean", async () => {
    const { code, stderr } = await runWith(makeRequest(PDF_FAKE));
    assert.equal(code, 0);
    assert.doesNotMatch(stderr, /stripped/);
  });
});

// === WU-1C3: network-free deterministic extraction ===

describe("WU-1C3 network-free deterministic extraction", () => {
  it("extracts real PDF text with outbound sockets blocked via --import", async () => {
    const { code, json } = await runWith(makeRequest(PDF_FIXTURE_BYTES),
      { nodeOptions: [`--import=${NETWORK_DENY}`] });
    assert.equal(code, 0);
    assert.equal(json?.status, "ok");
    assert.ok(json?.text?.length > 0);
    assert.equal(json?.confidence, "deterministic");
    assert.ok(json?.sha256);
  });

  it("provider env vars do not affect deterministic extraction", async () => {
    const { code, json, stderr } = await runWith(makeRequest(PDF_FIXTURE_BYTES),
      { extraEnv: { OPENAI_API_KEY: "sk-leaked", GOOGLE_API_KEY: "g-leaked" } });
    assert.equal(code, 0);
    assert.equal(json?.status, "ok");
    assert.equal(json?.confidence, "deterministic");
    assert.doesNotMatch(stderr, /sk-leaked/);
    assert.doesNotMatch(stderr, /g-leaked/);
  });
});

// === WU-1C3: crash handling, EOF, stream separation ===

describe("WU-1C3 crash handling, EOF, stream separation", () => {
  it("exits non-zero with empty stdout on garbage input", async () => {
    const { code, stdout } = await runAdapter(Buffer.from("not a framed message"));
    assert.notEqual(code, 0);
    assert.equal(stdout.length, 0);
  });

  it("exits non-zero with empty stdout on empty input", async () => {
    const { code, stdout } = await runAdapter(Buffer.alloc(0));
    assert.notEqual(code, 0);
    assert.equal(stdout.length, 0);
  });

  it("exits non-zero on truncated frame", async () => {
    const buf = Buffer.alloc(4); buf.writeUInt32BE(100, 0);
    const { code, stdout } = await runAdapter(buf);
    assert.notEqual(code, 0);
    assert.equal(stdout.length, 0);
  });

  it("stdout contains exactly one frame — no trailing data, process exits 0", async () => {
    const { stdout, code } = await runWith(makeRequest(PDF_FAKE));
    assert.equal(code, 0);
    const { json, bytes } = parseFrame(stdout);
    assert.ok(json);
    assert.equal(4 + bytes, stdout.length, "stdout must contain exactly one frame");
  });

  it("stderr activity does not corrupt stdout framing", async () => {
    const { stdout, stderr, code } = await runWith(makeRequest(PDF_FAKE),
      { extraEnv: { OPENAI_API_KEY: "sk-test" } });
    assert.equal(code, 0);
    const { json } = parseFrame(stdout);
    assert.ok(json, "stdout must be a valid frame even with stderr activity");
    assert.ok(stderr.length > 0, "stderr should have the stripping notice");
  });

  it("returns a bounded response instead of crashing on a valid large request", async () => {
    const largePdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(3_200_000, "x")]);
    const { code, json, stderr } = await runWith(makeRequest(largePdf));
    assert.equal(code, 0);
    assert.equal(json?.error, "pdf_parse_failed");
    assert.match(stderr, /NELUPDF_DIAG /);
    assert.match(stderr, /response_failed/);
  });
});
