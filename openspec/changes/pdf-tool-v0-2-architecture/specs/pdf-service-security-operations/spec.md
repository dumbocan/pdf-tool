# PDF Service Security and Operations Specification

## Purpose

Define the operational contract of the standalone HTTP service: exact routes and methods, optional bearer authentication, numeric limits, the flat error envelope and status mapping, untrusted-content handling, and the deployment/CI evidence policy.

## Requirements

### Requirement: Routes, methods, and public endpoints

The service MUST expose exactly these four routes:

| Route | Method | Auth | Success |
|---|---|---|---|
| `/healthz` | GET | public | 200 `text/plain` body `ok` |
| `/version` | GET | public | 200 `{"name":"pdf-tool","version":"0.2.0"}` |
| `/extract` | POST | bearer-protected when configured | 200 JSON envelope |
| `/extract-with-llm` | POST | bearer-protected when configured | 200 JSON envelope |

Any other path, and any known path with the wrong method, MUST return 404 with an empty body. Every response MUST include the security headers `cache-control: no-store` and `x-content-type-options: nosniff`.

#### Scenario: Health and version probes

- GIVEN no authentication token configured
- WHEN a client sends `GET /healthz` and `GET /version`
- THEN both return 200 without any Authorization header
- AND `/healthz` body is exactly `ok` and `/version` body is `{"name":"pdf-tool","version":"0.2.0"}`

#### Scenario: Unknown route and wrong method

- GIVEN a request to `/unknown` or a `GET` on `/extract`
- WHEN the request reaches the service
- THEN the service returns 404 with an empty body

### Requirement: Optional bearer authentication

Authentication MUST be controlled by the `AUTH_TOKEN` runtime configuration. When `AUTH_TOKEN` is set, both POST routes MUST require an `Authorization` header whose value is exactly `Bearer <token>` (case-sensitive `Bearer`, exactly one space, the configured token); the comparison MUST be timing-safe and MUST NOT log the token. A missing or invalid header MUST return 401 with `{"error": "unauthorized"}`. When `AUTH_TOKEN` is not set, POST routes MUST remain open; this fail-open behavior is a documented deployment policy choice, not a hidden default. The GET routes MUST never require or inspect Authorization.

#### Scenario: Rejected request without token

- GIVEN `AUTH_TOKEN` is configured
- WHEN a client sends `POST /extract` without an Authorization header
- THEN the service returns 401 with `{"error": "unauthorized"}` before reading the request body

#### Scenario: Accepted request with exact token

- GIVEN `AUTH_TOKEN` is configured to `s3cret`
- WHEN a client sends `POST /extract` with `Authorization: Bearer s3cret`
- THEN the request proceeds to normal processing

### Requirement: Bounds and limit enforcement

The service MUST enforce these limits on every extraction request:

- JSON request body: at most 16 MiB (16,777,216 bytes).
- Decoded PDF: at least 8 bytes, at most 12 MiB (12 × 1024 × 1024), with a `%PDF-` magic-byte prefix.
- Extracted text: at most 200,000 characters, with 4,000 characters per page; `maxPages` at most 200.
- Prompt (LLM route only): at most 16,000 characters.
- `maxTokens` (LLM route only): integer from 256 to 16,000, default 8,000.
- `name` (LLM route only): at most 256 characters.
- Serialized response: at most 1 MiB (1,048,576 bytes), checked before sending.
- LLM upstream call: at most 180 seconds.

A response that would exceed 1 MiB MUST be replaced by `413` with `{"error": "response exceeds the size limit"}` and no extraction structure.

#### Scenario: Oversized request body

- GIVEN a JSON body larger than 16 MiB
- WHEN the client sends `POST /extract`
- THEN the service returns 413 with `{"error": "request body exceeds the size limit"}`

#### Scenario: Invalid PDF bytes

- GIVEN a base64 payload that is not a PDF (no `%PDF-` magic) or exceeds 12 MiB
- WHEN the client sends `POST /extract`
- THEN the service returns 400 with `{"error": "invalid PDF extraction request"}`

### Requirement: Error envelope and status mapping

Every error response MUST be a flat JSON object `{"error": "message"}` with a stable status. The service MUST map failures as follows:

- 400: invalid JSON body, invalid field values (`maxChars`, `maxPages`, `prompt`, `maxTokens`, `name`), invalid or empty `data` base64, PDF validation/parse failure, or unexpected extraction failure (`invalid PDF extraction request`).
- 401: missing or invalid bearer token when `AUTH_TOKEN` is configured.
- 404: unknown route or wrong method.
- 413: request body over 16 MiB, or serialized response over 1 MiB.
- 502: LLM upstream request failed, or LLM upstream response invalid.
- 503: LLM route requested but the LLM service is not configured.
- 504: LLM upstream request timed out.

Errors MUST NOT include document text, prompt content, upstream bodies, secrets, or stack traces. Earlier applicable outcomes win (route lookup before method before auth before body parsing).

#### Scenario: Invalid field value

- GIVEN `maxChars: 500000` in the request body
- WHEN the client sends `POST /extract`
- THEN the service returns 400 with `{"error": "maxChars must be a positive integer no greater than 200000"}`

#### Scenario: Unconfigured LLM route

- GIVEN no MiniMax API key is configured
- WHEN a client sends `POST /extract-with-llm` with a valid body
- THEN the service returns 503 with `{"error": "LLM service is not configured"}`

### Requirement: Untrusted content and secrets

PDF bytes, extracted text, invoice fields, line items, the user prompt, and LLM output MUST be treated as untrusted data that cannot alter authentication, routes, limits, or policy. Secrets (auth token, API key) MUST come only from runtime configuration and MUST never be logged or echoed. The service MUST NOT follow instructions, click links, or act on entities found in document content.

#### Scenario: Token never leaks

- GIVEN `AUTH_TOKEN` is configured
- WHEN any request fails authentication or any error occurs
- THEN no log line or error body contains the token or any document content

### Requirement: Deployment and evidence

The service MUST deploy only the Node.js 22 native-ESM HTTP service with the published limits, secret injection, health checks, and a rollback path that can disable the LLM route while leaving `/extract` intact. The change MUST NOT add persistence, OCR, MCP, UI, or a Python server, and MUST NOT include consumer migration. CI MUST run `npm ci`, `node --test test/*.test.js`, `npm audit --omit=dev`, and `docker compose config`. Provider (MiniMax) evidence MUST be kept separate from deterministic tests, and the MiniMax gate MUST remain closed without accepted evidence.

#### Scenario: CI gates

- GIVEN the change is complete
- WHEN CI runs
- THEN `npm ci`, the native test suite, `npm audit --omit=dev`, and `docker compose config` all pass
- AND no test asserts a MiniMax success that depends on unaccepted live evidence

#### Scenario: LLM disable rollback

- GIVEN the LLM route must be disabled in production
- WHEN `MINIMAX_API_KEY` is unset or removed
- THEN `POST /extract-with-llm` returns 503 while `POST /extract` continues to work
