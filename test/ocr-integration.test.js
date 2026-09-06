import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractOcrFromPdfPage } from "../src/extract.js";
import { parseFrame } from "../src/engine-protocol.js";

const fixture = readFileSync("test/fixtures/ocr-placeholder-image.pdf");

test("OCR reports unavailable when a local command is missing", async () => {
  const result = await extractOcrFromPdfPage(fixture, 1, {
    pdftoppmCommand: "nelupdf-command-that-does-not-exist",
  });

  assert.equal(result.error, "ocr_unavailable");
  assert.equal(result.text, "");
});

test("OCR falls back to eng only when the preferred language data is missing", async () => {
  let calls = 0;
  const spawnImpl = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => {
      setImmediate(() => {
        calls += 1;
        if (calls === 1) child.stdout.emit("data", Buffer.from("PNG"));
        if (calls === 2) child.stderr.emit("data", Buffer.from("Failed loading language"));
        if (calls === 3) child.stdout.emit("data", Buffer.from("FALLBACK_TEXT"));
        child.emit("close", calls === 2 ? 1 : 0, null);
      });
    };
    child.kill = () => true;
    return child;
  };
  const result = await extractOcrFromPdfPage(fixture, 1, {
    spawnImpl,
  });

  assert.equal(result.text, "FALLBACK_TEXT");
  assert.equal(result.error, undefined);
});

test("OCR sidecar exposes bounded word-level TSV tokens in bottom-left coordinates", async () => {
  let calls = 0;
  const spawnImpl = (_command, _args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => {
      calls += 1;
      if (calls === 1) child.stdout.emit("data", Buffer.from("PNG"));
      if (calls === 2) child.stdout.emit("data", Buffer.from([
        "level\tpage_num\\tblock_num\\tpar_num\\tline_num\\tword_num\\tleft\\ttop\\twidth\\theight\\tconf\\ttext",
        "1\t1\t0\t0\t0\t0\t0\t0\t1000\t1000\t-1\t",
        "5\t1\t1\t1\t1\t1\t100\t200\t100\t50\t95\tTOTAL",
      ].join("\n")));
      child.emit("close", 0, null);
    });
    child.kill = () => true;
    return child;
  };
  const result = await extractOcrFromPdfPage(fixture, 1, { spawnImpl });
  assert.equal(result.text, "TOTAL");
  assert.deepEqual(result.tokens, [{
    text: "TOTAL", page: 1, bbox: { x: 100, y: 750, width: 100, height: 50 }, confidenceBps: 9500,
  }]);
  assert.equal(result.pageWidth, 1000);
  assert.equal(result.pageHeight, 1000);
});

test("OCR timeout kills the active child and returns a typed bounded error", async () => {
  let killCount = 0;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = () => {};
    child.kill = () => { killCount += 1; return true; };
    return child;
  };

  const result = await extractOcrFromPdfPage(fixture, 1, {
    spawnImpl,
    timeoutMs: 20,
  });

  assert.equal(result.error, "ocr_timeout");
  assert.equal(result.text, "");
  assert.equal(killCount, 1);
});

function frameRequest(pdf, maxChars) {
  const request = {
    protocolVersion: 1,
    kind: "extractLocal",
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    document: {
      name: "scan.pdf",
      byteLength: pdf.length,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      pdfBase64: pdf.toString("base64"),
    },
    limits: { maxPages: 100, maxChars },
  };
  const payload = Buffer.from(JSON.stringify(request), "utf8");
  const frame = Buffer.alloc(payload.length + 4);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function runEngine(input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["bin/pdf-tool-engine.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.on("close", (code) => {
      const output = Buffer.concat(stdout);
      resolve({ code, json: parseFrame(output).json });
    });
    child.stdin.end(input);
  });
}

test("engine returns a typed failure when OCR would exceed retained text bound", async () => {
  const result = await runEngine(frameRequest(fixture, 10));

  assert.equal(result.code, 0);
  assert.equal(result.json.status, "error");
  assert.equal(result.json.error.code, "ocr_resource_limit");
  assert.equal(result.json.error.safeContext.limit, 10);
  assert.equal("text" in result.json, false);
});
