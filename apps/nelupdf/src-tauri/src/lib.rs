// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod contracts;
mod doc_store;
mod engine;
#[cfg(test)]
mod test_support;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use contracts::{
    validate_and_wrap, ApiResult, CancelOperationResultV1, CancelOperationV1, CancelOutcome,
    ExtractLocalV1, ExtractionMode, ExtractionStatus, InvoiceFieldsV1, InvoiceTotalsV1,
    LocalExtractionV1, PublicError, PublicErrorCode, RegisterDocumentV1, RegisteredDocumentV1,
    RetryCategory, Validate, PROTOCOL_VERSION,
};
use doc_store::DocStore;
use engine::{run_extraction, SidecarDocument, SidecarLimits, SidecarRequest, SidecarResponse};
use std::sync::OnceLock;

static DOCUMENTS: OnceLock<DocStore> = OnceLock::new();

fn documents() -> &'static DocStore {
    DOCUMENTS.get_or_init(DocStore::default)
}

fn operational_error<T>(
    req: &ExtractLocalV1,
    code: PublicErrorCode,
    message_key: &'static str,
) -> ApiResult<T> {
    ApiResult::Error {
        ok: false,
        protocol_version: req.protocol_version,
        request_id: req.request_id.clone(),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            register_document_v1,
            extract_local_v1,
            cancel_operation_v1
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
}
