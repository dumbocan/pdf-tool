import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer } from "../src/server.js";

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

function pdfPayload() {
  return Buffer.from("%PDF-1.7\nprivate PDF bytes\n%%EOF");
}

function requestBody(overrides = {}) {
  return JSON.stringify({ data: pdfPayload().toString("base64"), ...overrides });
}

test("extract integrates the Mercadona parser only after three detected items", async () => {
  await withServer(
    {
      extract: async () => ({
        text: [
          "BEBIDA AVENA 1 6,0000 6,0000 EX 0,0000 6,0000",
          "PAVO A TACOS 1 4,0200 4,0200 EX 0,0000 4,0200",
          "CEBOLLA TUBO 1 2,5000 2,5000 EX 0,0000 2,5000",
        ].join("\n"),
        pages: 1,
        truncated: false,
        invoiceFields: {},
      }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.parser, "mercadona-tabular");
      assert.equal(result.parserStats.lineItemsDetected, 3);
      assert.equal(result.parserStats.sumLineItemTotals, 12.52);
      assert.deepEqual(Object.keys(result.lineItems[0]).sort(), [
        "base_eur",
        "description",
        "tax_eur",
        "tax_label",
        "total_eur",
        "unit_price_eur",
        "units",
      ]);
    },
  );
});

test("extract reports parser stats, line-item schema, and the reconciled total for a real Mercadona PDF", async () => {
  const pdf = await readFile(new URL("./fixtures/A-G2026-245895.pdf", import.meta.url));
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody({ data: pdf.toString("base64") }),
    });

    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.parser, "mercadona-tabular");
    assert.deepEqual(result.parserStats, {
      lineItemsDetected: 44,
      lineItemsSkipped: 2,
      sumLineItemTotals: 121.41,
    });
    assert.equal(result.lineItems.length, 44);
    assert.deepEqual(Object.keys(result.lineItems[0]).sort(), [
      "base_eur",
      "description",
      "tax_eur",
      "tax_label",
      "total_eur",
      "unit_price_eur",
      "units",
    ]);
  });
});

    test("extract-with-llm never sends PDF bytes upstream: no data field and no PDF magic in the request body", async () => {
      const pdf = pdfPayload();
      let upstreamRequest;
      await withServer(
        {
          llmApiKey: "test-key",
          extract: async () => ({ text: "Extracted text only", pages: 1, truncated: false, invoiceFields: {} }),
          fetchImpl: async (_url, options) => {
            upstreamRequest = JSON.parse(options.body);
            return new Response(JSON.stringify({ choices: [{ message: {
              content: JSON.stringify({
                documentType: "other",
                summary: "s",
                fields: {},
                lineItems: [],
                sections: [],
                warnings: [],
              }),
            } }] }), { status: 200 });
          },
        },
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/extract-with-llm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: requestBody(),
          });
          assert.equal(response.status, 200);
          assert.ok(upstreamRequest, "fetchImpl must have been invoked");
          assert.equal("data" in upstreamRequest, false, "base64 data must never be sent upstream");
          assert.equal("file" in upstreamRequest, false);
          const serialized = JSON.stringify(upstreamRequest);
          assert.doesNotMatch(serialized, /%PDF-/, "raw PDF bytes must never be sent upstream");
          assert.doesNotMatch(serialized, new RegExp(pdf.toString("base64")));
          assert.match(serialized, /Extracted text only/);
        },
      );
    });

    test("extract never falls back to the LLM: fetchImpl is not invoked on POST /extract even when llmApiKey is set", async () => {
      let fetchCalls = 0;
      await withServer(
        {
          llmApiKey: "test-key",
          extract: async () => ({ text: "deterministic only", pages: 1, truncated: false, invoiceFields: {} }),
          fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error("fetchImpl must never run on /extract");
          },
        },
        async (baseUrl) => {
          const response = await fetch(`${baseUrl}/extract`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: requestBody(),
          });
          assert.equal(response.status, 200);
          const result = await response.json();
          assert.equal(result.text, "deterministic only");
          assert.equal(result.source, "plain-text");
          assert.equal(fetchCalls, 0, "no provider call may happen on the deterministic route");
        },
      );
    });

    test("extract-with-llm returns a direct JSON invoice and disables thinking", async () => {
  const pdf = pdfPayload();
  let upstreamRequest;
  await withServer(
    {
      llmApiKey: "test-key",
      llmBaseUrl: "https://llm.test/v1",
      llmModel: "test-model",
      extract: async () => ({
        text: "PDF extracted text",
        pages: 2,
        truncated: false,
        invoiceFields: {},
      }),
      fetchImpl: async (_url, options) => {
        upstreamRequest = JSON.parse(options.body);
          return new Response(
            JSON.stringify({
               choices: [{
                 finish_reason: "stop",
                 message: {
                   content: JSON.stringify({
                     documentType: "invoice",
                     summary: "Invoice for office supplies.",
                     fields: { total: 12.34, currency: "EUR" },
                     lineItems: [{ description: "Paper", quantity: 2 }],
                     sections: [],
                     warnings: [],
                   }),
                 },
               }],
               model: "provider-model",
               usage: { total_tokens: 9 },
            }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody({ prompt: "Extract the total", maxTokens: 300, name: "invoice.pdf" }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.deepEqual(result.structured, {
        documentType: "invoice",
        summary: "Invoice for office supplies.",
        fields: { total: 12.34, currency: "EUR" },
        lineItems: [{ description: "Paper", quantity: 2 }],
        sections: [],
        warnings: [],
      });
       assert.equal(result.rawResponse, JSON.stringify(result.structured));
      assert.equal(result.llmModel, "test-model");
      assert.deepEqual(result.llmUsage, { total_tokens: 9 });
      assert.equal(result.name, "invoice.pdf");
      assert.equal(result.text, "PDF extracted text");
      assert.equal(upstreamRequest.model, "test-model");
      assert.equal(upstreamRequest.max_tokens, 300);
      assert.equal(upstreamRequest.messages[0].role, "system");
      assert.match(upstreamRequest.messages[0].content, /untrusted/i);
      assert.match(upstreamRequest.messages[1].content, /Extract the total/);
      assert.match(upstreamRequest.messages[1].content, /PDF extracted text/);
       assert.deepEqual(upstreamRequest.thinking, { type: "disabled" });
       assert.equal("tools" in upstreamRequest, false);
       assert.equal("tool_choice" in upstreamRequest, false);
      assert.doesNotMatch(upstreamRequest.messages[1].content, new RegExp(pdf.toString("base64")));
      assert.doesNotMatch(JSON.stringify(upstreamRequest), new RegExp(pdf.toString("utf8")));
    },
  );
});

test("extract-with-llm accepts one fenced JSON object for a manual", async () => {
  await withServer(
    {
      llmApiKey: "test-key",
      extract: async () => ({ text: "Manual extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: {
          content: '```json\n{"documentType":"manual","summary":"Setup guide","fields":{"model":"X"},"lineItems":[],"sections":[{"title":"Safety"}],"warnings":[]}\n```',
        } }],
      }), { status: 200 }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody({ name: "manual.pdf" }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.structured.documentType, "manual");
      assert.equal(result.structured.sections[0].title, "Safety");
    },
  );
});

test("extract-with-llm accepts one compatible structured tool call", async () => {
  await withServer(
    {
      llmApiKey: "test-key",
      extract: async () => ({ text: "Manual extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: {
        content: "",
        tool_calls: [{ type: "function", function: {
          name: "extract_document_structure",
          arguments: JSON.stringify({
            documentType: "manual",
            summary: "Setup guide",
            fields: {},
            lineItems: [],
            sections: [],
            warnings: [],
          }),
        } }],
      } }] }), { status: 200 }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).structured.documentType, "manual");
    },
  );
});

test("extract-with-llm returns deterministic 503 when the API key is missing", async () => {
  await withServer({ llmApiKey: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/extract-with-llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody(),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "LLM service is not configured" });
  });
});

test("extract-with-llm preserves bearer authentication", async () => {
  await withServer({ authToken: "secret", llmApiKey: "" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/extract-with-llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody(),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  });
});

test("extract-with-llm returns a stable upstream failure envelope", async () => {
  await withServer(
    {
      llmApiKey: "test-key",
      extract: async () => ({ text: "PDF extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () => new Response("upstream details", { status: 429 }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "LLM upstream request failed" });
    },
  );
});

test("extract-with-llm rejects missing tool arguments as an upstream-invalid response", async () => {
  await withServer(
    {
      llmApiKey: "test-key",
      extract: async () => ({ text: "PDF extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: {
          content: "",
          tool_calls: [{ type: "function", function: { name: "extract_document_structure" } }],
        } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "LLM upstream response invalid" });
    },
  );
});

test("extract-with-llm rejects invalid tool arguments as an upstream-invalid response", async () => {
  await withServer(
    {
      llmApiKey: "test-key",
      extract: async () => ({ text: "PDF extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: {
        content: "",
        tool_calls: [{ type: "function", function: {
          name: "extract_document_structure",
          arguments: "null",
        } }],
      } }] }), { status: 200 }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "LLM upstream response invalid" });
    },
  );
});

test("extract-with-llm rejects prose-only upstream responses", async () => {
  await withServer(
    {
      llmApiKey: "test-key",
      extract: async () => ({ text: "PDF extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: "I found an invoice." } }] }), {
        status: 200,
      }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "LLM upstream response invalid" });
    },
  );
});

for (const [label, content] of [
  ["incomplete objects", '{"documentType":"invoice"}'],
  ["null", "null"],
  ["arrays", "[]"],
]) {
  test(`extract-with-llm rejects ${label}`, async () => {
    await withServer(
      {
        llmApiKey: "test-key",
        extract: async () => ({ text: "PDF extracted text", pages: 1, truncated: false, invoiceFields: {} }),
        fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/extract-with-llm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody(),
        });
        assert.equal(response.status, 502);
        assert.deepEqual(await response.json(), { error: "LLM upstream response invalid" });
      },
    );
  });
}

test("extract-with-llm rejects a valid upstream response that exceeds the serialized response cap", async () => {
  await withServer(
    {
      maxResponseBytes: 256,
      llmApiKey: "test-key",
      extract: async () => ({ text: "PDF extracted text", pages: 1, truncated: false, invoiceFields: {} }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          documentType: "other",
          summary: "x".repeat(500),
          fields: {},
          lineItems: [],
          sections: [],
          warnings: [],
        }) } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(response.status, 413);
      assert.deepEqual(await response.json(), { error: "response exceeds the size limit" });
    },
  );
});
