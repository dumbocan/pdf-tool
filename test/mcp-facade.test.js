import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
import { ProviderDisabledError } from "../src/privacy-service.js";

const PROTOCOL_VERSION = "2025-03-26";
const TOOL_NAMES = [
  "extract_pdf_from_path",
  "extract_pdf_from_base64",
  "extract_pdf_with_llm",
];

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
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
    const body = {
      jsonrpc: "2.0",
      ...(notify ? {} : { id }),
      method,
      ...(params ? { params } : {}),
    };
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...authHeader,
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    sessionId = sessionId || response.headers.get("mcp-session-id");
    if (notify) {
      assert.equal(response.status, 202);
      return null;
    }
    const payload = await readResponseBody(response);
    if (payload.error)
      throw new Error(`${payload.error.code}: ${payload.error.message}`);
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

const EXTRACT_STUB = async () => ({
  text: "plain document text",
  pages: 1,
  truncated: false,
  invoiceFields: {},
});

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
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      [...TOOL_NAMES].sort(),
    );
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    const pathTool = byName["extract_pdf_from_path"];
    assert.equal(pathTool.inputSchema.properties.path.type, "string");
    assert.equal(pathTool.inputSchema.properties.path.minLength, 1);
    assert.equal(pathTool.inputSchema.properties.path.maxLength, 4096);
    assert.ok(pathTool.inputSchema.required.includes("path"));
    assert.deepEqual(
      {
        minimum: pathTool.inputSchema.properties.maxPages.minimum,
        maximum: pathTool.inputSchema.properties.maxPages.maximum,
      },
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
      {
        minimum: llmTool.inputSchema.properties.maxTokens.minimum,
        maximum: llmTool.inputSchema.properties.maxTokens.maximum,
      },
      { minimum: 256, maximum: 16000 },
    );
  });
});

test("extract_pdf_from_base64 translates to /extract and returns structured content with source/confidence", async () => {
  const data = Buffer.from("%PDF-1.4\nbase64 test pdf bytes\n%%EOF\n").toString(
    "base64",
  );
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

test("mcp path tools return the migration payload without exposing stack traces or the path", async () => {
  await withServer({ extract: EXTRACT_STUB }, async (baseUrl) => {
    const client = mcpClient(baseUrl);
    await client.connect();
    const result = await client.send("tools/call", {
      name: "extract_pdf_from_path",
      arguments: { path: "/etc/passwd" },
    });
    assert.equal(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.error, "unsafe_path_contract_removed_v1");
    assert.doesNotMatch(result.content[0].text, /at |stack|passwd/i);
  });
});

test("backend extraction failures map to a clean MCP error without stacks", async () => {
  await withServer(
    {
      extract: async () => {
        throw new Error("boom");
      },
    },
    async (baseUrl) => {
      const client = mcpClient(baseUrl);
      await client.connect();
      const result = await client.send("tools/call", {
        name: "extract_pdf_from_base64",
        arguments: {
          data: Buffer.from("%PDF-1.4\nboom bytes\n%%EOF\n").toString("base64"),
        },
      });
      assert.equal(result.isError, true);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.error, "invalid PDF extraction request");
      assert.doesNotMatch(result.content[0].text, /at |stack|boom/i);
    },
  );
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
  await withServer(
    { authToken: "secret", extract: EXTRACT_STUB },
    async (baseUrl) => {
      const client = mcpClient(baseUrl, "secret");
      await client.connect();
      const result = await client.send("tools/call", {
        name: "extract_pdf_from_base64",
        arguments: {
          data: Buffer.from("%PDF-1.4\nx\n%%EOF\n").toString("base64"),
        },
      });
      assert.equal(result.isError, undefined);
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.confidence, "deterministic");
    },
  );
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

// ---- WU-1B3: versioned unsafe-path migration ----

// Spies on the fs primitives the removed path authority used to touch, so the
// migration can be proven to reject before any stat/realpath/readFile work.
function spyFs() {
  const calls = { readFile: 0, stat: 0, realpath: 0 };
  const originals = {
    readFile: fs.promises.readFile,
    stat: fs.promises.stat,
    realpath: fs.promises.realpath,
  };
  fs.promises.readFile = async (...args) => {
    calls.readFile += 1;
    return originals.readFile(...args);
  };
  fs.promises.stat = async (...args) => {
    calls.stat += 1;
    return originals.stat(...args);
  };
  fs.promises.realpath = async (...args) => {
    calls.realpath += 1;
    return originals.realpath(...args);
  };
  return {
    calls,
    restore() {
      fs.promises.readFile = originals.readFile;
      fs.promises.stat = originals.stat;
      fs.promises.realpath = originals.realpath;
    },
  };
}

test("extract_pdf_from_path returns the versioned migration result without filesystem access", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  const spy = spyFs();
  try {
    await writeFile(
      path.join(workspace, "doc.pdf"),
      "%PDF-1.4\nworkspace pdf bytes\n%%EOF\n",
    );
    await withServer(
      { workspaceRoot: workspace, extract: EXTRACT_STUB },
      async (baseUrl) => {
        const client = mcpClient(baseUrl);
        await client.connect();
        const result = await client.send("tools/call", {
          name: "extract_pdf_from_path",
          arguments: { path: path.join(workspace, "doc.pdf"), maxPages: 5 },
        });
        assert.equal(result.isError, true);
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.error, "unsafe_path_contract_removed_v1");
        assert.ok(
          typeof payload.guidance === "string" && payload.guidance.length > 0,
        );
        assert.doesNotMatch(
          result.content[0].text,
          /doc\.pdf/,
          "must not echo the supplied path",
        );
        assert.equal(spy.calls.readFile, 0);
        assert.equal(spy.calls.stat, 0);
        assert.equal(spy.calls.realpath, 0);
      },
    );
  } finally {
    spy.restore();
    await rm(workspace, { recursive: true, force: true });
  }
});

test("extract_pdf_with_llm returns the fail-closed provider_disabled envelope without ever calling the provider", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  const spy = spyFs();
  try {
    await writeFile(
      path.join(workspace, "manual.pdf"),
      "%PDF-1.4\nllm pdf bytes\n%%EOF\n",
    );
    let providerCalls = 0;
    const fetchImpl = async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    };
    await withServer(
      {
        workspaceRoot: workspace,
        llmApiKey: "test-key",
        extract: EXTRACT_STUB,
        fetchImpl,
      },
      async (baseUrl) => {
        const client = mcpClient(baseUrl);
        await client.connect();
        const result = await client.send("tools/call", {
          name: "extract_pdf_with_llm",
          arguments: {
            path: path.join(workspace, "manual.pdf"),
            prompt: "Extract the title",
          },
        });
        assert.equal(result.isError, true);
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.ok, false);
        assert.equal(payload.protocolVersion, 1);
        assert.equal(payload.error.code, "provider_disabled");
        assert.equal(payload.error.messageKey, "llm_provider_disabled");
        assert.equal(payload.error.retry, "never");
        assert.equal(providerCalls, 0);
        assert.equal(spy.calls.readFile, 0);
        assert.equal(spy.calls.realpath, 0);
      },
    );
  } finally {
    spy.restore();
    await rm(workspace, { recursive: true, force: true });
  }
});

// WU-3D1: the LLM tool must wire through PrivacyTransactionService.prepare().
// We inject a fake service that records the call (proving the wiring) and
// throws the real ProviderDisabledError so the adapter's catch handles it.
test("extract_pdf_with_llm wires through PrivacyTransactionService.prepare() and returns provider_disabled", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  await writeFile(
    path.join(workspace, "manual.pdf"),
    "%PDF-1.4\nllm pdf bytes\n%%EOF\n",
  );
  let prepareCalls = 0;
  let lastPrepareArgs = null;
  const fakeService = {
    prepare(args) {
      prepareCalls += 1;
      lastPrepareArgs = args;
      throw new ProviderDisabledError(args.providerId);
    },
  };
  try {
    await withServer(
      { workspaceRoot: workspace, privacyService: fakeService },
      async (baseUrl) => {
        const client = mcpClient(baseUrl);
        await client.connect();
        const result = await client.send("tools/call", {
          name: "extract_pdf_with_llm",
          arguments: {
            path: path.join(workspace, "manual.pdf"),
            prompt: "Extract the title",
          },
        });
        assert.equal(result.isError, true);
        assert.equal(prepareCalls, 1, "prepare() must be called once");
        assert.equal(lastPrepareArgs.providerId, "minimax");
        assert.equal(lastPrepareArgs.modelId, "MiniMax-M3");
        assert.equal(lastPrepareArgs.purpose, "extract_invoice");
        assert.equal(lastPrepareArgs.disclosureVersion, "v1");
        assert.equal(lastPrepareArgs.transformedPolicyVersion, "pseudonymize-v1");
        assert.equal(typeof lastPrepareArgs.documentId, "string");
        assert.equal(lastPrepareArgs.documentId.length, 22);
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.error.code, "provider_disabled");
        assert.equal(payload.error.messageKey, "llm_provider_disabled");
        assert.equal(payload.error.retry, "never");
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("extract_pdf_from_path rejects workspace escape and symlink with the migration result, no fs read", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-mcp-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "pdf-tool-outside-"));
  const spy = spyFs();
  try {
    await writeFile(
      path.join(outside, "secret.pdf"),
      "%PDF-1.4\nsecret\n%%EOF\n",
    );
    await symlink(
      path.join(outside, "secret.pdf"),
      path.join(workspace, "link.pdf"),
    );
    await withServer(
      { workspaceRoot: workspace, extract: EXTRACT_STUB },
      async (baseUrl) => {
        const client = mcpClient(baseUrl);
        await client.connect();
        const escape = await client.send("tools/call", {
          name: "extract_pdf_from_path",
          arguments: { path: path.join(workspace, "../secret.pdf") },
        });
        assert.equal(escape.isError, true);
        assert.equal(
          JSON.parse(escape.content[0].text).error,
          "unsafe_path_contract_removed_v1",
        );

        const link = await client.send("tools/call", {
          name: "extract_pdf_from_path",
          arguments: { path: path.join(workspace, "link.pdf") },
        });
        assert.equal(link.isError, true);
        assert.equal(
          JSON.parse(link.content[0].text).error,
          "unsafe_path_contract_removed_v1",
        );
        assert.equal(spy.calls.readFile, 0);
        assert.equal(spy.calls.realpath, 0);
      },
    );
  } finally {
    spy.restore();
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
