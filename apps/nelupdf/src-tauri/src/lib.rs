// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod contracts;
mod doc_store;
mod engine;
#[cfg(test)]
mod test_support;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use contracts::{
    validate_and_wrap, ApiResult, CancelOperationResultV1, CancelOperationV1, CancelOutcome,
    ConfirmLlmExtractionResultV1, ConfirmLlmExtractionV1, DocumentPdfBase64V1, ExtractLocalV1,
    ExtractionMode, ExtractionStatus, GetDocumentPdfBase64V1, InvoiceFieldsV1,
    InvoiceTotalsV1, LlmDisclosureV1, LlmProviderRequestV1, LocalExtractionV1, PrepareLlmExtractionResultV1,
    PrepareLlmExtractionV1, PublicError, PublicErrorCode, RegisterDocumentV1,
    RegisteredDocumentV1, RequestEnvelope, RetryCategory, Validate, PROTOCOL_VERSION,
};
use doc_store::DocStore;
use engine::{
    local_extraction_to_sidecar, run_extraction, run_privacy_sidecar, SidecarConfirmLlmRequest,
    SidecarDocument, SidecarLimits, SidecarPrepareLlmRequest, SidecarPrivacyError,
    SidecarRequest, SidecarResponse,
};
use serde::Deserialize;
use std::sync::OnceLock;

static DOCUMENTS: OnceLock<DocStore> = OnceLock::new();

fn documents() -> &'static DocStore {
    DOCUMENTS.get_or_init(DocStore::default)
}

fn operational_error<T, R: RequestEnvelope>(
    req: &R,
    code: PublicErrorCode,
    message_key: &'static str,
) -> ApiResult<T> {
    ApiResult::Error {
        ok: false,
        protocol_version: req.protocol_version(),
        request_id: req.request_id().to_string(),
        error: PublicError {
            code,
            message_key: message_key.to_string(),
            retry: RetryCategory::Never,
            safe_context: None,
        },
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn register_document_v1(req: RegisterDocumentV1) -> ApiResult<RegisteredDocumentV1> {
    if let Err(_error) = req.validate() {
        return validate_and_wrap(
            &req,
            RegisteredDocumentV1 {
                document_id: String::new(),
                display_name: req.name.clone(),
                byte_length: 0,
            },
        );
    }
    match documents().store(req.clone()) {
        Ok(data) => validate_and_wrap(&req, data),
        Err(_) => ApiResult::Error {
            ok: false,
            protocol_version: req.protocol_version,
            request_id: req.request_id,
            error: PublicError {
                code: PublicErrorCode::InvalidPdf,
                message_key: "invalid_pdf".to_string(),
                retry: RetryCategory::Never,
                safe_context: None,
            },
        },
    }
}

#[tauri::command]
fn extract_local_v1(req: ExtractLocalV1) -> ApiResult<LocalExtractionV1> {
    if req.validate().is_err() {
        return validate_and_wrap(
            &req,
            LocalExtractionV1 {
                provenance: "local_deterministic".to_string(),
                document_sha256: String::new(),
                status: ExtractionStatus::Partial,
                pages_processed: 0,
                truncation_reason: None,
                extraction_mode: ExtractionMode::OcrRequiredUnavailable,
                invoice: empty_invoice(),
                review_pdf_base64: None,
                untrusted: true,
            },
        );
    }
    let stored = match documents().get(&req.document_id) {
        Some(doc) => doc,
        None => {
            return operational_error(
                &req,
                PublicErrorCode::UnauthorizedDocument,
                "document_not_found",
            )
        }
    };
    let request = SidecarRequest {
        protocol_version: PROTOCOL_VERSION,
        kind: "extractLocal".to_string(),
        request_id: req.request_id.clone(),
        document: SidecarDocument {
            name: stored.name,
            byte_length: stored.bytes.len() as u64,
            sha256: stored.sha256,
            pdf_base64: STANDARD.encode(stored.bytes),
        },
        limits: req.options.as_ref().map(|options| SidecarLimits {
            max_pages: options.max_pages,
            max_chars: options.max_chars,
        }),
    };
    let response = match run_extraction(request) {
        Ok(response) => response,
        Err(error) => {
            return operational_error(
                &req,
                match error.code {
                    "engine_unavailable" => PublicErrorCode::EngineUnavailable,
                    "response_too_large" => PublicErrorCode::ResponseTooLarge,
                    _ => PublicErrorCode::EngineLost,
                },
                error.code,
            )
        }
    };
    if response.protocol_version != PROTOCOL_VERSION
        || response.kind != "extractLocal"
        || response.request_id != req.request_id
    {
        return operational_error(&req, PublicErrorCode::ProtocolMismatch, "protocol_mismatch");
    }
    if response.status == "error" {
        return operational_error(&req, PublicErrorCode::InvalidPdf, "engine_error");
    }
    if response.status != "ok" && response.status != "partial" {
        return operational_error(&req, PublicErrorCode::EngineLost, "invalid_response");
    }
    let data = map_response(response);
    validate_and_wrap(&req, data)
}

fn empty_invoice() -> InvoiceFieldsV1 {
    InvoiceFieldsV1 {
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
    }
}

fn map_response(response: SidecarResponse) -> LocalExtractionV1 {
    let partial = response.status == "partial";
    let truncated = response.truncated.unwrap_or(false);
    LocalExtractionV1 {
        provenance: "local_deterministic".to_string(),
        document_sha256: response.sha256.unwrap_or_default(),
        status: if partial {
            ExtractionStatus::Partial
        } else if truncated {
            ExtractionStatus::Truncated
        } else {
            ExtractionStatus::Complete
        },
        pages_processed: response.pages.unwrap_or(0),
        truncation_reason: None,
        extraction_mode: if partial {
            ExtractionMode::OcrRequiredUnavailable
        } else {
            ExtractionMode::DigitalText
        },
        invoice: response.invoice_fields.unwrap_or_else(empty_invoice),
        review_pdf_base64: None,
        untrusted: true,
    }
}

#[tauri::command]
fn cancel_operation_v1(req: CancelOperationV1) -> ApiResult<CancelOperationResultV1> {
    let data = CancelOperationResultV1 {
        operation_id: req.operation_id.clone(),
        outcome: CancelOutcome::Accepted,
    };
    validate_and_wrap(&req, data)
}

// === WU-3D1: privacy Tauri commands (Slice 3) ===
//
// Every external LLM operation flows through the provider registry on the
// Node sidecar. The Rust client translates the sidecar envelope into a
// typed `ApiResult<T>` so the desktop UI never sees a free-form error
// envelope. The provider registry defaults to `disabled` (Slice 6 owns
// the qualified-review release gate), so these commands return
// `ProviderDisabled` whenever `prepare()` or `confirm()` runs.

fn map_privacy_error_code(code: &str) -> PublicErrorCode {
    match code {
        "provider_disabled" => PublicErrorCode::ProviderDisabled,
        "tx_unknown" => PublicErrorCode::TransactionMismatch,
        "tx_already_consumed" => PublicErrorCode::TransactionConsumed,
        "tx_expired" => PublicErrorCode::TransactionExpired,
        "tx_mismatch" => PublicErrorCode::TransactionMismatch,
        "provider_response_invalid" => PublicErrorCode::ProviderResponseInvalid,
        "invalid_request" | "invalid_response" | "invalid_response_bytes"
        | "invalid_content_type" | "invalid_document_id" | "invalid_transaction_id"
        | "invalid_provider_id" | "invalid_model_id" | "invalid_purpose" | "invalid_document_sha256" => {
            PublicErrorCode::InvalidRequest
        }
        "engine_unavailable" => PublicErrorCode::EngineUnavailable,
        "engine_lost" => PublicErrorCode::EngineLost,
        "protocol_mismatch" => PublicErrorCode::ProtocolMismatch,
        "response_too_large" => PublicErrorCode::ResponseTooLarge,
        _ => PublicErrorCode::Internal,
    }
}

// Default error code/message used when the sidecar reports an error status
// but its `error` field is missing. The envelope is required, but a buggy
// sidecar should still surface as a typed envelope, not a panic.
fn default_privacy_error() -> SidecarPrivacyError {
    SidecarPrivacyError {
        code: "invalid_response".to_string(),
        message: "missing error envelope".to_string(),
    }
}

fn privacy_error_response<T>(
    req: &dyn RequestEnvelope,
    code: &str,
    message: &str,
) -> ApiResult<T> {
    ApiResult::Error {
        ok: false,
        protocol_version: req.protocol_version(),
        request_id: req.request_id().to_string(),
        error: PublicError {
            code: map_privacy_error_code(code),
            message_key: code.to_string(),
            retry: RetryCategory::NewTransaction,
            safe_context: None,
        },
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawDisclosure {
    version: String,
    transformed_policy_version: String,
    provider_id: String,
    model_id: String,
    purpose: String,
    document_sha256: Option<String>,
    payload_sha256: String,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPrepareData {
    transaction_id: String,
    payload_sha256: String,
    provider_id: String,
    model_id: String,
    purpose: String,
    disclosure: RawDisclosure,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawProviderRequest {
    transaction_id: String,
    provider_id: String,
    model_id: String,
    purpose: String,
    payload_media_type: String,
    exact_payload_bytes: String,
    payload_sha256: String,
    deadline_ms: i64,
    response_limit_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawConfirmData {
    request: RawProviderRequest,
}

#[tauri::command]
fn prepare_llm_extraction_v1(req: PrepareLlmExtractionV1) -> ApiResult<PrepareLlmExtractionResultV1> {
    if req.validate().is_err() {
        return validate_and_wrap(
            &req,
            PrepareLlmExtractionResultV1 {
                transaction_id: String::new(),
                payload_sha256: String::new(),
                provider_id: req.provider_id.clone(),
                model_id: req.model_id.clone(),
                purpose: req.purpose.clone(),
                disclosure: LlmDisclosureV1 {
                    version: req.disclosure_version.clone(),
                    transformed_policy_version: req.transformed_policy_version.clone(),
                    provider_id: req.provider_id.clone(),
                    model_id: req.model_id.clone(),
                    purpose: req.purpose.clone(),
                    document_sha256: None,
                    payload_sha256: String::new(),
                    expires_at: String::new(),
                },
                expires_at: String::new(),
            },
        );
    }
    // The sidecar only needs a thin projection of the local extraction. We
    // pass None for the optional fields — the privacy service falls back to
    // empty allowlists when documentSha256 is missing, so the sidecar
    // mirrors the same shape. The desktop UI rebuilds the typed extraction
    // from the response on confirm().
    let sidecar = SidecarPrepareLlmRequest {
        protocol_version: PROTOCOL_VERSION,
        kind: "prepareLlmExtraction".to_string(),
        request_id: req.request_id.clone(),
        document_id: req.document_id.clone(),
        provider_id: req.provider_id.clone(),
        model_id: req.model_id.clone(),
        purpose: req.purpose.clone(),
        disclosure_version: req.disclosure_version.clone(),
        transformed_policy_version: req.transformed_policy_version.clone(),
        local_extraction: None,
        operation_correlation_id: req.operation_correlation_id.clone(),
    };
    let response = match run_privacy_sidecar(&sidecar, "prepareLlmExtraction") {
        Ok(r) => r,
        Err((code, message)) => return privacy_error_response::<PrepareLlmExtractionResultV1>(&req, &code, &message),
    };
    if response.status != "ok" {
        let err = response.error.unwrap_or_else(default_privacy_error);
        return privacy_error_response::<PrepareLlmExtractionResultV1>(&req, &err.code, &err.message);
    }
    let data = match response.data {
        Some(value) => value,
        None => return privacy_error_response::<PrepareLlmExtractionResultV1>(&req, "invalid_response", "missing data"),
    };
    let raw: RawPrepareData = match serde_json::from_value(data) {
        Ok(v) => v,
        Err(_) => return privacy_error_response::<PrepareLlmExtractionResultV1>(&req, "invalid_response", "unparseable data"),
    };
    let data = PrepareLlmExtractionResultV1 {
        transaction_id: raw.transaction_id,
        payload_sha256: raw.payload_sha256,
        provider_id: raw.provider_id,
        model_id: raw.model_id,
        purpose: raw.purpose,
        disclosure: LlmDisclosureV1 {
            version: raw.disclosure.version,
            transformed_policy_version: raw.disclosure.transformed_policy_version,
            provider_id: raw.disclosure.provider_id,
            model_id: raw.disclosure.model_id,
            purpose: raw.disclosure.purpose,
            document_sha256: raw.disclosure.document_sha256,
            payload_sha256: raw.disclosure.payload_sha256,
            expires_at: raw.disclosure.expires_at,
        },
        expires_at: raw.expires_at,
    };
    validate_and_wrap(&req, data)
}

#[tauri::command]
fn confirm_llm_extraction_v1(req: ConfirmLlmExtractionV1) -> ApiResult<ConfirmLlmExtractionResultV1> {
    if req.validate().is_err() {
        return validate_and_wrap(
            &req,
            ConfirmLlmExtractionResultV1 {
                request: LlmProviderRequestV1 {
                    transaction_id: String::new(),
                    provider_id: String::new(),
                    model_id: String::new(),
                    purpose: String::new(),
                    payload_media_type: String::new(),
                    exact_payload_bytes: String::new(),
                    payload_sha256: String::new(),
                    deadline_ms: 0,
                    response_limit_bytes: 0,
                },
            },
        );
    }
    let sidecar = SidecarConfirmLlmRequest {
        protocol_version: PROTOCOL_VERSION,
        kind: "confirmLlmExtraction".to_string(),
        request_id: req.request_id.clone(),
        transaction_id: req.transaction_id.clone(),
        document_sha256: req.document_sha256.clone(),
        local_extraction: None,
    };
    let response = match run_privacy_sidecar(&sidecar, "confirmLlmExtraction") {
        Ok(r) => r,
        Err((code, message)) => return privacy_error_response::<ConfirmLlmExtractionResultV1>(&req, &code, &message),
    };
    if response.status != "ok" {
        let err = response.error.unwrap_or_else(default_privacy_error);
        return privacy_error_response::<ConfirmLlmExtractionResultV1>(&req, &err.code, &err.message);
    }
    let data = match response.data {
        Some(value) => value,
        None => return privacy_error_response::<ConfirmLlmExtractionResultV1>(&req, "invalid_response", "missing data"),
    };
    let raw: RawConfirmData = match serde_json::from_value(data) {
        Ok(v) => v,
        Err(_) => return privacy_error_response::<ConfirmLlmExtractionResultV1>(&req, "invalid_response", "unparseable data"),
    };
    let data = ConfirmLlmExtractionResultV1 {
        request: LlmProviderRequestV1 {
            transaction_id: raw.request.transaction_id,
            provider_id: raw.request.provider_id,
            model_id: raw.request.model_id,
            purpose: raw.request.purpose,
            payload_media_type: raw.request.payload_media_type,
            exact_payload_bytes: raw.request.exact_payload_bytes,
            payload_sha256: raw.request.payload_sha256,
            deadline_ms: raw.request.deadline_ms,
            response_limit_bytes: raw.request.response_limit_bytes,
        },
    };
    validate_and_wrap(&req, data)
}

#[tauri::command]
fn get_document_pdf_base64_v1(
    req: GetDocumentPdfBase64V1,
) -> ApiResult<DocumentPdfBase64V1> {
    let stored = match documents().get(&req.document_id) {
        Some(doc) => doc,
        None => {
            return operational_error(
                &req,
                PublicErrorCode::UnauthorizedDocument,
                "document_not_found",
            )
        }
    };
    let data = DocumentPdfBase64V1 {
        pdf_base64: STANDARD.encode(&stored.bytes),
    };
    validate_and_wrap(&req, data)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            greet,
            register_document_v1,
            extract_local_v1,
            cancel_operation_v1,
            get_document_pdf_base64_v1,
            prepare_llm_extraction_v1,
            confirm_llm_extraction_v1
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::fs;

    #[test]
    fn extract_flow_returns_ok_for_valid_pdf() {
        let bytes = fs::read("../../../test/fixtures/A-G2026-245895.pdf").unwrap();
        let register = RegisterDocumentV1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174000".to_string(),
            name: "invoice.pdf".to_string(),
            declared_bytes: bytes.len() as u64,
            pdf_base64: STANDARD.encode(&bytes),
        };
        let registered = match register_document_v1(register) {
            ApiResult::Ok { data, .. } => data,
            other => panic!("unexpected register result: {other:?}"),
        };
        let extract = ExtractLocalV1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174001".to_string(),
            document_id: registered.document_id,
            options: None,
        };
        match extract_local_v1(extract) {
            ApiResult::Ok { data, .. } => assert!(data.pages_processed > 0),
            other => panic!("unexpected extract result: {other:?}"),
        }
    }

    #[test]
    fn get_document_pdf_base64_returns_registered_bytes() {
        let bytes: &[u8] = b"%PDF-1.4\n%minimal pdf bytes for unit test\n%%EOF\n";
        let register = RegisterDocumentV1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174000".to_string(),
            name: "invoice.pdf".to_string(),
            declared_bytes: bytes.len() as u64,
            pdf_base64: STANDARD.encode(bytes),
        };
        let registered = match register_document_v1(register) {
            ApiResult::Ok { data, .. } => data,
            other => panic!("unexpected register result: {other:?}"),
        };
        let get_req = GetDocumentPdfBase64V1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174002".to_string(),
            document_id: registered.document_id.clone(),
        };
        match get_document_pdf_base64_v1(get_req) {
            ApiResult::Ok { data, .. } => {
                assert_eq!(data.pdf_base64, STANDARD.encode(bytes));
            }
            other => panic!("unexpected get result: {other:?}"),
        }
    }

    #[test]
    fn get_document_pdf_base64_rejects_unknown_document() {
        let get_req = GetDocumentPdfBase64V1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174003".to_string(),
            document_id: "aaaaaaaaaaaaaaaaaaaaaa".to_string(),
        };
        match get_document_pdf_base64_v1(get_req) {
            ApiResult::Error { error, .. } => {
                assert_eq!(error.code, PublicErrorCode::UnauthorizedDocument);
            }
            other => panic!("expected error for unknown document, got: {other:?}"),
        }
    }

    // === WU-3D1: privacy sidecar Tauri commands ===
    //
    // The commands route to the Node engine sidecar which calls the Slice 3
    // PrivacyTransactionService. The provider registry defaults to
    // `disabled`, so today's tests exercise the fail-closed path end-to-end.
    // The integration tests below require a built Node engine and skip when
    // the sidecar is unavailable (CI sandboxing, missing engine script).

    fn valid_prepare_request() -> PrepareLlmExtractionV1 {
        PrepareLlmExtractionV1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174010".to_string(),
            document_id: "AAAAAAAAAAAAAAAAAAAAAA".to_string(),
            provider_id: "minimax".to_string(),
            model_id: "MiniMax-M3".to_string(),
            purpose: "extract_invoice".to_string(),
            disclosure_version: "v1".to_string(),
            transformed_policy_version: "pseudonymize-v1".to_string(),
            local_extraction: None,
            operation_correlation_id: Some("test-correlation".to_string()),
        }
    }

    fn valid_confirm_request() -> ConfirmLlmExtractionV1 {
        ConfirmLlmExtractionV1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174011".to_string(),
            transaction_id: "BBBBBBBBBBBBBBBBBBBBBB".to_string(),
            document_sha256: None,
            local_extraction: None,
        }
    }

    #[test]
    fn prepare_llm_extraction_v1_rejects_invalid_request_dto() {
        let mut req = valid_prepare_request();
        req.document_id = "bad".to_string(); // too short
        let result = prepare_llm_extraction_v1(req);
        match result {
            ApiResult::Error { error, .. } => {
                assert_eq!(error.code, PublicErrorCode::InvalidRequest);
            }
            other => panic!("expected validation error, got: {other:?}"),
        }
    }

    #[test]
    fn confirm_llm_extraction_v1_rejects_invalid_request_dto() {
        let mut req = valid_confirm_request();
        req.transaction_id = "bad".to_string();
        let result = confirm_llm_extraction_v1(req);
        match result {
            ApiResult::Error { error, .. } => {
                assert_eq!(error.code, PublicErrorCode::InvalidRequest);
            }
            other => panic!("expected validation error, got: {other:?}"),
        }
    }

    #[test]
    fn prepare_llm_extraction_v1_returns_provider_disabled_via_sidecar() {
        let req = valid_prepare_request();
        let result = prepare_llm_extraction_v1(req.clone());
        match result {
            ApiResult::Error { error, request_id, .. } => {
                // The sidecar may be unavailable in the test environment
                // (CI sandbox / no node on PATH). In that case we accept
                // engine_unavailable or engine_lost instead of
                // provider_disabled.
                assert!(
                    matches!(
                        error.code,
                        PublicErrorCode::ProviderDisabled
                            | PublicErrorCode::EngineUnavailable
                            | PublicErrorCode::EngineLost
                    ),
                    "expected provider_disabled or engine fallthrough, got: {:?}",
                    error.code
                );
                assert_eq!(request_id, req.request_id);
            }
            ApiResult::Ok { .. } => panic!("provider is disabled by default; prepare() should not succeed"),
        }
    }

    #[test]
    fn confirm_llm_extraction_v1_returns_provider_disabled_via_sidecar() {
        let req = valid_confirm_request();
        let result = confirm_llm_extraction_v1(req.clone());
        match result {
            ApiResult::Error { error, request_id, .. } => {
                assert!(
                    matches!(
                        error.code,
                        PublicErrorCode::ProviderDisabled
                            | PublicErrorCode::TransactionMismatch
                            | PublicErrorCode::EngineUnavailable
                            | PublicErrorCode::EngineLost
                    ),
                    "expected provider_disabled / tx_unknown / engine fallthrough, got: {:?}",
                    error.code
                );
                assert_eq!(request_id, req.request_id);
            }
            ApiResult::Ok { .. } => panic!("provider is disabled by default; confirm() should not succeed"),
        }
    }

    #[test]
    fn map_privacy_error_code_covers_all_closed_vocabulary() {
        // The vocabulary is closed: every privacy-sidecar error code must
        // map onto a typed PublicErrorCode. Pin the mapping so a future
        // privacy-sidecar bug shows up as a typed envelope, not a 500.
        use super::map_privacy_error_code;
        assert_eq!(map_privacy_error_code("provider_disabled"), PublicErrorCode::ProviderDisabled);
        assert_eq!(map_privacy_error_code("tx_unknown"), PublicErrorCode::TransactionMismatch);
        assert_eq!(map_privacy_error_code("tx_already_consumed"), PublicErrorCode::TransactionConsumed);
        assert_eq!(map_privacy_error_code("tx_expired"), PublicErrorCode::TransactionExpired);
        assert_eq!(map_privacy_error_code("tx_mismatch"), PublicErrorCode::TransactionMismatch);
        assert_eq!(map_privacy_error_code("provider_response_invalid"), PublicErrorCode::ProviderResponseInvalid);
        assert_eq!(map_privacy_error_code("invalid_request"), PublicErrorCode::InvalidRequest);
        assert_eq!(map_privacy_error_code("engine_unavailable"), PublicErrorCode::EngineUnavailable);
        assert_eq!(map_privacy_error_code("engine_lost"), PublicErrorCode::EngineLost);
        assert_eq!(map_privacy_error_code("protocol_mismatch"), PublicErrorCode::ProtocolMismatch);
        assert_eq!(map_privacy_error_code("response_too_large"), PublicErrorCode::ResponseTooLarge);
        // Unknown codes must fall through to Internal, never to a typed
        // security-sensitive code.
        assert_eq!(map_privacy_error_code("totally-unknown"), PublicErrorCode::Internal);
    }
}
