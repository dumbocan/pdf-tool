import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { extractOcrFromPdfPage } from "../src/extract.js";

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
