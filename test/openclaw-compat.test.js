// WU-1A3: laia-shaped MCP client characterises the legacy contract end-to-end.
// Emulates services/laia-imap-sidecar/src/pdf-tool-client.js (protocol
// 2024-11-05, session reuse, no auth bypass) against a local pdf-tool server
// and the running docker-compose2.pdf-tool container when both services are Up.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "../src/server.js";
const LEGACY_TOOL_NAMES = ["extract_pdf_from_path", "extract_pdf_from_base64", "extract_pdf_with_llm"];
async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { return await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))); }
}
// laia-shaped client: protocol 2024-11-05, no auth-token bypass, mcp-session-id
// captured on first initialize and reused on subsequent calls. Mirrors the live
// client shape without copying its retry/timeout/re-initialize branches.
function laiaClient(baseUrl) {
  let sessionId = null;
  let nextId = 1;
  async function send(method, params, { notify = false } = {}) {
    const body = { jsonrpc: "2.0", method };
    if (!notify) body.id = nextId++;
    if (params) body.params = params;
    const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!sessionId) sessionId = response.headers.get("mcp-session-id");
    if (notify) { assert.equal(response.status, 202); return null; }
    const text = await response.text();
    const ct = response.headers.get("content-type") ?? "";
    let payload;
    if (ct.includes("text/event-stream")) {
      let data = "";
      for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) data += line.slice(5).trimStart();
      payload = JSON.parse(data);
    } else { payload = JSON.parse(text); }
    if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  }
  return {
    async connect() {
      const result = await send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "laia-imap-sidecar", version: "0.1.0" },
      });
      await send("notifications/initialized", {}, { notify: true });
      return result;
    },
    send,
  };
}
function assertSchemas(byName) {
  const path = byName["extract_pdf_from_path"].inputSchema;
  assert.equal(path.properties.path.type, "string");
  assert.equal(path.properties.path.minLength, 1);
  assert.equal(path.properties.path.maxLength, 4096);
  assert.ok(path.required.includes("path"));
  assert.equal(path.properties.maxPages.minimum, 1);
  assert.equal(path.properties.maxPages.maximum, 200);
  assert.equal(path.properties.maxChars.maximum, 200000);
  const base64 = byName["extract_pdf_from_base64"].inputSchema;
  assert.equal(base64.properties.data.type, "string");
  assert.equal(base64.properties.data.minLength, 1);
  assert.ok(base64.required.includes("data"));
  assert.equal(base64.properties.name.maxLength, 256);
  assert.equal(base64.properties.maxPages.maximum, 200);
  assert.equal(base64.properties.maxChars.maximum, 200000);
  const llm = byName["extract_pdf_with_llm"].inputSchema;
  assert.equal(llm.properties.path.minLength, 1);
  assert.equal(llm.properties.path.maxLength, 4096);
  assert.ok(llm.required.includes("path"));
  assert.equal(llm.properties.prompt.minLength, 1);
  assert.equal(llm.properties.prompt.maxLength, 16000);
  assert.equal(llm.properties.maxTokens.minimum, 256);
  assert.equal(llm.properties.maxTokens.maximum, 16000);
}

const EXTRACT_STUB = async () => ({ text: "x", pages: 1, truncated: false, invoiceFields: {} });

function loadFrozenTools() {
  return JSON.parse(readFileSync(new URL("./fixtures/openclaw-tools-v1.json", import.meta.url), "utf8"));
}

test("static: server dispatches /mcp and facade lists the three legacy tools", () => {
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const facade = readFileSync(new URL("../src/mcp-facade.js", import.meta.url), "utf8");
  assert.match(server, /url\.pathname === "\/mcp"/, "server must dispatch /mcp");
  assert.match(server, /getMcpFacade\(\)\.handleMcpRequest/, "server must call into the facade");
  for (const name of LEGACY_TOOL_NAMES) assert.ok(facade.includes(`"${name}"`), `facade must register ${name}`);
});

test("local: laia-shaped client lists the three legacy tools with exact schemas", async () => {
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = laiaClient(baseUrl);
    const init = await client.connect();
    assert.equal(init.serverInfo.name, "pdf-tool");
    assert.equal(typeof init.protocolVersion, "string");
    const { tools } = await client.send("tools/list");
    assert.deepEqual(tools.map((t) => t.name).sort(), [...LEGACY_TOOL_NAMES].sort());
    assertSchemas(Object.fromEntries(tools.map((t) => [t.name, t])));
  });
});

test("contract freeze: laia tools/list matches the frozen openclaw-tools-v1.json fixture", async () => {
  const frozen = [...loadFrozenTools().tools].sort((a, b) => a.name.localeCompare(b.name));
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = laiaClient(baseUrl);
    await client.connect();
    const { tools } = await client.send("tools/list");
    const live = tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(live.map((t) => t.name), frozen.map((t) => t.name), "tool names must match the frozen v1 contract");
    assert.deepEqual(live, frozen, "tool schemas must match the frozen v1 contract");
  });
});

test("laia client: extract_pdf_from_base64 returns the deterministic result meaning", async () => {
  const data = Buffer.from("%PDF-1.4\nx\n%%EOF\n").toString("base64");
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = laiaClient(baseUrl);
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_base64",
      arguments: { data, name: "doc.pdf" },
    });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.confidence, "deterministic");
    assert.equal(payload.source, "plain-text");
    assert.equal(payload.parser, "plain-text");
    assert.equal(payload.sha256.length, 64);
    assert.ok(payload.trustBoundary.length > 0);
    assert.equal(payload.pages, 1);
    assert.equal(payload.truncated, false);
    assert.ok(Array.isArray(payload.lineItems));
  });
});

test("live: laia smoke runs against the running pdf-tool container when both services are Up", () => {
  const composeFile = "/home/jmon/openclaw/docker-compose2.yml";
  const ps = spawnSync("docker", ["compose", "-f", composeFile, "ps", "pdf-tool", "laia-imap-sidecar"], { encoding: "utf8" }).stdout ?? "";
  if (!/pdf-tool\s+.*Up/.test(ps) || !/laia-imap-sidecar\s+.*Up/.test(ps)) return;
  const smokePath = new URL("./fixtures/openclaw-live-smoke.mjs", import.meta.url).pathname;
  const result = spawnSync(
    "docker", ["compose", "-f", composeFile, "exec", "-T", "laia-imap-sidecar", "node", "--input-type=module"],
    { input: readFileSync(smokePath, "utf8"), encoding: "utf8" },
  );
  assert.equal(result.status, 0, `live smoke failed: ${result.stderr}`);
  assert.match(result.stdout, /openclaw-live-smoke: ok/);
  assert.match(result.stdout, /tools=extract_pdf_from_base64,extract_pdf_from_path,extract_pdf_with_llm/);
});
