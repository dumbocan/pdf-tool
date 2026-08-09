# Design: PDF Tool v0.2 Architecture

## Technical Approach

Keep one Node.js 22 native-ESM `node:http` service on top of the published v0.1 runtime. `GET /healthz` and `GET /version` remain public; `POST /extract` stays deterministic; `POST /extract-with-llm` remains the only MiniMax path, explicit and evidence-gated. The v0.2 contract is minimal and additive: it adds stateless truncation metadata and a simple `source`/`confidence` attribution to `/extract` responses, and it documents the exact published contract for every endpoint. No server state, no IDs, no sessions, and no automatic fallback are introduced.

## Architecture Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Authentication | Optional bearer (`AUTH_TOKEN`). When set, both POST routes require exactly `Bearer <token>` (timing-safe compare) and reject otherwise with 401 `{"error":"unauthorized"}`; GET routes are always public. When unset, POST routes are open by documented deployment policy | Matches the published runtime; keeps health/version probes usable and makes the fail-open state an explicit deployment decision, not a hidden default. |
| Truncation | Stateless metadata on `/extract`: `{ "truncated": true, "truncation": { "reason", "applied", "allowed", "requiresUserConfirmation": true } }`; the consumer asks the human and retries with higher limits within the hard caps | The server cannot ask a user or safely expand limits on its own; the server keeps no state of any kind. |
| Bounds | Fixed numeric limits from the runtime: 16 MiB JSON body, 12 MiB decoded PDF with `%PDF-` magic check, 200 pages, 200,000 extracted characters, 4,000 chars/page, 1 MiB serialized response (checked before send), 16,000-char prompt, `maxTokens` 256–16,000 default 8,000, `name` ≤ 256 chars, 180 s LLM timeout | Every limit is already enforced by the published runtime; the design only documents and tests them, it does not invent new ones. |
| Source attribution | Simple response-level `{ "source", "confidence" }`: `source` ∈ `{"mercadona-tabular","invoice-fields","plain-text","minimax"}`, `confidence` ∈ `{"deterministic","model-derived"}` | Consumers can tell deterministic from model-derived structure with one flat field pair; no per-field evidence wrappers. |
| MiniMax | Explicit `/extract-with-llm` only, evidence-gated: strict validation of the structured response; any non-conforming provider output is rejected with 502; route stays experimental until accepted live or authoritative evidence records the exact `choices[0].message` shape and finish reason | Unproven provider shapes fail closed; deterministic extraction is never replaced, retried, or silently augmented. |
| Untrusted content | PDF text, the user prompt, and LLM output are data, never instructions; system instruction hardening plus the constant `trustBoundary` in every response | Matches the published trust boundary and keeps prompt-injection attempts inert. |

## Data Flow

`route/method → security headers → bearer auth check when AUTH_TOKEN configured (401) → body byte cap → JSON parse → field validation → base64 decode → PDF size/magic validation → bounded extraction (maxPages/maxChars/4k per page) → invoice-field + Mercadona recognizers → (only on explicit /extract-with-llm) strict MiniMax call with extracted text → source/confidence attribution → response size cap → flat JSON error on failure`

## Canonical Contract

### Routes

| Route | Method | Auth | Success |
|---|---|---|---|
| `/healthz` | GET | public | 200 `text/plain` `ok` |
| `/version` | GET | public | 200 `{"name":"pdf-tool","version":"0.2.0"}` |
| `/extract` | POST | bearer if configured | 200 JSON |
| `/extract-with-llm` | POST | bearer if configured | 200 JSON |

Unknown path or wrong method → 404 empty. All responses carry `cache-control: no-store` and `x-content-type-options: nosniff`.

### POST /extract request

```json
{ "data": "<base64 PDF>", "maxChars": 80000, "maxPages": 100 }
```

`data` is required; `maxChars` (1–200,000) and `maxPages` (1–200) are optional. No other fields are part of the `/extract` request contract.

### POST /extract response

```json
{
  "text": "...",
  "pages": 100,
  "truncated": true,
  "truncation": {
    "reason": "maxChars",
    "applied": { "maxPages": 100, "maxChars": 80000 },
    "allowed": { "maxPages": 200, "maxChars": 200000 },
    "requiresUserConfirmation": true
  },
  "invoiceFields": { "invoiceDate": null, "totals": {}, "matched": [], "untrusted": true, "trustBoundary": "..." },
  "lineItems": [],
  "parser": "mercadona-tabular" | "plain-text",
  "parserStats": { "lineItemsDetected": 0 },
  "source": "mercadona-tabular" | "invoice-fields" | "plain-text",
  "confidence": "deterministic",
  "sha256": "<64 lowercase hex>",
  "trustBoundary": "..."
}
```

`truncation` is present only when `truncated` is `true`; the consumer asks the human and retries within `allowed`. `source` is `"mercadona-tabular"` when the Mercadona recognizer fired (≥3 rows), `"invoice-fields"` when invoice fields matched without tabular rows, else `"plain-text"`; `confidence` is always `"deterministic"` on this route.

### POST /extract-with-llm request

```json
{
  "data": "<base64 PDF>",
  "name": "ticket.pdf",
  "maxChars": 80000,
  "maxPages": 100,
  "prompt": "...",
  "maxTokens": 8000
}
```

`data` is required; `name` (≤ 256 chars), `maxChars`, `maxPages`, `prompt` (≤ 16,000 chars), and `maxTokens` (256–16,000, default 8,000) are optional.

### POST /extract-with-llm response

```json
{
  "text": "...",
  "structured": {
    "documentType": "invoice" | "manual" | "other",
    "summary": "...",
    "fields": {},
    "lineItems": [],
    "sections": [],
    "warnings": []
  },
  "rawResponse": "...",
  "llmModel": "MiniMax-M3",
  "llmUsage": {},
  "size": 12345,
  "sha256": "<64 lowercase hex>",
  "name": "ticket.pdf" | null,
  "source": "minimax",
  "confidence": "model-derived",
  "trustBoundary": "..."
}
```

`structured` is accepted only when it is exactly one JSON object with exactly those six keys and valid types; anything else is rejected with 502. `source` is `"minimax"` and `confidence` is `"model-derived"` on this route; the pair is additive on both POST routes.

### Errors

Flat `{"error": "message"}`:

| Status | Message |
|---|---|
| 400 | `request body must be a JSON object` / `request body must be valid JSON` / field-validation messages / `data must be a valid base64 string` / `data must not be empty` / `invalid PDF extraction request` |
| 401 | `unauthorized` |
| 404 | (empty body) |
| 413 | `request body exceeds the size limit` / `response exceeds the size limit` |
| 502 | `LLM upstream request failed` / `LLM upstream response invalid` |
| 503 | `LLM service is not configured` |
| 504 | `LLM upstream request timed out` |

## File Changes

| File | Action | Description |
|---|---|---|
| `src/server.js` | Modify | Truncation metadata, `source`/`confidence` attribution, and contract alignment with the documented envelope. |
| `src/extract.js`, `src/mercadona-parser.js` | Modify | Extraction metadata and recognizer output shaping. |
| `test/*.test.js` | Modify/Create | Contract, truncation, source attribution, auth, limits, and provider-failure tests. |
| `README.md`, Docker/Compose, `.env.example`, `deploy.sh` | Modify | Documented HTTP contract, bounds, evidence gate, and deployment policy. |

## Testing Strategy

Contract tests cover: the four routes and their exact methods and payloads; optional bearer auth (reject and accept); all numeric limits; base64 and PDF magic/size validation; truncation metadata for page and character caps (stateless, no ID); `source`/`confidence` for each recognizer outcome; flat error envelope and status mapping; untrusted-content handling; and the LLM route's strict structured validation plus 502/503/504 failures. CI remains `npm ci && node --test test/*.test.js && npm audit --omit=dev`; deployment runs `docker compose config`. Provider (MiniMax) evidence is kept out of the deterministic suite.

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary. The exposed surface is bounded HTTP with untrusted PDF/provider data; limits and the strict response validation are the controls.

## Migration / Rollout

No migration required; the contract is additive over the published runtime. Ship deterministic extraction with the documented envelope. The MiniMax route remains experimental until the evidence gate passes. Roll back by disabling the LLM route (unset `MINIMAX_API_KEY` → 503) or reverting the image; `/extract` stays intact in both cases.

## Open Questions

- [ ] Obtain accepted MiniMax metadata-only live or authoritative evidence for the exact `choices[0].message` shape and finish reason to move the route out of experimental status.
