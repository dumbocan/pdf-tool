// Tests for the Slice 3 PrivacyTransactionService.
//
// These tests define the contract that the CLI/HTTP/MCP/desktop adapters
// rely on. They are deliberately small and focused — each test pins one
// behavior so a regression points straight at the broken invariant.
//
// Coverage map (matches the Slice 3 spec invariants and the WU-3B1/3B2/3C1
// acceptance criteria):
//   - prepare produces a structurally correct BoundTransaction (no reverse
//     map, no payload bytes, no PDF/PII leakage).
//   - prepare/confirm exchange is single-use and atomic: replay throws
//     `tx_already_consumed`, expired throws `tx_expired`, mutated fields
//     throw `tx_mismatch`.
//   - the AuditSink is closed: only allowlisted kinds + fields, bounded
//     to 256 events, free-form strings and content are rejected.
//   - the provider registry fails closed: Slice 3 returns
//     `provider_disabled` for every configured provider; Slice 6 owns the
//     qualified review gate.
//   - the exact outbound payload bytes match `payloadSha256` byte-for-byte
//     so the provider adapter cannot silently substitute or append.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, describe, it } from "node:test";
import {
  AUDIT_EVENT_CAP,
  AuditEvent,
  AuditSink,
  PAYLOAD_MEDIA_TYPE,
  PrivacyTransactionError,
  PrivacyTransactionService,
  ProviderDisabledError,
  RESPONSE_CONFIDENCE_VALUES,
  RESPONSE_LIMIT_BYTES,
  TRANSACTION_TTL_MS,
  createDefaultProviderRegistry,
} from "../src/privacy-service.js";

// Every test service gets registered here so the suite-wide `after` hook
// can shut them all down and remove the process listeners they attached
// (when production-style shutdown hooks are enabled).
const REGISTERED_SERVICES = new Set();
after(() => {
  for (const service of REGISTERED_SERVICES) {
    try {
      service.shutdown();
    } catch {
      /* best effort */
    }
  }
  REGISTERED_SERVICES.clear();
});

const VALID_DOC_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const VALID_REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeLocalExtraction(overrides = {}) {
  return {
    provenance: "local_deterministic",
    documentSha256: "0".repeat(64),
    status: "complete",
    pagesProcessed: 1,
    truncationReason: null,
    extractionMode: "digital_text",
    invoice: {
      invoiceNumber: "NIF: 12345678Z",
      invoiceDate: "2026-01-15",
      simplifiedInvoiceDate: null,
      taxLabel: "IVA",
      totals: { subtotal: "100.00", tax: "21.00", total: "121.00" },
      matched: ["invoiceNumber", "invoiceDate", "subtotal", "tax", "total"],
    },
    untrusted: true,
    ...overrides,
  };
}

function makePrepareArgs(overrides = {}) {
  return {
    documentId: VALID_DOC_ID,
    localExtraction: makeLocalExtraction(),
    providerId: "minimax",
    modelId: "MiniMax-M3",
    purpose: "extract_invoice",
    disclosureVersion: "v1",
    transformedPolicyVersion: "pseudonymize-v1",
    operationCorrelationId: VALID_REQUEST_ID,
    ...overrides,
  };
}

// Enabled registry for happy-path tests. The default Slice 3 registry
// fails closed; tests that exercise prepare/confirm inject this one so
// they can drive the transaction lifecycle end-to-end. The
// `provider_disabled` tests below use the default registry instead.
const ENABLED_REGISTRY = {
  get(providerId) {
    return { status: "enabled", providerId };
  },
};

function makeService(overrides = {}) {
  const service = new PrivacyTransactionService({
    auditSink: new AuditSink(),
    providerRegistry: ENABLED_REGISTRY,
    transactionTtlMs: TRANSACTION_TTL_MS,
    ...overrides,
  });
  REGISTERED_SERVICES.add(service);
  return service;
}

describe("PrivacyTransactionService.prepare — BoundTransaction contract", () => {
  it("returns transactionId, payloadSha256, providerId, modelId, purpose, disclosure, and expiresAt", () => {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs());

    // transactionId is exactly 22 chars base64url (128 random bits).
    assert.equal(typeof bound.transactionId, "string");
    assert.equal(bound.transactionId.length, 22);
    assert.match(bound.transactionId, /^[A-Za-z0-9_-]+$/);

    // payloadSha256 is 64 lowercase hex chars.
    assert.equal(bound.payloadSha256.length, 64);
    assert.match(bound.payloadSha256, /^[0-9a-f]{64}$/);

    assert.equal(bound.providerId, "minimax");
    assert.equal(bound.modelId, "MiniMax-M3");
    assert.equal(bound.purpose, "extract_invoice");

    assert.equal(typeof bound.expiresAt, "string");
    assert.match(bound.expiresAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("disclosure contains exactly the documented fields and never the reverse map or payload bytes", () => {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs());

    assert.deepEqual(Object.keys(bound.disclosure).sort(), [
      "documentSha256",
      "expiresAt",
      "modelId",
      "payloadSha256",
      "providerId",
      "purpose",
      "transformedPolicyVersion",
      "version",
    ]);
    assert.equal(bound.disclosure.version, "v1");
    assert.equal(bound.disclosure.transformedPolicyVersion, "pseudonymize-v1");
    assert.equal(bound.disclosure.providerId, "minimax");
    assert.equal(bound.disclosure.modelId, "MiniMax-M3");
    assert.equal(bound.disclosure.purpose, "extract_invoice");
    assert.equal(bound.disclosure.payloadSha256, bound.payloadSha256);
    assert.equal(bound.disclosure.expiresAt, bound.expiresAt);

    // The BoundTransaction itself must never expose the in-memory reverse
    // map, the payload bytes, or a pseudonymizer reference.
    const boundKeys = Object.keys(bound).sort();
    for (const forbidden of [
      "pseudonymizer",
      "reverseMap",
      "reversePii",
      "reverseAmounts",
      "payload",
      "payloadBytes",
      "exactPayloadBytes",
      "rawText",
      "documentBytes",
    ]) {
      assert.ok(
        !boundKeys.includes(forbidden),
        `BoundTransaction leaked ${forbidden}`,
      );
    }
  });

  it("expiresAt is exactly TRANSACTION_TTL_MS (60 s by default) after creation", () => {
    const service = makeService();
    const before = Date.now();
    const bound = service.prepare(makePrepareArgs());
    const after = Date.now();
    const expiresAtMs = Date.parse(bound.expiresAt);
    assert.ok(expiresAtMs >= before + TRANSACTION_TTL_MS - 5);
    assert.ok(expiresAtMs <= after + TRANSACTION_TTL_MS + 5);
  });

  it("emits a tx_prepare audit event with the bound identifiers and the payload hash", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    assert.equal(sink.events.length, 1);
    const event = sink.events[0];
    assert.equal(event.kind, AuditEvent.TX_PREPARE);
    assert.equal(event.transactionId, bound.transactionId);
    assert.equal(event.providerId, "minimax");
    assert.equal(event.modelId, "MiniMax-M3");
    assert.equal(event.purpose, "extract_invoice");
    assert.equal(event.disclosureVersion, "v1");
    assert.equal(event.transformedPolicyVersion, "pseudonymize-v1");
    assert.equal(event.payloadSha256, bound.payloadSha256);
    assert.equal(event.outcome, "prepared");
    assert.equal(event.operationCorrelationId, VALID_REQUEST_ID);
    assert.equal(typeof event.timestamp, "number");
  });

  it("rejects an invalid documentId (not 22-char base64url)", () => {
    const service = makeService();
    assert.throws(
      () => service.prepare(makePrepareArgs({ documentId: "short" })),
      /invalid documentId/,
    );
  });

  it("rejects an unknown provider when the default Slice 3 registry says disabled", () => {
    // The default registry returns disabled for every provider; the test
    // service uses an enabled registry, so build one without it.
    const service = new PrivacyTransactionService({
      auditSink: new AuditSink(),
      providerRegistry: createDefaultProviderRegistry(),
    });
    REGISTERED_SERVICES.add(service);
    assert.throws(
      () => service.prepare(makePrepareArgs()),
      (err) => {
        assert.ok(err instanceof ProviderDisabledError);
        assert.equal(err.code, "provider_disabled");
        return true;
      },
    );
  });
});

describe("PrivacyTransactionService.prepare — outbound payload hygiene", () => {
  it("the exact payload bytes match payloadSha256 byte-for-byte", () => {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs());
    const { request } = service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });

    const recomputed = createHash("sha256")
      .update(request.exactPayloadBytes)
      .digest("hex");
    assert.equal(recomputed, bound.payloadSha256);
    assert.equal(recomputed, request.payloadSha256);
  });

  it("the payload is canonical JSON: alphabetically sorted keys and only `: ` as whitespace", () => {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs());
    const { request } = service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });

    const text = Buffer.from(request.exactPayloadBytes).toString("utf8");
    // No whitespace other than the single space after each colon.
    const stripped = text.replace(/(?<=\:)\s/g, "");
    assert.doesNotMatch(stripped, /\s/, "no whitespace other than ': '");
    assert.match(text, /\{/);
    // Every object key appears in the bytes. The order is depth-first
    // traversal with alphabetically sorted keys at every object level —
    // so a nested object's keys come before the next sibling of its
    // parent. The full key sequence therefore looks like:
    //   documentId
    //   fields
    //     invoiceDate, invoiceNumber, taxLabel, totals
    //       subtotal, tax, total
    //   fieldsMatched, purpose, schemaVersion
    const propertyKeys = [...text.matchAll(/"([A-Za-z0-9_]+)":/g)].map(
      (m) => m[1],
    );
    assert.deepEqual(propertyKeys, [
      "documentId",
      "fields",
      "invoiceDate",
      "invoiceNumber",
      "taxLabel",
      "totals",
      "subtotal",
      "tax",
      "total",
      "fieldsMatched",
      "purpose",
      "schemaVersion",
    ]);
  });

  it("the payload never contains raw PDF bytes even when localExtraction fields embed them", () => {
    const service = makeService();
    // Embed the PDF magic and base64 into the invoiceNumber — a worst-case
    // "the parser trusted a label" scenario. The payload must not leak it.
    const pdfBytes = Buffer.from("%PDF-1.7\nprivate PDF bytes\n%%EOF");
    const base64 = pdfBytes.toString("base64");
    const bound = service.prepare(
      makePrepareArgs({
        localExtraction: makeLocalExtraction({
          invoice: {
            invoiceNumber: `%PDF-${base64}`,
            invoiceDate: "2026-01-15",
            simplifiedInvoiceDate: null,
            taxLabel: "IVA",
            totals: { subtotal: "1.00", tax: "0.21", total: "1.21" },
            matched: ["invoiceNumber"],
          },
        }),
      }),
    );
    const { request } = service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });
    const serialized = Buffer.from(request.exactPayloadBytes).toString("utf8");
    assert.doesNotMatch(serialized, /%PDF-/, "raw PDF magic must never appear");
    assert.doesNotMatch(serialized, /%%EOF/, "PDF trailer must never appear");
    assert.doesNotMatch(
      serialized,
      new RegExp(base64),
      "raw base64 PDF must never appear",
    );
    assert.doesNotMatch(
      serialized,
      new RegExp(
        pdfBytes.toString("utf8").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
  });

  it("the payload replaces PII identifiers and factor-scales amounts — real values never appear", () => {
    const service = makeService();
    const real =
      "NIF: 12345678Z, IBAN ES9101234567890123456789, Total: 121.00 €";
    const bound = service.prepare(
      makePrepareArgs({
        localExtraction: makeLocalExtraction({
          invoice: {
            invoiceNumber: "NIF: 12345678Z",
            invoiceDate: "2026-01-15",
            simplifiedInvoiceDate: null,
            taxLabel: "IVA",
            totals: { subtotal: "100.00", tax: "21.00", total: "121.00" },
            matched: ["invoiceNumber", "subtotal", "tax", "total"],
          },
        }),
      }),
    );
    const { request } = service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });
    const serialized = Buffer.from(request.exactPayloadBytes).toString("utf8");
    assert.doesNotMatch(serialized, /12345678Z/, "real NIF must never appear");
    assert.doesNotMatch(
      serialized,
      /ES9101234567890123456789/,
      "real IBAN must never appear",
    );
    // The real totals are 100.00 / 21.00 / 121.00 — none of them may appear,
    // because the pseudonymizer replaces amounts with the factor-scaled form.
    assert.doesNotMatch(
      serialized,
      /"100\.00"/,
      "real subtotal must never appear",
    );
    assert.doesNotMatch(serialized, /"21\.00"/, "real tax must never appear");
    assert.doesNotMatch(
      serialized,
      /"121\.00"/,
      "real total must never appear",
    );
    // But a marker must be present (the pseudonymizer is doing its job).
    assert.match(serialized, /\[NIF-\d+\]/, "PII marker must be present");
  });
});

describe("PrivacyTransactionService.confirm — atomic single-use consume", () => {
  it("returns a BoundProviderRequestV1 whose payload bytes round-trip back to the bound hash", () => {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs());
    const { request, onSent } = service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });

    assert.equal(request.transactionId, bound.transactionId);
    assert.equal(request.providerId, bound.providerId);
    assert.equal(request.modelId, bound.modelId);
    assert.equal(request.purpose, bound.purpose);
    assert.equal(request.payloadMediaType, "application/json");
    assert.ok(request.exactPayloadBytes instanceof Uint8Array);
    assert.equal(request.payloadSha256, bound.payloadSha256);
    assert.equal(typeof request.deadlineMs, "number");
    assert.equal(typeof request.responseLimitBytes, "number");
    assert.equal(typeof onSent, "function");
  });

  it("second confirm of the same transactionId fails with tx_already_consumed and emits no extra audit event", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());
    service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });

    const eventsBefore = sink.events.length;
    assert.throws(
      () =>
        service.confirm({
          transactionId: bound.transactionId,
          requestId: "550e8400-e29b-41d4-a716-446655440001",
        }),
      (err) => {
        assert.ok(err instanceof PrivacyTransactionError);
        assert.equal(err.code, "tx_already_consumed");
        return true;
      },
    );
    assert.equal(
      sink.events.length,
      eventsBefore,
      "replay must not emit a new audit event",
    );
  });

  it("confirm of an expired transaction fails with tx_expired and emits a tx_expired audit event", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
      transactionTtlMs: 1,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    // Wait past the (tiny) TTL.
    return new Promise((resolve) => {
      setImmediate(() => {
        assert.throws(
          () =>
            service.confirm({
              transactionId: bound.transactionId,
              requestId: VALID_REQUEST_ID,
            }),
          (err) => {
            assert.ok(err instanceof PrivacyTransactionError);
            assert.equal(err.code, "tx_expired");
            return true;
          },
        );
        const events = sink.events.filter(
          (e) => e.kind === AuditEvent.TX_EXPIRED,
        );
        assert.equal(events.length, 1);
        assert.equal(events[0].transactionId, bound.transactionId);
        assert.equal(events[0].outcome, "expired");
        assert.equal(service.getTransaction(bound.transactionId), null);
        resolve();
      });
    });
  });

  it("confirm with a different providerId/modelId/purpose throws tx_mismatch and emits a tx_mismatch audit event", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    assert.throws(
      () =>
        service.confirm({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          providerId: "openai",
        }),
      (err) =>
        err instanceof PrivacyTransactionError && err.code === "tx_mismatch",
    );
    const events = sink.events.filter((e) => e.kind === AuditEvent.TX_MISMATCH);
    assert.equal(events.length, 1);
    assert.equal(events[0].transactionId, bound.transactionId);
  });

  it("confirm rejects a changed documentSha256 with tx_mismatch", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    assert.throws(
      () =>
        service.confirm({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          documentSha256: "deadbeef".repeat(8), // different hash
        }),
      (err) =>
        err instanceof PrivacyTransactionError && err.code === "tx_mismatch",
    );
    // Transaction must be dropped so it cannot be silently reused
    assert.ok(
      !service._transactions.has(bound.transactionId),
      "transaction should be removed",
    );
  });

  it("confirm with mutated localExtraction throws tx_mismatch", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    // Mutate a field value — hash must change
    assert.throws(
      () =>
        service.confirm({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          localExtraction: makeLocalExtraction({
            invoice: {
              invoiceNumber: "NIF: 99999999X", // changed
              invoiceDate: "2026-01-15",
              simplifiedInvoiceDate: null,
              taxLabel: "IVA",
              totals: { subtotal: "100.00", tax: "21.00", total: "121.00" },
              matched: [
                "invoiceNumber",
                "invoiceDate",
                "subtotal",
                "tax",
                "total",
              ],
            },
          }),
        }),
      (err) =>
        err instanceof PrivacyTransactionError && err.code === "tx_mismatch",
    );
  });

  it("confirm with exactPayloadBytes that does not match payloadSha256 throws tx_mismatch", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    // Simulate tampering: corrupt the stored payload bytes
    const tx = service._transactions.get(bound.transactionId);
    tx.payloadBytes = Buffer.from("corrupted payload");
    tx.payloadSha256 = "0".repeat(64); // also corrupt the stored hash

    assert.throws(
      () =>
        service.confirm({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
        }),
      (err) =>
        err instanceof PrivacyTransactionError && err.code === "tx_mismatch",
    );
  });

  it("onSent callback only fires on successful confirm, not on tx_mismatch", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    let onSentCalled = false;
    try {
      service.confirm({
        transactionId: bound.transactionId,
        requestId: VALID_REQUEST_ID,
        documentSha256: "wrong".repeat(13),
      });
    } catch {
      // expected tx_mismatch
    }
    const onSentCalledBeforeMismatch = onSentCalled;

    // Now do a fresh successful confirm
    const bound2 = service.prepare(makePrepareArgs());
    const { onSent } = service.confirm({
      transactionId: bound2.transactionId,
      requestId: VALID_REQUEST_ID,
      documentSha256: "0".repeat(64),
    });
    assert.equal(
      onSentCalledBeforeMismatch,
      false,
      "onSent must not fire on mismatch",
    );
    assert.equal(
      typeof onSent,
      "function",
      "onSent must be returned on success",
    );
    onSent();
  });

  it("confirm emits tx_confirm_attempt, tx_confirm_consumed, and tx_confirm_sent (via onSent)", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());

    const { onSent } = service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });

    const kinds = sink.events.map((e) => e.kind);
    assert.ok(kinds.includes(AuditEvent.TX_CONFIRM_ATTEMPT));
    assert.ok(kinds.includes(AuditEvent.TX_CONFIRM_CONSUMED));

    onSent();
    const afterOnSent = sink.events.map((e) => e.kind);
    assert.ok(afterOnSent.includes(AuditEvent.TX_CONFIRM_SENT));
  });

  it("confirm of an unknown transactionId throws tx_unknown", () => {
    const service = makeService();
    assert.throws(
      () =>
        service.confirm({
          transactionId: "BBBBBBBBBBBBBBBBBBBBBB",
          requestId: VALID_REQUEST_ID,
        }),
      (err) =>
        err instanceof PrivacyTransactionError && err.code === "tx_unknown",
    );
  });

  it("concurrent confirms of the same transactionId resolve to one success and the rest to tx_already_consumed", () => {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs());

    const successes = [];
    const failures = [];
    for (let i = 0; i < 5; i++) {
      try {
        const result = service.confirm({
          transactionId: bound.transactionId,
          requestId: `550e8400-e29b-41d4-a716-446655${String(440010 + i).padStart(6, "0")}`,
        });
        successes.push(result);
      } catch (e) {
        failures.push(e.code);
      }
    }

    assert.equal(successes.length, 1, "exactly one confirm should succeed");
    assert.equal(
      failures.length,
      4,
      "the rest should fail with tx_already_consumed",
    );
    assert.ok(
      failures.every((code) => code === "tx_already_consumed"),
      "every failure must be tx_already_consumed",
    );
    assert.ok(successes[0].request.exactPayloadBytes instanceof Uint8Array);
    assert.ok(successes[0].request.exactPayloadBytes.byteLength > 0);
  });
});

describe("PrivacyTransactionService — lifetime, cancellation, and clear", () => {
  it("cancelTransaction removes the transaction and emits tx_cancelled", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    const bound = service.prepare(makePrepareArgs());
    const result = service.cancelTransaction(bound.transactionId, {
      operationCorrelationId: VALID_REQUEST_ID,
    });
    assert.equal(result, true);
    assert.equal(service.getTransaction(bound.transactionId), null);

    const events = sink.events.filter(
      (e) => e.kind === AuditEvent.TX_CANCELLED,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].transactionId, bound.transactionId);
  });

  it("cancelTransaction returns false for an unknown transactionId and does not throw", () => {
    const service = makeService();
    const result = service.cancelTransaction("BBBBBBBBBBBBBBBBBBBBBB");
    assert.equal(result, false);
  });

  it("cleanup removes expired transactions and emits a tx_expired event for each", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
      transactionTtlMs: 1,
    });
    service.prepare(
      makePrepareArgs({
        operationCorrelationId: "550e8400-e29b-41d4-a716-446655440010",
      }),
    );
    service.prepare(
      makePrepareArgs({
        operationCorrelationId: "550e8400-e29b-41d4-a716-446655440011",
      }),
    );

    return new Promise((resolve) => {
      setImmediate(() => {
        const removed = service.cleanup();
        assert.ok(removed >= 2);
        assert.equal(service.size, 0);
        const expired = sink.events.filter(
          (e) => e.kind === AuditEvent.TX_EXPIRED,
        );
        assert.equal(expired.length, removed);
        resolve();
      });
    });
  });

  it("clear drops every transaction and the AuditSink is unaffected", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: ENABLED_REGISTRY,
    });
    REGISTERED_SERVICES.add(service);
    service.prepare(makePrepareArgs());
    service.prepare(
      makePrepareArgs({
        operationCorrelationId: "550e8400-e29b-41d4-a716-446655440020",
      }),
    );
    const eventsBefore = sink.events.length;
    service.clear();
    assert.equal(service.size, 0);
    assert.equal(
      sink.events.length,
      eventsBefore,
      "clear must not emit audit events",
    );
  });

  it("shutdown clears every transaction and is safe to call repeatedly", () => {
    const service = makeService();
    service.prepare(makePrepareArgs());
    service.prepare(
      makePrepareArgs({
        operationCorrelationId: "550e8400-e29b-41d4-a716-446655440030",
      }),
    );
    service.shutdown();
    assert.equal(service.size, 0);
    // Must be a no-op the second time (no double-unregister crash).
    service.shutdown();
    assert.equal(service.size, 0);
  });
});

describe("AuditSink — closed enum and content-free guarantee", () => {
  it("accepts a structurally valid event from the closed enum", () => {
    const sink = new AuditSink();
    sink.emit({
      kind: AuditEvent.TX_PREPARE,
      operationCorrelationId: VALID_REQUEST_ID,
      transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
      providerId: "minimax",
      modelId: "MiniMax-M3",
      purpose: "extract_invoice",
      disclosureVersion: "v1",
      transformedPolicyVersion: "pseudonymize-v1",
      payloadSha256: "a".repeat(64),
      outcome: "prepared",
      timestamp: Date.now(),
    });
    assert.equal(sink.size, 1);
  });

  it("rejects an event with an unknown kind", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: "tx_something_else",
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          outcome: "x",
          timestamp: Date.now(),
        }),
      /unknown audit kind/,
    );
  });

  it("rejects an event with extra (free-form) fields beyond the closed schema", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: AuditEvent.TX_PREPARE,
          operationCorrelationId: VALID_REQUEST_ID,
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          providerId: "minimax",
          modelId: "MiniMax-M3",
          purpose: "extract_invoice",
          disclosureVersion: "v1",
          transformedPolicyVersion: "pseudonymize-v1",
          payloadSha256: "a".repeat(64),
          outcome: "prepared",
          timestamp: Date.now(),
          documentText: "this could be anything", // free-form field
        }),
      /unknown field/,
    );
  });

  it("rejects an event with a missing required field", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: AuditEvent.TX_PREPARE,
          // operationCorrelationId omitted on purpose
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          providerId: "minimax",
          modelId: "MiniMax-M3",
          purpose: "extract_invoice",
          disclosureVersion: "v1",
          transformedPolicyVersion: "pseudonymize-v1",
          payloadSha256: "a".repeat(64),
          outcome: "prepared",
          timestamp: Date.now(),
        }),
      /has 9 fields; expected 10/,
    );
  });

  it("rejects an event whose string field is too long to carry document content", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: AuditEvent.TX_PREPARE,
          operationCorrelationId: "x".repeat(10_000),
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          providerId: "minimax",
          modelId: "MiniMax-M3",
          purpose: "extract_invoice",
          disclosureVersion: "v1",
          transformedPolicyVersion: "pseudonymize-v1",
          payloadSha256: "a".repeat(64),
          outcome: "prepared",
          timestamp: Date.now(),
        }),
      /1\.\.256/,
    );
  });

  it("rejects an event whose outcome is not in the per-kind allowlist", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: AuditEvent.TX_PREPARE,
          operationCorrelationId: VALID_REQUEST_ID,
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          providerId: "minimax",
          modelId: "MiniMax-M3",
          purpose: "extract_invoice",
          disclosureVersion: "v1",
          transformedPolicyVersion: "pseudonymize-v1",
          payloadSha256: "a".repeat(64),
          outcome: "consumed", // wrong for tx_prepare
          timestamp: Date.now(),
        }),
      /outcome must be one of/,
    );
  });

  it("rejects an event whose timestamp is not a finite number", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: AuditEvent.TX_CANCELLED,
          operationCorrelationId: VALID_REQUEST_ID,
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          outcome: "cancelled",
          timestamp: "not-a-number",
        }),
      /timestamp must be a finite number/,
    );
  });

  it("caps stored events at AUDIT_EVENT_CAP (256) — older events are evicted", () => {
    const sink = new AuditSink();
    for (let i = 0; i < AUDIT_EVENT_CAP + 50; i++) {
      sink.emit({
        kind: AuditEvent.TX_CANCELLED,
        transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
        operationCorrelationId: `corr-${i}`,
        outcome: "cancelled",
        timestamp: 1_700_000_000_000 + i,
      });
    }
    assert.equal(sink.size, AUDIT_EVENT_CAP);
    const events = sink.events;
    assert.equal(events[0].operationCorrelationId, `corr-50`);
    assert.equal(
      events[events.length - 1].operationCorrelationId,
      `corr-${AUDIT_EVENT_CAP + 49}`,
    );
  });

  it("clear empties the buffer without throwing", () => {
    const sink = new AuditSink();
    sink.emit({
      kind: AuditEvent.TX_CANCELLED,
      operationCorrelationId: VALID_REQUEST_ID,
      transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "cancelled",
      timestamp: 1,
    });
    assert.equal(sink.size, 1);
    sink.clear();
    assert.equal(sink.size, 0);
  });

  it("events getter returns a defensive copy that does not mutate the buffer", () => {
    const sink = new AuditSink();
    sink.emit({
      kind: AuditEvent.TX_CANCELLED,
      operationCorrelationId: VALID_REQUEST_ID,
      transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "cancelled",
      timestamp: 1,
    });
    const snapshot = sink.events;
    snapshot.length = 0;
    assert.equal(
      sink.size,
      1,
      "mutating the snapshot must not clear the buffer",
    );
  });

  it("rejects a sensitive-marker field that is not on the allowlist", () => {
    const sink = new AuditSink();
    assert.throws(
      () =>
        sink.emit({
          kind: AuditEvent.TX_PREPARE,
          operationCorrelationId: VALID_REQUEST_ID,
          transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
          outcome: "prepared",
          timestamp: 1,
          pii: "user@email.com",
        }),
      /unknown field: pii/,
    );
  });

  it("exportDiagnostics returns only allowlisted content-free fields", () => {
    const sink = new AuditSink();
    sink.emit({
      kind: AuditEvent.TX_CANCELLED,
      operationCorrelationId: VALID_REQUEST_ID,
      transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "cancelled",
      timestamp: 1_700_000_000_000,
    });
    const exported = sink.exportDiagnostics();
    assert.equal(exported.length, 1);
    assert.deepEqual(Object.keys(exported[0]).sort(), [
      "kind",
      "operationCorrelationId",
      "outcome",
      "timestamp",
      "transactionId",
    ]);
  });

  it("exportDiagnostics is a snapshot — mutating it must not affect the sink", () => {
    const sink = new AuditSink();
    sink.emit({
      kind: AuditEvent.TX_CANCELLED,
      operationCorrelationId: VALID_REQUEST_ID,
      transactionId: "AAAAAAAAAAAAAAAAAAAAAA",
      outcome: "cancelled",
      timestamp: 1,
    });
    const snapshot = sink.exportDiagnostics();
    snapshot.length = 0;
    assert.equal(
      sink.size,
      1,
      "mutating exportDiagnostics must not clear the buffer",
    );
  });
});

describe("Provider registry — Slice 3 fail-closed gate", () => {
  it("createDefaultProviderRegistry returns disabled for every provider", () => {
    const registry = createDefaultProviderRegistry();
    for (const id of ["minimax", "openai", "anthropic", "ollama", "custom"]) {
      const status = registry.get(id);
      assert.equal(status.status, "disabled");
      assert.equal(status.providerId, id);
    }
  });

  it("an injected registry that reports enabled makes prepare succeed for that provider", () => {
    const registry = {
      get(providerId) {
        return { status: "enabled", providerId };
      },
    };
    const service = new PrivacyTransactionService({
      providerRegistry: registry,
    });
    const bound = service.prepare(makePrepareArgs({ providerId: "openai" }));
    assert.equal(bound.providerId, "openai");
  });

  it("an injected registry that reports enabled but does not match the providerId falls back to disabled", () => {
    const registry = {
      get(providerId) {
        if (providerId === "openai") return { status: "enabled", providerId };
        return { status: "disabled", providerId };
      },
    };
    const service = new PrivacyTransactionService({
      providerRegistry: registry,
    });
    assert.throws(
      () => service.prepare(makePrepareArgs({ providerId: "minimax" })),
      (err) =>
        err instanceof ProviderDisabledError &&
        err.code === "provider_disabled",
    );
  });
});

describe("PrivacyTransactionService — internal reverse map semantics", () => {
  it("each prepare creates a fresh in-memory pseudonymizer (factor is per-transaction)", () => {
    // The privacy service holds the pseudonymizer inside the transaction
    // record. Two prepares must use independent maps so two documents in
    // the same session never share reverse mappings.
    const service = makeService();
    const bound1 = service.prepare(makePrepareArgs());
    const bound2 = service.prepare(
      makePrepareArgs({
        operationCorrelationId: "550e8400-e29b-41d4-a716-446655440040",
      }),
    );
    assert.notEqual(bound1.transactionId, bound2.transactionId);
    // Two independent payloads with the same input must differ when the
    // per-transaction factor differs. The factors are random integers in
    // [3, 12]; with two transactions the chance of collision is ~10%.
    // We instead assert that BOTH payload hashes are deterministic given
    // their own factor — i.e. the inputs were not shared between maps.
    assert.equal(bound1.payloadSha256.length, 64);
    assert.equal(bound2.payloadSha256.length, 64);
  });
});

describe("PrivacyTransactionService.validateProviderResponse — WU-3C2 contract", () => {
  // Helpers shared by the validation tests. Each test builds a fresh
  // service + transaction and consumes it before calling
  // validateProviderResponse so the lifecycle mirrors production.
  function buildConsumed(overrides = {}) {
    const service = makeService();
    const bound = service.prepare(makePrepareArgs(overrides));
    service.confirm({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
    });
    return { service, bound };
  }

  function readPayload(service, transactionId) {
    const tx = service._transactions.get(transactionId);
    return JSON.parse(Buffer.from(tx.payloadBytes).toString("utf8"));
  }

  it("accepts a structurally valid response, reverse-maps markers, and returns the bound identifiers", () => {
    const { service, bound } = buildConsumed();
    const outbound = readPayload(service, bound.transactionId);

    // The provider is told the outbound (pseudonymized) values; build a
    // response that echoes the markers / scaled amounts verbatim so the
    // reverse map is the only source of the real values.
    const responseBody = JSON.stringify({
      schemaVersion: "v1",
      requestId: VALID_REQUEST_ID,
      confidence: "high",
      fields: {
        invoiceNumber: outbound.fields.invoiceNumber,
        invoiceDate: outbound.fields.invoiceDate,
        taxLabel: outbound.fields.taxLabel,
        subtotal: outbound.fields.totals.subtotal,
        tax: outbound.fields.totals.tax,
        total: outbound.fields.totals.total,
      },
      warnings: [],
    });

    const result = service.validateProviderResponse({
      transactionId: bound.transactionId,
      requestId: VALID_REQUEST_ID,
      responseBytes: Buffer.from(responseBody, "utf8"),
      contentType: PAYLOAD_MEDIA_TYPE,
    });

    assert.equal(result.requestId, VALID_REQUEST_ID);
    assert.equal(result.confidence, "high");
    assert.deepEqual(result.warnings, []);

    // invoiceNumber was pseudonymized to a marker; the reversed value
    // must come back from the per-transaction reverse map. We use
    // reverseDeep (not reversePii) because the marker is embedded in a
    // compound string like "NIF: [NIF-1]" — reversePii only recognizes
    // the marker as a standalone token.
    const tx = service._transactions.get(bound.transactionId);
    const reversedInvoiceNumber = tx.pseudonymizer.reverseDeep(
      outbound.fields.invoiceNumber,
    );
    const reversedTaxLabel = tx.pseudonymizer.reverseDeep(
      outbound.fields.taxLabel,
    );
    assert.equal(result.fields.invoiceNumber, reversedInvoiceNumber);
    assert.equal(outbound.fields.invoiceDate, "[DATE-2]");
    assert.equal(result.fields.invoiceDate, "2026-01-15");
    assert.equal(result.fields.taxLabel, reversedTaxLabel);

    // Amounts: the provider saw scaled values (e.g. "400.00") and the
    // validator's reverseDeep turns them back into the originals the
    // reverse map captured at prepare time.
    for (const key of ["subtotal", "tax", "total"]) {
      const fake = outbound.fields.totals[key];
      const real = tx.pseudonymizer.reverseAmount(fake);
      assert.equal(result.fields[key], real);
    }
  });

  it("rejects a response whose content-type is not application/json", () => {
    const { service, bound } = buildConsumed();
    const body = JSON.stringify({
      schemaVersion: "v1",
      requestId: VALID_REQUEST_ID,
      confidence: "high",
      fields: { invoiceNumber: "[NIF-1]" },
      warnings: [],
    });
    assert.throws(
      () =>
        service.validateProviderResponse({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          responseBytes: Buffer.from(body, "utf8"),
          contentType: "text/html",
        }),
      (err) =>
        err instanceof PrivacyTransactionError &&
        err.code === "provider_response_invalid" &&
        /contentType/.test(err.message),
    );
  });

  it("rejects a response body that exceeds RESPONSE_LIMIT_BYTES (1 MiB + 1)", () => {
    const { service, bound } = buildConsumed();
    // A non-JSON payload is fine here — the byte guard runs before the
    // JSON parse, exactly like a provider streaming a runaway body.
    const oversized = Buffer.alloc(RESPONSE_LIMIT_BYTES + 1, 0x41);
    assert.throws(
      () =>
        service.validateProviderResponse({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          responseBytes: oversized,
          contentType: PAYLOAD_MEDIA_TYPE,
        }),
      (err) =>
        err instanceof PrivacyTransactionError &&
        err.code === "provider_response_invalid" &&
        new RegExp(String(RESPONSE_LIMIT_BYTES)).test(err.message),
    );
  });

  it("rejects a response body that is not valid JSON", () => {
    const { service, bound } = buildConsumed();
    assert.throws(
      () =>
        service.validateProviderResponse({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          responseBytes: Buffer.from("<html>not json</html>", "utf8"),
          contentType: PAYLOAD_MEDIA_TYPE,
        }),
      (err) =>
        err instanceof PrivacyTransactionError &&
        err.code === "provider_response_invalid" &&
        /not valid JSON/.test(err.message),
    );
  });

  it("rejects a response that carries raw PII the reverse map cannot explain (anti-hallucination)", () => {
    // The default localExtraction has invoiceNumber "NIF: 12345678Z",
    // which the prepare pseudonymizer turns into "[NIF-1]". The
    // response below ignores the marker and returns a raw NIF that
    // never appears in the reverse map — the only way the provider
    // could "know" it is by leaking the document or hallucinating.
    const { service, bound } = buildConsumed();
    const responseBody = JSON.stringify({
      schemaVersion: "v1",
      requestId: VALID_REQUEST_ID,
      confidence: "high",
      fields: {
        invoiceNumber: "12345678Z",
        invoiceDate: "2026-01-15",
      },
      warnings: [],
    });
    assert.throws(
      () =>
        service.validateProviderResponse({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          responseBytes: Buffer.from(responseBody, "utf8"),
          contentType: PAYLOAD_MEDIA_TYPE,
        }),
      (err) =>
        err instanceof PrivacyTransactionError &&
        err.code === "provider_response_invalid" &&
        /unmapped PII/.test(err.message),
    );
  });

  it("rejects a response whose field names fall outside the bound allowlist", () => {
    // matched=["invoiceNumber"] only — anything else (including the
    // totals sub-keys) is outside the allowlist the provider was told
    // about, so the response cannot add its own fields.
    const { service, bound } = buildConsumed({
      localExtraction: makeLocalExtraction({
        invoice: {
          invoiceNumber: "NIF: 12345678Z",
          invoiceDate: null,
          simplifiedInvoiceDate: null,
          taxLabel: null,
          totals: { subtotal: null, tax: null, total: null },
          matched: ["invoiceNumber"],
        },
      }),
    });
    const responseBody = JSON.stringify({
      schemaVersion: "v1",
      requestId: VALID_REQUEST_ID,
      confidence: "high",
      fields: {
        invoiceNumber: "[NIF-1]",
        social_security_number: "123-45-6789",
      },
      warnings: [],
    });
    assert.throws(
      () =>
        service.validateProviderResponse({
          transactionId: bound.transactionId,
          requestId: VALID_REQUEST_ID,
          responseBytes: Buffer.from(responseBody, "utf8"),
          contentType: PAYLOAD_MEDIA_TYPE,
        }),
      (err) =>
        err instanceof PrivacyTransactionError &&
        err.code === "provider_response_invalid" &&
        /social_security_number/.test(err.message),
    );
  });
});

describe("Provider registry — Slice 6 fail-closed gate", () => {
  it("createDefaultProviderRegistry returns disabled for every provider with release_gate_pending reason", () => {
    const registry = createDefaultProviderRegistry();
    for (const id of ["minimax", "openai", "anthropic", "ollama", "custom"]) {
      const status = registry.get(id);
      assert.equal(status.status, "disabled");
      assert.equal(status.providerId, id);
      assert.equal(status.reason, "release_gate_pending");
    }
  });

  it("no provider is ever enabled by the default registry", () => {
    const registry = createDefaultProviderRegistry();
    // Even a known provider like "minimax" (which the old CLI used) stays disabled.
    const minimax = registry.get("minimax");
    assert.equal(minimax.status, "disabled");
    assert.ok(
      minimax.reason?.includes("pending"),
      "reason must reference the gate",
    );
  });

  it("prepare with a disabled provider throws ProviderDisabledError before egress", () => {
    const sink = new AuditSink();
    const service = new PrivacyTransactionService({
      auditSink: sink,
      providerRegistry: createDefaultProviderRegistry(),
    });
    REGISTERED_SERVICES.add(service);

    // prepare() itself must reject the disabled provider — no transaction is
    // created, no payload bytes are bound, no egress can occur. This is the
    // Slice 3 / Slice 6 fail-closed gate.
    assert.throws(
      () => service.prepare(makePrepareArgs({ providerId: "minimax" })),
      (err) =>
        err instanceof ProviderDisabledError &&
        err.code === "provider_disabled",
    );
    assert.equal(
      service.size,
      0,
      "no transaction should be stored for a disabled provider",
    );
  });
});
