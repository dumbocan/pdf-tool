//! v1 API contracts: closed serde DTOs with bounded validation.
//! WU-1D1 — Rust v1 DTOs, IDs, bounds, and public errors.
//! No Tauri command behavior: types and validators only.
//! Design refs: §5.1 (envelope/errors), §5.2 (request DTOs), §5.3 (response DTOs).

use serde::{Deserialize, Serialize};

// === Bounds (design §5.2–§5.4) ===
pub const PROTOCOL_VERSION: u8 = 1;
pub const MAX_PDF_BYTES: u64 = 12_582_912;
pub const MIN_BASE64_CHARS: usize = 4;
pub const MAX_BASE64_CHARS: usize = 16_777_216;
pub const MAX_NAME_SCALARS: usize = 255;
pub const MAX_NAME_UTF8_BYTES: usize = 1024;
pub const MAX_PDF_REQUEST_BYTES: usize = 17_825_792;
pub const MAX_RESPONSE_BYTES: usize = 1_048_576;
pub const MIN_PAGES: u32 = 1;
pub const MAX_PAGES: u32 = 100;
pub const MIN_CHARS: u32 = 1;
pub const MAX_CHARS: u32 = 80_000;
pub const DOCUMENT_ID_LEN: usize = 22;
pub const UUID_V4_LEN: usize = 36;
pub const SHA256_LEN: usize = 64;
pub const MAX_MESSAGE_KEY: usize = 64;
pub const MAX_SAFE_CONTEXT_LEN: usize = 64;

// === Error ===
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContractError {
    pub code: &'static str,
}
impl ContractError {
    pub fn new(code: &'static str) -> Self {
        Self { code }
    }
}

pub trait Validate {
    fn validate(&self) -> Result<(), ContractError>;
}

// === Validation helpers (design §5.2–§5.4) ===

fn is_lower_hex(c: u8) -> bool {
    c.is_ascii_digit() || (b'a'..=b'f').contains(&c)
}

pub fn is_valid_uuid_v4(s: &str) -> bool {
    if s.len() != UUID_V4_LEN {
        return false;
    }
    let b = s.as_bytes();
    for (i, &byte) in b.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if byte != b'-' {
                    return false;
                }
            }
            14 => {
                if byte != b'4' {
                    return false;
                }
            } // version nibble must be '4'
            19 => {
                if !matches!(byte, b'8' | b'9' | b'a' | b'b') {
                    return false;
                }
            } // variant
            _ => {
                if !is_lower_hex(byte) {
                    return false;
                }
            }
        }
    }
    true
}

pub fn is_valid_base64url_id(s: &str) -> bool {
    s.len() == DOCUMENT_ID_LEN
        && s.bytes().all(|b| {
            b.is_ascii_uppercase()
                || b.is_ascii_lowercase()
                || b.is_ascii_digit()
                || b == b'-'
                || b == b'_'
        })
}

pub fn is_valid_name(s: &str) -> bool {
    if s.is_empty() || s.chars().count() > MAX_NAME_SCALARS || s.len() > MAX_NAME_UTF8_BYTES {
        return false;
    }
    // No C0/C1 control chars, no "/" (U+002F), no "\\" (U+005C)
    !s.chars().any(|c| c.is_control() || c == '/' || c == '\\')
}

pub fn is_valid_base64(s: &str) -> bool {
    let len = s.len();
    if !(MIN_BASE64_CHARS..=MAX_BASE64_CHARS).contains(&len) {
        return false;
    }
    let b = s.as_bytes();
    if !b.iter().all(|&c| {
        c.is_ascii_uppercase()
            || c.is_ascii_lowercase()
            || c.is_ascii_digit()
            || c == b'+'
            || c == b'/'
            || c == b'='
    }) {
        return false;
    }
    // Padding only at end, max 2 chars
    if let Some(pos) = b.iter().position(|&c| c == b'=') {
        if b[pos..].iter().any(|&c| c != b'=') {
            return false;
        }
    }
    true
}

pub fn is_valid_sha256(s: &str) -> bool {
    s.len() == SHA256_LEN && s.bytes().all(is_lower_hex)
}

// === Enums (design §5.1–§5.3) ===
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetryCategory {
    Never,
    UserAction,
    NewTransaction,
    RestartApp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicErrorCode {
    InvalidRequest,
    UnauthorizedDocument,
    InvalidPdf,
    InputTooLarge,
    PageLimit,
    ResponseTooLarge,
    EngineUnavailable,
    EngineLost,
    ProtocolMismatch,
    Timeout,
    Cancelled,
    CapacityExhausted,
    OcrUnavailable,
    OcrResourceLimit,
    ProviderDisabled,
    ProviderUnavailable,
    ProviderResponseInvalid,
    TransactionExpired,
    TransactionConsumed,
    TransactionMismatch,
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelOutcome {
    Accepted,
    AlreadyRequested,
    AlreadyTerminal,
    UnknownOperation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Readiness {
    SidecarAbsent,
    Starting,
    Ready,
    Busy,
    Restarting,
    Failed,
    ProtocolMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LastFailure {
    EngineUnavailable,
    EngineLost,
    ProtocolMismatch,
    Timeout,
    Cancelled,
    Internal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionStatus {
    Complete,
    Truncated,
    Partial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TruncationReason {
    MaxPages,
    MaxChars,
    #[serde(rename = "max_pages_and_chars")]
    MaxPagesAndChars,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionMode {
    #[serde(rename = "digital_text")]
    DigitalText,
    Ocr,
    #[serde(rename = "ocr_required_unavailable")]
    OcrRequiredUnavailable,
}

// === Safe context ===
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SafeContext {
    pub limit: Option<u64>,
    pub unit: Option<String>,
    pub capability: Option<String>,
}

// === Public error ===
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublicError {
    pub code: PublicErrorCode,
    pub message_key: String,
    #[serde(rename = "retry")]
    pub retry: RetryCategory,
    #[serde(skip_serializing_if = "Option::is_none", rename = "safeContext")]
    pub safe_context: Option<SafeContext>,
}

impl Validate for PublicError {
    fn validate(&self) -> Result<(), ContractError> {
        if self.message_key.len() > MAX_MESSAGE_KEY {
            return Err(ContractError::new("message_key_overflow"));
        }
        if !self.message_key.is_ascii() {
            return Err(ContractError::new("message_key_non_ascii"));
        }
        if let Some(ctx) = &self.safe_context {
            if let Some(u) = &ctx.unit {
                if u.len() > MAX_SAFE_CONTEXT_LEN || !u.is_ascii() {
                    return Err(ContractError::new("safe_context_unit_overflow"));
                }
            }
            if let Some(c) = &ctx.capability {
                if c.len() > MAX_SAFE_CONTEXT_LEN || !c.is_ascii() {
                    return Err(ContractError::new("safe_context_capability_overflow"));
                }
            }
        }
        Ok(())
    }
}

// === Request DTOs (design §5.2) ===
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisterDocumentV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub name: String,
    pub declared_bytes: u64,
    pub pdf_base64: String,
}

impl Validate for RegisterDocumentV1 {
    fn validate(&self) -> Result<(), ContractError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ContractError::new("protocol_version"));
        }
        if !is_valid_uuid_v4(&self.request_id) {
            return Err(ContractError::new("request_id"));
        }
        if !is_valid_name(&self.name) {
            return Err(ContractError::new("invalid_name"));
        }
        if self.declared_bytes < 1 || self.declared_bytes > MAX_PDF_BYTES {
            return Err(ContractError::new("declared_bytes"));
        }
        if !is_valid_base64(&self.pdf_base64) {
            return Err(ContractError::new("invalid_base64"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtractOptionsV1 {
    #[serde(default)]
    pub max_pages: Option<u32>,
    #[serde(default)]
    pub max_chars: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtractLocalV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub document_id: String,
    #[serde(default)]
    pub options: Option<ExtractOptionsV1>,
}

impl Validate for ExtractLocalV1 {
    fn validate(&self) -> Result<(), ContractError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ContractError::new("protocol_version"));
        }
        if !is_valid_uuid_v4(&self.request_id) {
            return Err(ContractError::new("request_id"));
        }
        if !is_valid_base64url_id(&self.document_id) {
            return Err(ContractError::new("document_id"));
        }
        if let Some(opts) = &self.options {
            if let Some(mp) = opts.max_pages {
                if !(MIN_PAGES..=MAX_PAGES).contains(&mp) {
                    return Err(ContractError::new("max_pages"));
                }
            }
            if let Some(mc) = opts.max_chars {
                if !(MIN_CHARS..=MAX_CHARS).contains(&mc) {
                    return Err(ContractError::new("max_chars"));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CancelOperationV1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub operation_id: String,
}

impl Validate for CancelOperationV1 {
    fn validate(&self) -> Result<(), ContractError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ContractError::new("protocol_version"));
        }
        if !is_valid_uuid_v4(&self.request_id) {
            return Err(ContractError::new("request_id"));
        }
        if !is_valid_uuid_v4(&self.operation_id) {
            return Err(ContractError::new("operation_id"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GetDocumentPdfBase64V1 {
    pub protocol_version: u8,
    pub request_id: String,
    pub document_id: String,
}

impl Validate for GetDocumentPdfBase64V1 {
    fn validate(&self) -> Result<(), ContractError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ContractError::new("protocol_version"));
        }
        if !is_valid_uuid_v4(&self.request_id) {
            return Err(ContractError::new("request_id"));
        }
        if !is_valid_base64url_id(&self.document_id) {
            return Err(ContractError::new("document_id"));
        }
        Ok(())
    }
}

// === Response DTOs (design §5.2–§5.3) ===
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RegisteredDocumentV1 {
    pub document_id: String,
    pub display_name: String,
    pub byte_length: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CancelOperationResultV1 {
    pub operation_id: String,
    pub outcome: CancelOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DocumentPdfBase64V1 {
    pub pdf_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopLimitsV1 {
    pub max_pdf_bytes: u64,
    pub max_pages: u32,
    pub max_chars: u32,
    pub extraction_deadline_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DesktopStatusV1 {
    pub protocol_version: u8,
    pub adapter: String,
    pub readiness: Readiness,
    pub accepts_new_extraction: bool,
    pub active_operation_id: Option<String>,
    pub last_failure: Option<LastFailure>,
    pub limits: DesktopLimitsV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InvoiceTotalsV1 {
    pub subtotal: Option<String>,
    pub tax: Option<String>,
    pub total: Option<String>,
}

// Field bboxes are page-relative percentages in [0, 100]. The Node sidecar
// rounds each value to two decimal places (see src/extract.js), so we keep
// f64 here so the wire format can carry 4.90 / 4.29 / 1.01 etc. without
// silently truncating to integers. f64 does not implement Eq, so the Eq
// bound is dropped from this struct and its parents below.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FieldBboxV1 {
    pub page: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MatchedFieldV1 {
    pub label: String,
    pub value: Option<String>,
    pub bbox: Option<FieldBboxV1>,
    pub editable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InvoiceFieldsV1 {
    pub invoice_number: Option<String>,
    pub invoice_date: Option<String>,
    pub simplified_invoice_date: Option<String>,
    pub tax_label: Option<String>,
    pub totals: InvoiceTotalsV1,
    pub matched: Vec<MatchedFieldV1>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocalExtractionV1 {
    pub provenance: String,
    pub document_sha256: String,
    pub status: ExtractionStatus,
    pub pages_processed: u32,
    pub truncation_reason: Option<TruncationReason>,
    pub extraction_mode: ExtractionMode,
    pub invoice: InvoiceFieldsV1,
    #[serde(default)]
    pub review_pdf_base64: Option<String>,
    pub untrusted: bool,
}

/// Envelope matching design §5.1: `{ protocolVersion, ok, requestId, data|error }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ApiResult<T> {
    #[serde(rename_all = "camelCase")]
    Ok {
        ok: bool,
        protocol_version: u8,
        request_id: String,
        data: T,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        ok: bool,
        protocol_version: u8,
        request_id: String,
        error: PublicError,
    },
}

// === Adapter layer (WU-1D2) ===
// Converts ContractError into a PublicError, wrapping in ApiResult::Error.
// On success, wraps the data in ApiResult::Ok.

/// Trait for request DTOs that carry protocol_version + request_id.
pub trait RequestEnvelope {
    fn protocol_version(&self) -> u8;
    fn request_id(&self) -> &str;
}

impl RequestEnvelope for RegisterDocumentV1 {
    fn protocol_version(&self) -> u8 {
        self.protocol_version
    }
    fn request_id(&self) -> &str {
        &self.request_id
    }
}

impl RequestEnvelope for ExtractLocalV1 {
    fn protocol_version(&self) -> u8 {
        self.protocol_version
    }
    fn request_id(&self) -> &str {
        &self.request_id
    }
}

impl RequestEnvelope for CancelOperationV1 {
    fn protocol_version(&self) -> u8 {
        self.protocol_version
    }
    fn request_id(&self) -> &str {
        &self.request_id
    }
}

impl RequestEnvelope for GetDocumentPdfBase64V1 {
    fn protocol_version(&self) -> u8 {
        self.protocol_version
    }
    fn request_id(&self) -> &str {
        &self.request_id
    }
}

/// Map a `ContractError` code to a `PublicErrorCode`.
fn error_code_from_contract(code: &str) -> PublicErrorCode {
    match code {
        "protocol_version" => PublicErrorCode::ProtocolMismatch,
        "request_id" => PublicErrorCode::InvalidRequest,
        "document_id" => PublicErrorCode::InvalidRequest,
        "invalid_name" => PublicErrorCode::InvalidRequest,
        "declared_bytes" => PublicErrorCode::InputTooLarge,
        "invalid_base64" => PublicErrorCode::InvalidRequest,
        "max_pages" => PublicErrorCode::PageLimit,
        "max_chars" => PublicErrorCode::PageLimit,
        "operation_id" => PublicErrorCode::InvalidRequest,
        "message_key_overflow" => PublicErrorCode::ResponseTooLarge,
        "message_key_non_ascii" => PublicErrorCode::InvalidRequest,
        "safe_context_unit_overflow" => PublicErrorCode::ResponseTooLarge,
        "safe_context_capability_overflow" => PublicErrorCode::ResponseTooLarge,
        _ => PublicErrorCode::InvalidRequest,
    }
}

/// Validate a request and produce an `ApiResult::Error` if validation fails.
pub fn validate_request<T: Validate + RequestEnvelope>(req: &T) -> Result<(), ApiResult<()>> {
    match req.validate() {
        Ok(()) => Ok(()),
        Err(e) => Err(ApiResult::Error {
            ok: false,
            protocol_version: req.protocol_version(),
            request_id: req.request_id().to_string(),
            error: PublicError {
                code: error_code_from_contract(e.code),
                message_key: e.code.to_string(),
                retry: RetryCategory::Never,
                safe_context: None,
            },
        }),
    }
}

/// Validate request, then on success wrap data in `ApiResult::Ok`; on failure wrap as `ApiResult::Error`.
pub fn validate_and_wrap<T: Validate + RequestEnvelope, D>(req: &T, data: D) -> ApiResult<D> {
    match validate_request(req) {
        Ok(()) => ApiResult::Ok {
            ok: true,
            protocol_version: req.protocol_version(),
            request_id: req.request_id().to_string(),
            data,
        },
        Err(ApiResult::Error {
            protocol_version,
            request_id,
            error,
            ..
        }) => ApiResult::Error {
            ok: false,
            protocol_version,
            request_id,
            error,
        },
        _ => unreachable!(),
    }
}

// === Tests ===
#[cfg(test)]
mod tests {
    use super::*;

    const VALID_UUID: &str = "550e8400-e29b-43d4-a716-446655440000";
    const BAD_UUID_V2: &str = "550e8400-e29b-21d4-a716-446655440000";
    const UPPER_UUID: &str = "550E8400-E29B-43D4-A716-446655440000";
    const VALID_DOC_ID: &str = "AAAAAAAAAAAAAAAAAAAAAA";
    const SHORT_B64: &str = "AAA";

    // --- RegisterDocumentV1: unknown-field rejection (serde-level) ---

    #[test]
    fn red_register_rejects_unknown_url_field() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA","url":"http://evil"}}"#,
            VALID_UUID
        );
        let result: Result<RegisterDocumentV1, _> = serde_json::from_str(&json);
        assert!(result.is_err(), "unknown url field must be rejected");
    }

    #[test]
    fn red_register_rejects_unknown_path_field() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA","path":"/etc/passwd"}}"#,
            VALID_UUID
        );
        let result: Result<RegisterDocumentV1, _> = serde_json::from_str(&json);
        assert!(result.is_err(), "unknown path field must be rejected");
    }

    #[test]
    fn red_register_rejects_unknown_token_field() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA","token":"sk-1234"}}"#,
            VALID_UUID
        );
        let result: Result<RegisterDocumentV1, _> = serde_json::from_str(&json);
        assert!(result.is_err(), "unknown token field must be rejected");
    }

    // --- RegisterDocumentV1: validate() bounds (stub — must FAIL in RED) ---

    #[test]
    fn red_register_valid_passes() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_ok(), "valid register must pass");
    }

    #[test]
    fn red_register_rejects_non_v4_uuid() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            BAD_UUID_V2
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "non-v4 UUID must be rejected");
    }

    #[test]
    fn red_register_rejects_uppercase_uuid() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            UPPER_UUID
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "uppercase UUID must be rejected");
    }

    #[test]
    fn red_register_rejects_empty_name() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "empty name must be rejected");
    }

    #[test]
    fn red_register_rejects_name_with_slash() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"test/file.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "name with slash must be rejected");
    }

    #[test]
    fn red_register_rejects_declared_bytes_zero() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":0,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "declaredBytes=0 must be rejected");
    }

    #[test]
    fn red_register_rejects_declared_bytes_overflow() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":{},"pdfBase64":"AAAA"}}"#,
            VALID_UUID,
            MAX_PDF_BYTES + 1
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(
            dto.validate().is_err(),
            "declaredBytes over max must be rejected"
        );
    }

    #[test]
    fn red_register_rejects_short_base64() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":3,"pdfBase64":"{}"}}"#,
            VALID_UUID, SHORT_B64
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "short base64 must be rejected");
    }

    #[test]
    fn red_register_rejects_wrong_protocol() {
        let json = format!(
            r#"{{"protocolVersion":2,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let dto: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        assert!(
            dto.validate().is_err(),
            "protocolVersion != 1 must be rejected"
        );
    }

    // --- ExtractLocalV1 ---

    #[test]
    fn red_extract_valid_passes() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}"}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_ok(), "valid extract must pass");
    }

    #[test]
    fn red_extract_rejects_bad_document_id() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"short"}}"#,
            VALID_UUID
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(
            dto.validate().is_err(),
            "invalid documentId must be rejected"
        );
    }

    #[test]
    fn red_extract_rejects_max_pages_zero() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}","options":{{"maxPages":0}}}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "maxPages=0 must be rejected");
    }

    #[test]
    fn red_extract_rejects_max_pages_overflow() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}","options":{{"maxPages":101}}}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "maxPages=101 must be rejected");
    }

    #[test]
    fn red_extract_rejects_max_chars_overflow() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}","options":{{"maxChars":80001}}}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "maxChars=80001 must be rejected");
    }

    // --- CancelOperationV1 ---

    #[test]
    fn red_cancel_valid_passes() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","operationId":"{}"}}"#,
            VALID_UUID, VALID_UUID
        );
        let dto: CancelOperationV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_ok(), "valid cancel must pass");
    }

    #[test]
    fn red_cancel_rejects_bad_operation_id() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","operationId":"not-a-uuid"}}"#,
            VALID_UUID
        );
        let dto: CancelOperationV1 = serde_json::from_str(&json).unwrap();
        assert!(
            dto.validate().is_err(),
            "invalid operationId must be rejected"
        );
    }

    // --- PublicError / SafeContext ---

    #[test]
    fn red_public_error_valid_passes() {
        let error = PublicError {
            code: PublicErrorCode::InvalidRequest,
            message_key: "test".to_string(),
            retry: RetryCategory::Never,
            safe_context: None,
        };
        assert!(error.validate().is_ok());
    }

    #[test]
    fn red_public_error_rejects_long_message_key() {
        let error = PublicError {
            code: PublicErrorCode::InvalidRequest,
            message_key: "a".repeat(MAX_MESSAGE_KEY + 1),
            retry: RetryCategory::Never,
            safe_context: None,
        };
        assert!(
            error.validate().is_err(),
            "messageKey > 64 must be rejected"
        );
    }

    #[test]
    fn red_public_error_rejects_unknown_safe_context_field() {
        let json = r#"{"code":"invalid_request","messageKey":"test","retry":"never","safeContext":{"limit":1,"unit":"x","capability":"y","extra":"z"}}"#;
        let result: Result<PublicError, _> = serde_json::from_str(json);
        assert!(
            result.is_err(),
            "unknown safeContext field must be rejected"
        );
    }

    // === Boundary tests (TRIANGULATE) ===

    #[test]
    fn uuid_v4_valid_passes() {
        assert!(is_valid_uuid_v4(VALID_UUID));
    }

    #[test]
    fn uuid_v4_rejects_wrong_length() {
        assert!(!is_valid_uuid_v4("550e8400-e29b-43d4-a716-44665544000")); // 35 chars
        assert!(!is_valid_uuid_v4("550e8400-e29b-43d4-a716-4466554400000")); // 37 chars
    }

    #[test]
    fn uuid_v4_rejects_non_v4_version() {
        assert!(!is_valid_uuid_v4(BAD_UUID_V2)); // version nibble is '2', not '4'
    }

    #[test]
    fn base64url_id_valid_passes() {
        assert!(is_valid_base64url_id(VALID_DOC_ID));
    }

    #[test]
    fn base64url_id_rejects_wrong_length() {
        assert!(!is_valid_base64url_id("AAAAAAAAAAAAAAAAAAAAA")); // 21 chars
        assert!(!is_valid_base64url_id("AAAAAAAAAAAAAAAAAAAAAAA")); // 23 chars
    }

    #[test]
    fn base64url_id_rejects_standard_base64_chars() {
        assert!(!is_valid_base64url_id("AAAAAAAAAAAAAAAAAA+=")); // + and = not in base64url
    }

    #[test]
    fn name_valid_passes() {
        assert!(is_valid_name("invoice.pdf"));
        assert!(is_valid_name("a")); // min scalar
    }

    #[test]
    fn name_rejects_empty_and_too_long() {
        assert!(!is_valid_name(""));
        let too_long = "a".repeat(MAX_NAME_SCALARS + 1);
        assert!(!is_valid_name(&too_long));
    }

    #[test]
    fn name_rejects_slash_and_backslash() {
        assert!(!is_valid_name("test/file.pdf"));
        assert!(!is_valid_name("test\\file.pdf"));
        assert!(!is_valid_name("test\u{0001}file.pdf")); // control char
    }

    #[test]
    fn name_accepts_boundary_255_scalars() {
        let name = "a".repeat(MAX_NAME_SCALARS);
        assert!(is_valid_name(&name));
    }

    #[test]
    fn base64_valid_passes() {
        assert!(is_valid_base64("AAAA")); // MIN_BASE64_CHARS boundary
        assert!(is_valid_base64("AA==")); // valid padding
    }

    #[test]
    fn base64_rejects_too_short() {
        assert!(!is_valid_base64("AAA")); // below MIN_BASE64_CHARS
    }

    #[test]
    fn base64_rejects_padding_in_middle() {
        assert!(!is_valid_base64("AA==AA"));
    }

    #[test]
    fn sha256_valid_passes() {
        assert!(is_valid_sha256(&"a".repeat(SHA256_LEN)));
    }

    #[test]
    fn sha256_rejects_wrong_length() {
        assert!(!is_valid_sha256(&"a".repeat(SHA256_LEN - 1)));
        assert!(!is_valid_sha256(&"a".repeat(SHA256_LEN + 1)));
    }

    #[test]
    fn sha256_rejects_uppercase() {
        assert!(!is_valid_sha256(&"A".repeat(SHA256_LEN)));
    }

    #[test]
    fn register_rejects_name_with_control_char() {
        let dto = RegisterDocumentV1 {
            protocol_version: 1,
            request_id: VALID_UUID.to_string(),
            name: "test\u{0001}.pdf".to_string(),
            declared_bytes: 44,
            pdf_base64: "AAAA".to_string(),
        };
        assert!(
            dto.validate().is_err(),
            "name with control char must be rejected"
        );
    }

    #[test]
    fn extract_accepts_boundary_pages_and_chars() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}","options":{{"maxPages":{},"maxChars":{}}}}}"#,
            VALID_UUID, VALID_DOC_ID, MAX_PAGES, MAX_CHARS
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_ok(), "boundary pages/chars must pass");
    }

    #[test]
    fn extract_rejects_bad_request_id() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"not-a-uuid","documentId":"{}"}}"#,
            VALID_DOC_ID
        );
        let dto: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(dto.validate().is_err(), "bad requestId must be rejected");
    }

    #[test]
    fn public_error_rejects_long_safe_context_field() {
        let error = PublicError {
            code: PublicErrorCode::InvalidRequest,
            message_key: "test".to_string(),
            retry: RetryCategory::Never,
            safe_context: Some(SafeContext {
                limit: None,
                unit: Some("u".repeat(MAX_SAFE_CONTEXT_LEN + 1)),
                capability: None,
            }),
        };
        assert!(
            error.validate().is_err(),
            "overflowing safeContext.unit must be rejected"
        );
    }

    // === Adapter layer tests (WU-1D2) ===

    #[test]
    fn adapter_valid_register_wraps_ok() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let req: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        let data = RegisteredDocumentV1 {
            document_id: VALID_DOC_ID.to_string(),
            display_name: "invoice.pdf".to_string(),
            byte_length: 44,
        };
        let result = validate_and_wrap(&req, data);
        match result {
            ApiResult::Ok {
                protocol_version,
                request_id,
                ..
            } => {
                assert_eq!(protocol_version, 1);
                assert_eq!(request_id, VALID_UUID);
            }
            ApiResult::Error { .. } => panic!("valid request must produce Ok"),
        }
    }

    #[test]
    fn adapter_invalid_register_wraps_error() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":0,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let req: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        let data = RegisteredDocumentV1 {
            document_id: VALID_DOC_ID.to_string(),
            display_name: "invoice.pdf".to_string(),
            byte_length: 0,
        };
        let result = validate_and_wrap(&req, data);
        match result {
            ApiResult::Ok { .. } => panic!("invalid request must produce Error"),
            ApiResult::Error {
                protocol_version,
                request_id,
                error,
                ..
            } => {
                assert_eq!(protocol_version, 1);
                assert_eq!(request_id, VALID_UUID);
                assert_eq!(error.code, PublicErrorCode::InputTooLarge);
                assert_eq!(error.message_key, "declared_bytes");
            }
        }
    }

    #[test]
    fn adapter_invalid_extract_wraps_error_with_request_id() {
        let json = format!(
            r#"{{"protocolVersion":2,"requestId":"{}","documentId":"{}"}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let req: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        let data = LocalExtractionV1 {
            provenance: "local".to_string(),
            document_sha256: "a".repeat(SHA256_LEN),
            status: ExtractionStatus::Complete,
            pages_processed: 1,
            truncation_reason: None,
            extraction_mode: ExtractionMode::DigitalText,
            invoice: InvoiceFieldsV1 {
                invoice_number: None,
                invoice_date: None,
                simplified_invoice_date: None,
                tax_label: None,
                totals: InvoiceTotalsV1 {
                    subtotal: None,
                    tax: None,
                    total: None,
                },
                matched: vec![],
            },
            review_pdf_base64: None,
            untrusted: false,
        };
        let result = validate_and_wrap(&req, data);
        match result {
            ApiResult::Error { error, .. } => {
                assert_eq!(error.code, PublicErrorCode::ProtocolMismatch);
                assert_eq!(error.message_key, "protocol_version");
            }
            _ => panic!("expected Error for bad protocol version"),
        }
    }

    #[test]
    fn adapter_validate_request_ok_for_valid_extract() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}"}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let req: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        assert!(validate_request(&req).is_ok());
    }

    #[test]
    fn adapter_error_code_mapping() {
        assert_eq!(
            error_code_from_contract("protocol_version"),
            PublicErrorCode::ProtocolMismatch
        );
        assert_eq!(
            error_code_from_contract("declared_bytes"),
            PublicErrorCode::InputTooLarge
        );
        assert_eq!(
            error_code_from_contract("max_pages"),
            PublicErrorCode::PageLimit
        );
        assert_eq!(
            error_code_from_contract("invalid_name"),
            PublicErrorCode::InvalidRequest
        );
        assert_eq!(
            error_code_from_contract("unknown"),
            PublicErrorCode::InvalidRequest
        );
    }

    // === Envelope serialization tests (WU-1D3) ===

    #[test]
    fn envelope_ok_shape_matches_design() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let req: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        let data = RegisteredDocumentV1 {
            document_id: VALID_DOC_ID.to_string(),
            display_name: "invoice.pdf".to_string(),
            byte_length: 44,
        };
        let result = validate_and_wrap(&req, data);
        let serialized = serde_json::to_string(&result).unwrap();

        let v: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(v["protocolVersion"], 1);
        assert_eq!(v["ok"], true);
        assert_eq!(v["requestId"], VALID_UUID);
        assert_eq!(v["data"]["documentId"], VALID_DOC_ID);
        assert_eq!(v["data"]["displayName"], "invoice.pdf");
        assert_eq!(v["data"]["byteLength"], 44);
        assert!(v.get("error").is_none(), "ok variant must not have error");
    }

    #[test]
    fn envelope_error_shape_matches_design() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","name":"invoice.pdf","declaredBytes":0,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let req: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        let data = RegisteredDocumentV1 {
            document_id: VALID_DOC_ID.to_string(),
            display_name: "invoice.pdf".to_string(),
            byte_length: 0,
        };
        let result = validate_and_wrap(&req, data);
        let serialized = serde_json::to_string(&result).unwrap();

        let v: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(v["protocolVersion"], 1);
        assert_eq!(v["ok"], false);
        assert_eq!(v["requestId"], VALID_UUID);
        assert_eq!(v["error"]["code"], "input_too_large");
        assert_eq!(v["error"]["messageKey"], "declared_bytes");
        assert_eq!(v["error"]["retry"], "never");
        assert!(v.get("data").is_none(), "error variant must not have data");
    }

    #[test]
    fn envelope_error_preserves_protocol_version_on_mismatch() {
        let json = format!(
            r#"{{"protocolVersion":3,"requestId":"{}","name":"invoice.pdf","declaredBytes":44,"pdfBase64":"AAAA"}}"#,
            VALID_UUID
        );
        let req: RegisterDocumentV1 = serde_json::from_str(&json).unwrap();
        let data = RegisteredDocumentV1 {
            document_id: VALID_DOC_ID.to_string(),
            display_name: "invoice.pdf".to_string(),
            byte_length: 44,
        };
        let result = validate_and_wrap(&req, data);
        let serialized = serde_json::to_string(&result).unwrap();

        let v: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(
            v["protocolVersion"], 3,
            "error preserves original protocol version"
        );
        assert_eq!(v["ok"], false);
        assert_eq!(v["requestId"], VALID_UUID);
        assert_eq!(v["error"]["code"], "protocol_mismatch");
        assert_eq!(v["error"]["messageKey"], "protocol_version");
    }

    #[test]
    fn envelope_extract_ok_shape() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","documentId":"{}"}}"#,
            VALID_UUID, VALID_DOC_ID
        );
        let req: ExtractLocalV1 = serde_json::from_str(&json).unwrap();
        let data = LocalExtractionV1 {
            provenance: "local_deterministic".to_string(),
            document_sha256: "a".repeat(SHA256_LEN),
            status: ExtractionStatus::Complete,
            pages_processed: 5,
            truncation_reason: None,
            extraction_mode: ExtractionMode::DigitalText,
            invoice: InvoiceFieldsV1 {
                invoice_number: None,
                invoice_date: None,
                simplified_invoice_date: None,
                tax_label: None,
                totals: InvoiceTotalsV1 {
                    subtotal: None,
                    tax: None,
                    total: None,
                },
                matched: vec![],
            },
            review_pdf_base64: None,
            untrusted: true,
        };
        let result = validate_and_wrap(&req, data);
        let serialized = serde_json::to_string(&result).unwrap();

        let v: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(v["protocolVersion"], 1);
        assert_eq!(v["ok"], true);
        assert_eq!(v["requestId"], VALID_UUID);
        assert_eq!(v["data"]["provenance"], "local_deterministic");
        assert_eq!(v["data"]["extractionMode"], "digital_text");
        assert_eq!(v["data"]["pagesProcessed"], 5);
        assert_eq!(v["data"]["untrusted"], true);
    }

    #[test]
    fn envelope_cancel_ok_shape() {
        let json = format!(
            r#"{{"protocolVersion":1,"requestId":"{}","operationId":"{}"}}"#,
            VALID_UUID, VALID_UUID
        );
        let req: CancelOperationV1 = serde_json::from_str(&json).unwrap();
        let data = CancelOperationResultV1 {
            operation_id: VALID_UUID.to_string(),
            outcome: CancelOutcome::Accepted,
        };
        let result = validate_and_wrap(&req, data);
        let serialized = serde_json::to_string(&result).unwrap();

        let v: serde_json::Value = serde_json::from_str(&serialized).unwrap();
        assert_eq!(v["protocolVersion"], 1);
        assert_eq!(v["ok"], true);
        assert_eq!(v["requestId"], VALID_UUID);
        assert_eq!(v["data"]["operationId"], VALID_UUID);
        assert_eq!(v["data"]["outcome"], "accepted");
    }
}
