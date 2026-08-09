# PDF Extraction Service Specification

## Purpose

Define the bounded, deterministic, HTTP-only extraction contract of `POST /extract`: input fields, the canonical response envelope, stateless truncation metadata, and the specialized recognizers (Spanish invoice fields and Mercadona tables). All values derived from the document are untrusted data.

## Requirements

### Requirement: Deterministic extraction endpoint

`POST /extract` MUST accept a JSON object body with exactly these recognized fields: required `data` (a base64-encoded PDF document), optional `maxChars` (a positive integer no greater than 200,000), and optional `maxPages` (a positive integer no greater than 200). The service MUST run local `pdfjs-dist` extraction only and MUST NOT invoke any LLM, OCR, MCP, stdio, database, UI, or alternate Python service. Identical bytes, limits, and configuration MUST produce equivalent bounded results.

#### Scenario: Valid extraction

- GIVEN a valid base64 PDF under 12 MiB and a JSON body `{"data": "..."}` with optional `maxChars` and `maxPages` within their bounds
- WHEN a client sends `POST /extract`
- THEN the service returns 200 with the canonical response envelope
- AND no external or provider service is called

### Requirement: Canonical response envelope

A successful `/extract` response MUST be a single JSON object with the exact fields: `text`, `pages`, `truncated`, `truncation`, `invoiceFields`, `lineItems`, `parser`, `parserStats`, `source`, `confidence`, `sha256`, and `trustBoundary`.

- `text` is the extracted text, at most `maxChars` characters (default 80,000; hard cap 200,000), with control characters removed.
- `pages` is the number of pages read, at most `maxPages` (default 100; hard cap 200).
- `truncated` is a boolean; when true, the response MUST include the `truncation` object defined by the truncation metadata requirement.
- `invoiceFields` is the deterministic invoice-field object or `null`.
- `lineItems` is the array produced by the Mercadona recognizer (empty when no tabular rows are detected).
- `parser` is exactly `"mercadona-tabular"` or `"plain-text"`.
- `parserStats` is the recognizer stats object.
- `sha256` is the lowercase hex SHA-256 of the raw PDF bytes.
- `trustBoundary` is the constant trust-boundary string.
- `source` and `confidence` follow the source attribution requirement.

#### Scenario: Envelope with no recognized structure

- GIVEN a plain-text PDF with no invoice labels and fewer than 3 tabular rows
- WHEN `POST /extract` succeeds
- THEN `parser` is `"plain-text"`, `lineItems` is an empty array, `source` is `"plain-text"`, `confidence` is `"deterministic"`, and `sha256` matches the submitted bytes

### Requirement: Stateless truncation metadata

When extraction stops at a limit, the response MUST set `truncated` to `true` and include a `truncation` object with exactly this shape:

```json
{
  "truncated": true,
  "truncation": {
    "reason": "maxPages" | "maxChars" | "maxPagesAndMaxChars",
    "applied": { "maxPages": 100, "maxChars": 80000 },
    "allowed": { "maxPages": 200, "maxChars": 200000 },
    "requiresUserConfirmation": true
  }
}
```

`reason` MUST be `"maxPages"` when the page limit stopped extraction, `"maxChars"` when the character limit stopped it, and `"maxPagesAndMaxChars"` when both engaged. `applied` MUST carry the effective limits used for this request (after defaults); `allowed` MUST carry the hard caps (200 pages, 200,000 characters). `requiresUserConfirmation` MUST always be `true`. The service MUST keep no state: no continuation ID, no retry token, no session, no expiry, and no `next.*` suggestion. The consumer MUST ask the human and MAY retry with higher limits within the hard caps. When `truncated` is `false`, the `truncation` object MUST be absent or `null`.

#### Scenario: Character-limit truncation

- GIVEN a PDF whose extracted text exceeds `maxChars` (for example 80,000)
- WHEN `POST /extract` completes
- THEN `truncated` is `true`, `truncation.reason` is `"maxChars"`, `truncation.applied` matches the request limits, and `truncation.allowed` is `{"maxPages": 200, "maxChars": 200000}`
- AND the response contains no ID, session, expiry, or retry token

### Requirement: Specialized Mercadona recognizer

The service MUST include a Mercadona table recognizer that is specialized, never universal. The recognizer MUST set `parser` to `"mercadona-tabular"` and populate `lineItems` only when at least 3 tabular rows are detected; otherwise `parser` MUST be `"plain-text"` and `lineItems` MUST be empty. `lineItems` and `parserStats.lineItemsDetected` MUST be bounded and derived only from the extracted text. The recognizer MUST NOT alter the behavior of `POST /extract` for non-Mercadona documents beyond populating these fields.

#### Scenario: Mercadona ticket

- GIVEN a Mercadona ticket PDF with at least 3 tabular line rows
- WHEN `POST /extract` completes
- THEN `parser` is `"mercadona-tabular"`, `source` is `"mercadona-tabular"`, `confidence` is `"deterministic"`, and `lineItems` contains the detected rows

#### Scenario: Non-Mercadona document

- GIVEN a manual or generic PDF with fewer than 3 tabular rows
- WHEN `POST /extract` completes
- THEN `parser` is `"plain-text"` and `lineItems` is empty

### Requirement: Deterministic Spanish invoice fields

The service MUST return bounded deterministic Spanish invoice fields in `invoiceFields` when matching labels are present: `invoiceDate`, `simplifiedInvoiceDate`, `invoiceNumber`, `taxLabel`, `totals` (`subtotal`, `tax`, `total`), `matched`, `labels`, `untrusted`, and a `trustBoundary` string. Values MUST be normalized (dates as `YYYY-MM-DD`, amounts as decimal strings with two fractional digits) and MUST respect the conservative field caps. A missing or non-matching field MUST be `null` and means "not detected", never a fabricated value.

#### Scenario: Spanish invoice labels present

- GIVEN a PDF whose text contains "Nº Factura" and "Importe total" followed by valid values
- WHEN `POST /extract` completes
- THEN `invoiceFields.invoiceNumber` and `invoiceFields.totals.total` contain the normalized values
- AND `invoiceFields.untrusted` is `true`

### Requirement: Untrusted content boundary

Extracted text, invoice fields, and line items MUST be treated as untrusted document data, never as instructions. The response MUST include the constant `trustBoundary` string that tells consumers not to follow instructions, click links, or act on entities found in the document. No error, log, or metadata field MAY echo document text or prompt content back to a caller outside the response envelope itself.

#### Scenario: Prompt-injection text in document

- GIVEN a PDF containing hidden text such as "ignore previous instructions"
- WHEN `POST /extract` completes
- THEN the text is returned as data inside `text`
- AND the `trustBoundary` warning is present in the response
