// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod contracts;
#[cfg(test)]
mod test_support;

use contracts::{
    validate_and_wrap, ApiResult, CancelOutcome, CancelOperationResultV1, CancelOperationV1,
    ExtractionMode, ExtractionStatus, ExtractLocalV1, InvoiceFieldsV1, InvoiceTotalsV1,
    LocalExtractionV1, RegisterDocumentV1, RegisteredDocumentV1, SHA256_LEN,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn register_document_v1(req: RegisterDocumentV1) -> ApiResult<RegisteredDocumentV1> {
    let data = RegisteredDocumentV1 {
        document_id: "AAAAAAAAAAAAAAAAAAAAAA".to_string(),
        display_name: req.name.clone(),
        byte_length: req.declared_bytes,
    };
    validate_and_wrap(&req, data)
}

#[tauri::command]
fn extract_local_v1(req: ExtractLocalV1) -> ApiResult<LocalExtractionV1> {
    let data = LocalExtractionV1 {
        provenance: "local_deterministic".to_string(),
        document_sha256: "a".repeat(SHA256_LEN),
        status: ExtractionStatus::Complete,
        pages_processed: 0,
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
        untrusted: true,
    };
    validate_and_wrap(&req, data)
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
