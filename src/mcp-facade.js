// MCP facade for pdf-tool v0.2.
//
// Exposes the v0.2 REST engine (POST /extract, POST /extract-with-llm) as the
// three legacy MCP tools (extract_pdf_from_path, extract_pdf_from_base64,
// extract_pdf_with_llm) so existing MCP clients keep their allowlist unchanged
// while receiving the structured v0.2 payloads (text, invoiceFields, lineItems,
// source/confidence, truncation).
//
// The facade runs inside the same HTTP server as the REST endpoints and calls
// them over loopback fetch; REST errors are translated into MCP error content
// without exposing stack traces.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { HARD_MAX_PAGES, HARD_MAX_CHARS } from "./extract.js";

const PDF_MAGIC = Buffer.from("%PDF-", "utf8");
const MAX_PDF_BYTES = 12 * 1024 * 1024;
// Matches the v1 sidecar cap: a 12 MiB raw PDF expands to ~16 MiB of base64.
const MAX_MCP_REQUEST_BODY_BYTES = 16 * 1024 * 1024;
const LLM_MAX_PROMPT_CHARS = 16_000;
const LLM_MAX_TOKENS = 16_000;

// Versioned migration envelope for removed arbitrary-path document authority.
// The HTTP /extract-path route and the MCP path tools return this exact payload
// before any stat/realpath/readFile/extraction work. The frozen tool names and
// schemas stay listed so consumers see an explicit typed result rather than a
// vanished tool.
export const UNSAFE_PATH_MIGRATION = Object.freeze({
  error: "unsafe_path_contract_removed_v1",
  guidance:
    "Arbitrary path-based document extraction is removed in this version. " +
    "Upload PDF bytes instead (HTTP POST /extract with base64 data, or MCP " +
    "extract_pdf_from_base64); a versioned workspace/capability contract may " +
    "restore workspace-bounded path access in a future release.",
});

// Fail-closed envelope for the raw-LLM egress points (HTTP /extract-with-llm,
// CLI --llm, and MCP extract_pdf_with_llm). Slice 3 requires every LLM call
// to flow through PrivacyTransactionService mediation, so these routes return
// provider_disabled unconditionally — even when llmApiKey is configured.
export const LLM_PROVIDER_DISABLED = Object.freeze({
  ok: false,
  protocolVersion: 1,
  requestId: "server",
  error: {
    code: "provider_disabled",
    messageKey: "llm_provider_disabled",
    retry: "never",
  },
});

class HttpBodyTooLargeError extends Error {
  constructor() {
    super("HTTP request body too large");
    this.name = "HttpBodyTooLargeError";
  }
}

function resolveWorkspaceRoot(value) {
  return path.resolve(
    value || process.env.WORKSPACE_ROOT || "/home/node/.openclaw/workspace",
  );
}

function assertInsideWorkspace(workspaceRoot, targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Path is outside the workspace");
    error.status = 400;
    throw error;
  }
  return resolved;
}

async function readPdfFromPath(pathValue) {
  const buffer = await readFile(pathValue);
  if (buffer.length === 0) {
    const error = new Error("PDF file is empty");
    error.status = 400;
    throw error;
  }
  if (buffer.length > MAX_PDF_BYTES) {
    const error = new Error("PDF exceeds the size limit");
    error.status = 413;
    throw error;
  }
  const head = buffer.subarray(0, PDF_MAGIC.length).toString("ascii");
  if (head !== PDF_MAGIC.toString("ascii")) {
    const error = new Error("PDF file has invalid magic bytes");
    error.status = 400;
    throw error;
  }
  return buffer;
}

async function readBoundedJsonBody(
  request,
  maxBytes = MAX_MCP_REQUEST_BODY_BYTES,
) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const length = chunk?.length ?? 0;
    total += length;
    if (total > maxBytes) {
      if (typeof request.destroy === "function") request.destroy();
      throw new HttpBodyTooLargeError();
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function failureEvent(tool, error, extra = {}) {
  console.error(
    JSON.stringify({
      event: "pdf_tool_failure",
      tool,
      error: error?.constructor?.name ?? "Error",
      status: typeof error?.status === "number" ? error.status : null,
      ...extra,
    }),
  );
}

function failureEnvelope(tool, error, extra = {}) {
  failureEvent(tool, error, extra);
  const message =
    typeof error?.message === "string" && error.message
      ? error.message
      : "PDF extraction tool is unavailable.";
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// Shared MCP result shape for the removed arbitrary-path tools. Emits the
// versioned migration envelope without logging or echoing the supplied path.
function unsafePathMigrationResult() {
  return {
    content: [{ type: "text", text: JSON.stringify(UNSAFE_PATH_MIGRATION) }],
    isError: true,
  };
}

// Shared MCP result shape for the raw-LLM egress point. Emits the
// fail-closed provider_disabled envelope without touching any workspace or
// provider; the Slice 3 PrivacyTransactionService contract owns LLM access.
function llmProviderDisabledResult() {
  return {
    content: [{ type: "text", text: JSON.stringify(LLM_PROVIDER_DISABLED) }],
    isError: true,
  };
}

export function createMcpFacade({
  port = Number(process.env.PORT ?? 3000),
  authToken = "",
  extractUrl = `http://127.0.0.1:${port}/extract`,
  llmExtractUrl = `http://127.0.0.1:${port}/extract-with-llm`,
  workspaceRoot = resolveWorkspaceRoot(),
  fetchImpl = globalThis.fetch,
} = {}) {
  const sessions = new Map();

  async function callRest(url, body) {
    const headers = { "content-type": "application/json" };
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      const error = new Error("pdf-tool REST endpoint is unreachable");
      error.status = 502;
      throw error;
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // non-JSON upstream response; the status check below still applies
    }
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        typeof payload.error === "string"
          ? payload.error
          : `pdf-tool REST endpoint failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.publicMessage = message;
      throw error;
    }
    return payload;
  }

  // The SDK binds one transport per session, so each initialize creates a fresh
  // McpServer (same pattern as the v1 sidecar) with the same three tools.
  function buildMcpServer() {
    const server = new McpServer({ name: "pdf-tool", version: "0.2.0" });

    server.registerTool(
      "extract_pdf_from_path",
      {
        description:
          "Extract text, invoice fields, and tabular line items from a PDF inside the agent workspace. " +
          "Path must be absolute and inside /home/node/.openclaw/workspace. Returns plain text and a " +
          "heuristic Mercadona line item array; non-tabular PDFs return parser: 'plain-text' with empty lineItems.",
        inputSchema: z.object({
          path: z.string().min(1).max(4096),
          maxPages: z.number().int().min(1).max(HARD_MAX_PAGES).optional(),
          maxChars: z.number().int().min(1).max(HARD_MAX_CHARS).optional(),
        }),
      },
      async () => {
        // Removed arbitrary path authority (versioned migration): return the
        // typed result before any workspace resolution or filesystem access.
        return unsafePathMigrationResult();
      },
    );

    server.registerTool(
      "extract_pdf_from_base64",
      {
        description:
          "Extract text, invoice fields, and tabular line items from base64-encoded PDF bytes. " +
          "Useful for mail sidecars that already fetched the attachment and want to share the parser " +
          "with the workspace path tool.",
        inputSchema: z.object({
          data: z.string().min(1),
          name: z.string().min(1).max(256).optional(),
          maxPages: z.number().int().min(1).max(HARD_MAX_PAGES).optional(),
          maxChars: z.number().int().min(1).max(HARD_MAX_CHARS).optional(),
        }),
      },
      async (input) => {
        try {
          const body = { data: input.data };
          if (input.name !== undefined) body.name = input.name;
          if (input.maxPages !== undefined) body.maxPages = input.maxPages;
          if (input.maxChars !== undefined) body.maxChars = input.maxChars;
          const result = await callRest(extractUrl, body);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return failureEnvelope("extract_pdf_from_base64", error, {
            name: typeof input?.name === "string" ? input.name : null,
          });
        }
      },
    );

    server.registerTool(
      "extract_pdf_with_llm",
      {
        description:
          "Universal PDF extraction via LLM (MiniMax-M3 by default). Use when the heuristic " +
          "Mercadona parser is not enough: manuals, contracts, generic invoices, etc. The LLM is " +
          "called with the extracted text dump and a configurable prompt; returns the LLM's JSON " +
          "response. Slower (~30-90s) and costs tokens — prefer extract_pdf_from_path for known " +
          "Mercadona-shaped PDFs.",
        inputSchema: z.object({
          path: z.string().min(1).max(4096),
          prompt: z.string().min(1).max(LLM_MAX_PROMPT_CHARS).optional(),
          maxTokens: z.number().int().min(256).max(LLM_MAX_TOKENS).optional(),
        }),
      },
      async () => {
        // Fail-closed legacy raw-LLM route (WU-2D): Slice 3 requires every
        // LLM call to flow through PrivacyTransactionService mediation, so
        // this tool never reaches a provider. The typed envelope is emitted
        // before any workspace resolution, file read, or upstream call.
        return llmProviderDisabledResult();
      },
    );

    return server;
  }

  async function handleMcpRequest(request, response) {
    if (!["POST", "GET", "DELETE"].includes(request.method ?? "")) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const body = await readBoundedJsonBody(request);
      const sessionId = request.headers["mcp-session-id"];
      if (typeof sessionId === "string" && sessions.has(sessionId)) {
        return sessions.get(sessionId).handleRequest(request, response, body);
      }
      if (!sessionId && body?.method === "initialize") {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => sessions.set(id, transport),
        });
        transport.onclose = () =>
          transport.sessionId && sessions.delete(transport.sessionId);
        await buildMcpServer().connect(transport);
        return transport.handleRequest(request, response, body);
      }
      response.writeHead(sessionId ? 404 : 400).end();
    } catch (error) {
      if (error instanceof HttpBodyTooLargeError) {
        console.error(
          JSON.stringify({
            event: "pdf_tool_body_too_large",
            error: error.constructor.name,
          }),
        );
        return response.writeHead(400).end();
      }
      response.writeHead(400).end();
    }
  }

  return {
    handleMcpRequest,
    async close() {
      for (const transport of sessions.values()) {
        await transport.close().catch(() => {});
      }
      sessions.clear();
    },
  };
}
