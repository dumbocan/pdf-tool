import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";

const PROTOCOL_VERSION = "2025-03-26";
const TOOL_NAMES = ["extract_pdf_from_path", "extract_pdf_from_base64", "extract_pdf_with_llm"];

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

// Minimal Streamable HTTP MCP client for the facade under test. The SDK (as in
// v1) responds to POST requests with SSE by default, so the client parses both
// JSON and text/event-stream bodies like a real MCP client does.
function mcpClient(baseUrl, token) {
  let sessionId = null;
  let nextId = 1;
  const authHeader = token ? { authorization: `Bearer ${token}` } : {};

  async function readResponseBody(response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) return response.json();
    const text = await response.text();
    let payload = null;
    let dataLines = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line === "" && dataLines.length) {
        payload = JSON.parse(dataLines.join("\n"));
        dataLines = [];
      }
    }
    if (dataLines.length) payload = JSON.parse(dataLines.join("\n"));
    return payload;
  }

  async function send(method, params, { notify = false } = {}) {
    const id = nextId++;
    const body = { jsonrpc: "2.0", ...(notify ? {} : { id }), method, ...(params ? { params } : {}) };
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...authHeader,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
    sessionId = sessionId || response.headers.get("mcp-session-id");
    if (notify) {
      assert.equal(response.status, 202);
      return null;
    }
    const payload = await readResponseBody(response);
    if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  }
  return {
    async connect() {
      const result = await send("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "mcp-facade-test", version: "1.0.0" },
      });
      await send("notifications/initialized", {}, { notify: true });
      return result;
    },
    send,
  };
}

const EXTRACT_STUB = async () => ({ text: "plain document text", pages: 1, truncated: false, invoiceFields: {} });

test("mcp endpoint answers initialize with pdf-tool server info", async () => {
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    const result = await client.connect();
    assert.equal(result.serverInfo.name, "pdf-tool");
    assert.equal(result.serverInfo.version, "0.2.0");
    assert.equal(typeof result.protocolVersion, "string");
    assert.ok(result.capabilities && typeof result.capabilities === "object");
  });
});

test("tools/list exposes the three v1-compatible tools with matching schemas", async () => {
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    await client.connect();
    const { tools } = await client.send("tools/list");
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...TOOL_NAMES].sort());
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    const pathTool = byName["extract_pdf_from_path"];
    assert.equal(pathTool.inputSchema.properties.path.type, "string");
    assert.equal(pathTool.inputSchema.properties.path.minLength, 1);
    assert.equal(pathTool.inputSchema.properties.path.maxLength, 4096);
    assert.ok(pathTool.inputSchema.required.includes("path"));
    assert.deepEqual(
      { minimum: pathTool.inputSchema.properties.maxPages.minimum, maximum: pathTool.inputSchema.properties.maxPages.maximum },
      { minimum: 1, maximum: 200 },
    );
    assert.equal(pathTool.inputSchema.properties.maxChars.maximum, 200000);

    const base64Tool = byName["extract_pdf_from_base64"];
    assert.equal(base64Tool.inputSchema.properties.data.type, "string");
    assert.ok(base64Tool.inputSchema.required.includes("data"));
    assert.equal(base64Tool.inputSchema.properties.name.maxLength, 256);

    const llmTool = byName["extract_pdf_with_llm"];
    assert.ok(llmTool.inputSchema.required.includes("path"));
    assert.deepEqual(
      { minimum: llmTool.inputSchema.properties.maxTokens.minimum, maximum: llmTool.inputSchema.properties.maxTokens.maximum },
      { minimum: 256, maximum: 16000 },
    );
  });
});

test("extract_pdf_from_base64 translates to /extract and returns structured content with source/confidence", async () => {
  const data = Buffer.from("%PDF-1.4\nbase64 test pdf bytes\n%%EOF\n").toString("base64");
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_base64",
      arguments: { data, name: "doc.pdf", maxPages: 10, maxChars: 1000 },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].type, "text");
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.text, "plain document text");
    assert.equal(payload.source, "plain-text");
    assert.equal(payload.confidence, "deterministic");
    assert.equal(payload.parser, "plain-text");
    assert.ok(Array.isArray(payload.lineItems));
    assert.equal(payload.pages, 1);
    assert.equal(payload.truncated, false);
    assert.equal(payload.sha256.length, 64);
    assert.ok(payload.trustBoundary.length > 0);
  });
});

test("extract_pdf_from_path reads a PDF inside the workspace and returns structured content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  try {
    await writeFile(path.join(workspace, "doc.pdf"), "%PDF-1.4\nworkspace pdf bytes\n%%EOF\n");
    await withServer({ workspaceRoot: workspace, extract: EXTRACT_STUB }, async (baseUrl) => {
      const client = mcpClient(baseUrl);
      await client.connect();
      const result = await client.send("tools/call", {
        name: "extract_pdf_from_path",
        arguments: { path: path.join(workspace, "doc.pdf"), maxPages: 5 },
      });
      assert.equal(result.isError, undefined);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.text, "plain document text");
      assert.equal(payload.source, "plain-text");
      assert.equal(payload.confidence, "deterministic");
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("extract_pdf_with_llm translates to /extract-with-llm and returns LLM structured content", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  try {
    await writeFile(path.join(workspace, "manual.pdf"), "%PDF-1.4\nllm pdf bytes\n%%EOF\n");
    const llmFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            documentType: "manual",
            summary: "A manual.",
            fields: {},
            lineItems: [],
            sections: [],
            warnings: [],
          }) } }],
          usage: { total_tokens: 42 },
        }),
        { status: 200 },
      );
    await withServer({ workspaceRoot: workspace, llmApiKey: "test-key", fetchImpl: llmFetch, extract: EXTRACT_STUB }, async (baseUrl) => {
      const client = mcpClient(baseUrl);
      await client.connect();
      const result = await client.send("tools/call", {
        name: "extract_pdf_with_llm",
        arguments: { path: path.join(workspace, "manual.pdf"), prompt: "Extract the title", maxTokens: 512 },
      });
      assert.equal(result.isError, undefined);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.source, "minimax");
      assert.equal(payload.confidence, "model-derived");
      assert.equal(payload.structured.documentType, "manual");
      assert.ok(payload.rawResponse.length > 0);
      assert.equal(payload.llmModel, "MiniMax-M3");
      assert.equal(payload.name, "manual.pdf");
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("mcp errors return a JSON error payload without exposing stack traces", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  try {
    await withServer({ workspaceRoot: workspace, extract: EXTRACT_STUB }, async (baseUrl) => {
      const client = mcpClient(baseUrl);
      await client.connect();
      const result = await client.send("tools/call", {
        name: "extract_pdf_from_path",
        arguments: { path: "/etc/passwd" },
      });
      assert.equal(result.isError, true);
      const payload = JSON.parse(result.content[0].text);
      assert.deepEqual(payload, { error: "Path is outside the workspace" });
      assert.doesNotMatch(result.content[0].text, /at |stack/i);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("backend extraction failures map to a clean MCP error without stacks", async () => {
  await withServer({ extract: async () => { throw new Error("boom"); } }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_base64",
      arguments: { data: Buffer.from("%PDF-1.4\nboom bytes\n%%EOF\n").toString("base64") },
    });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error, "invalid PDF extraction request");
    assert.doesNotMatch(result.content[0].text, /at |stack|boom/i);
  });
});

test("invalid base64 input maps to the exact REST error message", async () => {
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_base64",
      arguments: { data: "not base64!" },
    });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error, "data must be a valid base64 string");
    assert.doesNotMatch(result.content[0].text, /at |stack/i);
  });
});

test("facade authenticates to the REST endpoints when AUTH_TOKEN is configured", async () => {
  await withServer({ authToken: "secret", extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl, "secret");
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_base64",
      arguments: { data: Buffer.from("%PDF-1.4\nx\n%%EOF\n").toString("base64") },
    });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.confidence, "deterministic");
  });
});

test("extract_pdf_from_path rejects traversal and missing files with clean MCP errors", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  try {
    await withServer({ workspaceRoot: workspace, extract: EXTRACT_STUB }, async (baseUrl) => {
      const client = mcpClient(baseUrl);
      await client.connect();
      const traversal = await client.send("tools/call", {
        name: "extract_pdf_from_path",
        arguments: { path: path.join(workspace, "../outside.pdf") },
      });
      assert.equal(traversal.isError, true);
      assert.deepEqual(JSON.parse(traversal.content[0].text), { error: "Path is outside the workspace" });

      const missing = await client.send("tools/call", {
        name: "extract_pdf_from_path",
        arguments: { path: path.join(workspace, "missing.pdf") },
      });
      assert.equal(missing.isError, true);
      assert.match(missing.content[0].text, /no such file|ENOENT/i);
      assert.doesNotMatch(missing.content[0].text, /at |stack/i);
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("MCP tool argument validation rejects out-of-range values as invalid params", async () => {
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_base64",
      arguments: { data: "AA==", maxPages: 5000 },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /invalid arguments/i);
    assert.match(result.content[0].text, /extract_pdf_from_base64/);
  });
});
