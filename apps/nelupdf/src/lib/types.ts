export type Bbox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MatchedField = {
  label: string;
  value: string | null;
  bbox: Bbox | null;
  editable: boolean;
};

export type Template = {
  id: string;
  providerId: string;
  fields: { label: string; bbox: Bbox }[];
  createdAt: number;
};

export type LocalExtractionV1 = {
  provenance: "local_deterministic";
  documentSha256: string;
  status: "complete" | "truncated" | "partial";
  pagesProcessed: number;
  truncationReason:
    | "max_pages"
    | "max_chars"
    | "max_pages_and_chars"
    | null;
  extractionMode: "digital_text" | "ocr" | "ocr_required_unavailable";
  invoice: {
    invoiceNumber: string | null;
    invoiceDate: string | null;
    simplifiedInvoiceDate: string | null;
    taxLabel: string | null;
    totals: {
      subtotal: string | null;
      tax: string | null;
      total: string | null;
    };
    matched: MatchedField[];
  };
  reviewPdfBase64: string | null;
  untrusted: true;
};

export type PublicErrorCode =
  | "invalid_request"
  | "unauthorized_document"
  | "invalid_pdf"
  | "input_too_large"
  | "page_limit"
  | "response_too_large"
  | "engine_unavailable"
  | "engine_lost"
  | "protocol_mismatch"
  | "timeout"
  | "cancelled"
  | "capacity_exhausted"
  | "ocr_unavailable"
  | "ocr_resource_limit"
  | "provider_disabled"
  | "provider_unavailable"
  | "provider_response_invalid"
  | "transaction_expired"
  | "transaction_consumed"
  | "transaction_mismatch"
  | "internal";

export type RetryCategory =
  | "never"
  | "user_action"
  | "new_transaction"
  | "restart_app";

export type PublicError = {
  code: PublicErrorCode;
  messageKey: string;
  retry: RetryCategory;
  safeContext?: {
    limit?: number;
    unit?: string;
    capability?: string;
  };
};