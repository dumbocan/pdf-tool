// WU-1A3 live smoke: laia-shaped handshake (protocol 2024-11-05, session reuse,
// tools/list) against the live pdf-tool container. Std-in module; run via
//   docker compose -f /home/jmon/openclaw/docker-compose2.yml exec -T \
//     laia-imap-sidecar node --input-type=module < test/fixtures/openclaw-live-smoke.mjs
// Content-free stdout only; no path/base64/LLM calls; no mail/credentials.

const URL = process.env.PDF_TOOL_URL || "http://pdf-tool:3000/mcp";
const TOOL_NAMES = ["extract_pdf_from_path", "extract_pdf_from_base64", "extract_pdf_with_llm"];

let sessionId = null;
let nextId = 1;

async function send(method, params, { notify = false } = {}) {
  const body = { jsonrpc: "2.0", method };
  if (!notify) body.id = nextId++;
  if (params) body.params = params;
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetch(URL, { method: "POST", headers, body: JSON.stringify(body) });
  if (!sessionId) sessionId = response.headers.get("mcp-session-id");
  if (notify) { if (response.status !== 202) throw new Error(`notify ${method} status ${response.status}`); return null; }
  const text = await response.text();
  const ct = response.headers.get("content-type") ?? "";
  let payload;
  if (ct.includes("text/event-stream")) {
    let data = "";
    for (const line of text.split(/\r?\n/)) if (line.startsWith("data:")) data += line.slice(5).trimStart();
    payload = JSON.parse(data);
  } else { payload = JSON.parse(text); }
  if (payload.error) throw new Error(`${payload.error.code}: ${payload.error.message}`);
  return payload;
}

async function main() {
  try {
    const init = await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "laia-imap-sidecar", version: "0.1.0" } });
    const initResult = init.result ?? {};
    if (!sessionId) throw new Error("initialize did not return mcp-session-id");
    await send("notifications/initialized", {}, { notify: true });
    const list = await send("tools/list");
    const tools = list.result?.tools ?? [];
    const names = tools.map((t) => t.name).sort();
    if (JSON.stringify(names) !== JSON.stringify([...TOOL_NAMES].sort())) throw new Error(`tool names drift: ${JSON.stringify(names)}`);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    const path = byName["extract_pdf_from_path"].inputSchema;
    if (path.properties.path.minLength !== 1 || path.properties.path.maxLength !== 4096) throw new Error("path bounds drift");
    if (!path.required.includes("path")) throw new Error("path required drift");
    const base64 = byName["extract_pdf_from_base64"].inputSchema;
    if (base64.properties.data.minLength !== 1) throw new Error("data minLength drift");
    if (!base64.required.includes("data")) throw new Error("data required drift");
    const llm = byName["extract_pdf_with_llm"].inputSchema;
    if (llm.properties.maxTokens.minimum !== 256 || llm.properties.maxTokens.maximum !== 16000) throw new Error("maxTokens bounds drift");
    console.log("openclaw-live-smoke: ok");
    console.log(`  protocol=${initResult.protocolVersion ?? "unknown"}`);
    console.log(`  session=${sessionId.length} chars`);
    console.log(`  tools=${names.join(",")}`);
    process.exit(0);
  } catch (error) {
    console.error(`openclaw-live-smoke: failed: ${error.message}`);
    process.exit(1);
  }
}

main();
