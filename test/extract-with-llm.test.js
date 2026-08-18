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

for (const [label, options] of [
  ["without an api key configured", {}],
  ["with an api key configured (still fail-closed)", { llmApiKey: "test-key" }],
]) {
  test(`/extract-with-llm returns 503 provider_disabled ${label} without ever calling the provider`, async () => {
    let providerCalls = 0;
    const fetchImpl = async () => {
      providerCalls += 1;
      return new Response(JSON.stringify({ choices: [] }), { status: 200 });
    };
    await withServer(
      { extract: async () => ({ text: "x", pages: 1, truncated: false, invoiceFields: {} }), fetchImpl, ...options },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/extract-with-llm`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: requestBody(),
        });
        assert.equal(response.status, 503);
        assert.equal(providerCalls, 0);
        const payload = await response.json();
        assert.equal(payload.ok, false);
        assert.equal(payload.protocolVersion, 1);
        assert.equal(payload.requestId, "server");
        assert.equal(payload.error.code, "provider_disabled");
        assert.equal(payload.error.messageKey, "llm_provider_disabled");
        assert.equal(payload.error.retry, "never");
      },
    );
  });
}

test("/extract-with-llm returns provider_disabled before any body parse", async () => {
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    return new Response("{}", { status: 200 });
  };
  await withServer({ llmApiKey: "test-key", fetchImpl }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/extract-with-llm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, "provider_disabled");
    assert.equal(providerCalls, 0);
  });
});

test("/extract-with-llm stays fail-closed under bearer authentication", async () => {
  await withServer(
    { authToken: "secret", llmApiKey: "test-key" },
    async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody(),
      });
      assert.equal(unauthorized.status, 401);

      const authorized = await fetch(`${baseUrl}/extract-with-llm`, {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: requestBody(),
      });
      assert.equal(authorized.status, 503);
      const payload = await authorized.json();
      assert.equal(payload.error.code, "provider_disabled");
    },
  );
});
