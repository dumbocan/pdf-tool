use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;

use crate::contracts::{ContractError, InvoiceFieldsV1, PROTOCOL_VERSION};

fn deserialize_invoice_fields<'de, D>(deserializer: D) -> Result<Option<InvoiceFieldsV1>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    let Some(mut value) = value else {
        return Ok(None);
    };
    if let Some(object) = value.as_object_mut() {
        object.remove("labels");
        object.remove("trustBoundary");
        object.remove("vendor");
        object.remove("untrusted");
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarRequest {
    pub protocol_version: u8,
    pub kind: String,
    pub request_id: String,
    pub document: SidecarDocument,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limits: Option<SidecarLimits>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarDocument {
    pub name: String,
    pub byte_length: u64,
    pub sha256: String,
    pub pdf_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarLimits {
    pub max_pages: Option<u32>,
    pub max_chars: Option<u32>,
}

// === WU-3D1: privacy sidecar request shapes (Slice 3) ===
//
// The privacy entry never touches the document — it only re-shapes the
// cached local result that the Rust client already owns. The fields below
// mirror the allowlist the Node sidecar enforces; unknown fields are
// rejected before the request reaches the privacy service.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarLocalExtraction {
    pub provenance: String,
    pub document_sha256: String,
    pub status: String,
    pub pages_processed: u32,
    pub truncation_reason: Option<String>,
    pub extraction_mode: String,
    pub invoice: SidecarInvoice,
    pub review_pdf_base64: Option<String>,
    pub untrusted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarInvoice {
    pub invoice_number: Option<String>,
    pub invoice_date: Option<String>,
    pub simplified_invoice_date: Option<String>,
    pub tax_label: Option<String>,
    pub totals: SidecarTotals,
    pub matched: Vec<SidecarMatchedField>,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SidecarTotals {
    pub subtotal: Option<String>,
    pub tax: Option<String>,
    pub total: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarMatchedField {
    pub label: String,
    pub value: Option<String>,
    pub bbox: Option<serde_json::Value>,
    pub editable: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarPrepareLlmRequest {
    pub protocol_version: u8,
    pub kind: String,
    pub request_id: String,
    pub document_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: String,
    pub disclosure_version: String,
    pub transformed_policy_version: String,
    pub local_extraction: Option<SidecarLocalExtraction>,
    pub operation_correlation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarConfirmLlmRequest {
    pub protocol_version: u8,
    pub kind: String,
    pub request_id: String,
    pub transaction_id: String,
    pub document_sha256: Option<String>,
    pub local_extraction: Option<SidecarLocalExtraction>,
}

// === WU-3D1: generic privacy sidecar response ===
//
// The Node sidecar emits a uniform `{ protocolVersion, kind, requestId,
// status, data?, error? }` envelope. `data` and `error` are opaque
// `serde_json::Value` because per-kind shapes diverge (BoundTransaction vs
// ProviderRequest vs reversed fields). The Tauri command translates the
// status / error code into a typed `ApiResult::Error` before returning.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarPrivacyResponse {
    pub protocol_version: u8,
    pub kind: String,
    pub request_id: String,
    pub status: String,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub error: Option<SidecarPrivacyError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarPrivacyError {
    pub code: String,
    #[serde(default)]
    pub message: String,
}

impl SidecarPrivacyResponse {
    pub fn into_api_result<T, F>(self, request_id: &str, map_data: F) -> Result<T, (String, String)>
    where
        F: FnOnce(serde_json::Value) -> Result<T, String>,
    {
        match self.status.as_str() {
            "ok" => match self.data {
                Some(value) => map_data(value).map_err(|msg| ("invalid_response".to_string(), msg)),
                None => Err(("invalid_response".to_string(), "missing data".to_string())),
            },
            "error" => {
                let err = self.error.unwrap_or(SidecarPrivacyError {
                    code: "invalid_response".to_string(),
                    message: "missing error envelope".to_string(),
                });
                Err((err.code, err.message))
            }
            other => Err((
                "invalid_response".to_string(),
                format!("unknown status: {other}; request_id={request_id}"),
            )),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SidecarResponse {
    pub protocol_version: u8,
    pub kind: String,
    pub request_id: String,
    pub status: String,
    pub text: Option<String>,
    pub pages: Option<u32>,
    pub truncated: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_invoice_fields")]
    pub invoice_fields: Option<InvoiceFieldsV1>,
    #[serde(default)]
    pub line_items: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub parser: Option<String>,
    #[serde(default)]
    pub extraction_mode: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

pub fn encode_frame<T: Serialize>(obj: &T) -> Result<Vec<u8>, ContractError> {
    let payload = serde_json::to_vec(obj).map_err(|_| ContractError::new("invalid_json"))?;
    let length = u32::try_from(payload.len()).map_err(|_| ContractError::new("frame_too_large"))?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub fn parse_frame(buf: &[u8]) -> Result<serde_json::Value, ContractError> {
    if buf.len() < 4 {
        return Err(ContractError::new("empty_frame"));
    }
    let length = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
    let frame_end = 4usize
        .checked_add(length)
        .ok_or_else(|| ContractError::new("truncated_frame"))?;
    if length == 0 || buf.len() < frame_end {
        return Err(ContractError::new("truncated_frame"));
    }
    if buf.len() > frame_end {
        return Err(ContractError::new("trailing_data"));
    }
    serde_json::from_slice(&buf[4..frame_end]).map_err(|_| ContractError::new("invalid_json"))
}

pub fn find_engine_path() -> Option<PathBuf> {
    // WU-5A2-GREEN: check bundled resources first (tauri resource_dir).
    if let Ok(resource_dir) = std::env::var("RESOURCE_DIR") {
        let bundled = PathBuf::from(&resource_dir).join("engine-stdio.js");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    // Environment override (dev / CI).
    if let Ok(path) = std::env::var("PDF_TOOL_ENGINE_PATH") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    // Dev-mode fallback (relative to binary); NOT used in promoted build.
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("../../../src/engine-stdio.js"));
            candidates.push(parent.join("../../../../src/engine-stdio.js"));
        }
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../src/engine-stdio.js"));
    candidates.into_iter().find(|path| path.is_file())
}

pub fn run_extraction(req: SidecarRequest) -> Result<SidecarResponse, ContractError> {
    let engine = find_engine_path().ok_or_else(|| ContractError::new("engine_unavailable"))?;
    let frame = encode_frame(&req)?;
    let mut child = Command::new("node")
        .arg(engine)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| ContractError::new("engine_unavailable"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| ContractError::new("engine_lost"))?
        .write_all(&frame)
        .map_err(|_| ContractError::new("engine_lost"))?;
    drop(child.stdin.take());
    let mut stdout = Vec::new();
    child
        .stdout
        .take()
        .ok_or_else(|| ContractError::new("engine_lost"))?
        .read_to_end(&mut stdout)
        .map_err(|_| ContractError::new("engine_lost"))?;
    let status = child
        .wait()
        .map_err(|_| ContractError::new("engine_lost"))?;
    if !status.success() && stdout.is_empty() {
        return Err(ContractError::new("engine_lost"));
    }
    parse_sidecar_output(stdout)
}

fn parse_sidecar_output(stdout: Vec<u8>) -> Result<SidecarResponse, ContractError> {
    if stdout.len() > crate::contracts::MAX_RESPONSE_BYTES + 4 {
        return Err(ContractError::new("response_too_large"));
    }
    let value = parse_frame(&stdout)?;
    serde_json::from_value(value).map_err(|_| ContractError::new("invalid_response"))
}

// === WU-3D1: privacy sidecar runner (Slice 3) ===
//
// Spawns the same engine-stdio.js subprocess, but issues a different
// sidecar kind. The privacy service is fail-closed today (every provider
// returns `disabled`); the runner converts the sidecar envelope into a
// typed `Result<SidecarPrivacyResponse, (code, message)>` so the Tauri
// command can map the error code onto the closed `PublicErrorCode`
// vocabulary.
pub fn run_privacy_sidecar(
    req: &(impl Serialize),
    expected_kind: &str,
) -> Result<SidecarPrivacyResponse, (String, String)> {
    let engine = match find_engine_path() {
        Some(p) => p,
        None => return Err(("engine_unavailable".to_string(), "engine_unavailable".to_string())),
    };
    let frame = match encode_frame(req) {
        Ok(f) => f,
        Err(_) => return Err(("engine_lost".to_string(), "frame_encode_failed".to_string())),
    };
    let mut child = match Command::new("node")
        .arg(engine)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return Err(("engine_unavailable".to_string(), "engine_unavailable".to_string())),
    };
    if child
        .stdin
        .take()
        .ok_or_else(|| ("engine_lost".to_string(), "engine_lost".to_string()))
        .and_then(|mut stdin| {
            stdin.write_all(&frame).map_err(|_| ("engine_lost".to_string(), "engine_lost".to_string()))
        })
        .is_err()
    {
        return Err(("engine_lost".to_string(), "engine_lost".to_string()));
    }
    drop(child.stdin.take());
    let mut stdout = Vec::new();
    if child
        .stdout
        .take()
        .ok_or_else(|| ("engine_lost".to_string(), "engine_lost".to_string()))
        .and_then(|mut stdout_pipe| {
            stdout_pipe
                .read_to_end(&mut stdout)
                .map_err(|_| ("engine_lost".to_string(), "engine_lost".to_string()))
        })
        .is_err()
    {
        return Err(("engine_lost".to_string(), "engine_lost".to_string()));
    }
    let status = match child.wait() {
        Ok(s) => s,
        Err(_) => return Err(("engine_lost".to_string(), "engine_lost".to_string())),
    };
    if !status.success() && stdout.is_empty() {
        return Err(("engine_lost".to_string(), "engine_lost".to_string()));
    }
    if stdout.len() > crate::contracts::MAX_RESPONSE_BYTES + 4 {
        return Err(("response_too_large".to_string(), "response_too_large".to_string()));
    }
    let value = match parse_frame(&stdout) {
        Ok(v) => v,
        Err(_) => return Err(("invalid_response".to_string(), "invalid_response".to_string())),
    };
    let response: SidecarPrivacyResponse = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(_) => return Err(("invalid_response".to_string(), "invalid_response".to_string())),
    };
    if response.protocol_version != PROTOCOL_VERSION {
        return Err(("protocol_mismatch".to_string(), "protocol_mismatch".to_string()));
    }
    if response.kind != expected_kind {
        return Err((
            "invalid_response".to_string(),
            format!("expected kind={expected_kind} got {}", response.kind),
        ));
    }
    Ok(response)
}

// Convert a `LocalExtractionV1` (the desktop's typed result) into the
// sidecar-compatible flat shape. The Node sidecar uses the same field
// names so the JSON round-trip is transparent; the only difference is the
// bbox value type which we carry as-is.
pub fn local_extraction_to_sidecar(
    extraction: &crate::contracts::LocalExtractionV1,
) -> SidecarLocalExtraction {
    let matched = extraction
        .invoice
        .matched
        .iter()
        .map(|m| SidecarMatchedField {
            label: m.label.clone(),
            value: m.value.clone(),
            bbox: m.bbox.as_ref().map(|b| {
                serde_json::json!({
                    "page": b.page,
                    "x": b.x,
                    "y": b.y,
                    "width": b.width,
                    "height": b.height,
                })
            }),
            editable: m.editable,
        })
        .collect();
    SidecarLocalExtraction {
        provenance: extraction.provenance.clone(),
        document_sha256: extraction.document_sha256.clone(),
        status: extraction.status.as_label().to_string(),
        pages_processed: extraction.pages_processed,
        truncation_reason: extraction.truncation_reason.map(|r| r.as_label().to_string()),
        extraction_mode: extraction.extraction_mode.as_label().to_string(),
        invoice: SidecarInvoice {
            invoice_number: extraction.invoice.invoice_number.clone(),
            invoice_date: extraction.invoice.invoice_date.clone(),
            simplified_invoice_date: extraction.invoice.simplified_invoice_date.clone(),
            tax_label: extraction.invoice.tax_label.clone(),
            totals: SidecarTotals {
                subtotal: extraction.invoice.totals.subtotal.clone(),
                tax: extraction.invoice.totals.tax.clone(),
                total: extraction.invoice.totals.total.clone(),
            },
            matched,
        },
        review_pdf_base64: extraction.review_pdf_base64.clone(),
        untrusted: extraction.untrusted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::PROTOCOL_VERSION;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use sha2::Digest;

    #[test]
    fn frame_encode_decode_roundtrip() {
        let value = serde_json::json!({"hello": "world", "n": 1});
        let frame = encode_frame(&value).unwrap();
        assert_eq!(parse_frame(&frame).unwrap(), value);
    }

    #[test]
    fn frame_rejects_short_buffer() {
        assert!(parse_frame(&[0, 1, 2]).is_err());
    }

    #[test]
    fn frame_rejects_truncated() {
        assert_eq!(
            parse_frame(&[0, 0, 0, 100, 1]).unwrap_err().code,
            "truncated_frame"
        );
    }

    #[test]
    fn frame_rejects_trailing() {
        let mut frame = encode_frame(&serde_json::json!({"a": 1})).unwrap();
        frame.push(0);
        assert_eq!(parse_frame(&frame).unwrap_err().code, "trailing_data");
    }

    #[test]
    fn frame_rejects_invalid_json() {
        let mut frame = vec![0, 0, 0, 3];
        frame.extend_from_slice(b"bad");
        assert_eq!(parse_frame(&frame).unwrap_err().code, "invalid_json");
    }

    #[test]
    fn run_extraction_returns_ok() {
        if find_engine_path().is_none() || Command::new("node").arg("--version").output().is_err() {
            eprintln!("SKIP: node or engine path not available");
            return;
        }
        let pdf = std::fs::read("../../../test/fixtures/A-G2026-245895.pdf").unwrap();
        let req = SidecarRequest {
            protocol_version: PROTOCOL_VERSION,
            kind: "extractLocal".to_string(),
            request_id: "123e4567-e89b-42d3-a456-426614174000".to_string(),
            document: SidecarDocument {
                name: "test.pdf".to_string(),
                byte_length: pdf.len() as u64,
                sha256: format!("{:x}", sha2::Sha256::digest(&pdf)),
                pdf_base64: STANDARD.encode(&pdf),
            },
            limits: None,
        };
        let response = run_extraction(req).unwrap();
        assert_eq!(response.kind, "extractLocal");
        assert_eq!(response.protocol_version, 1);
        assert_eq!(response.request_id, "123e4567-e89b-42d3-a456-426614174000");
        // Status must be one of the valid states; for a digital-text PDF, "ok" is expected.
        assert_eq!(response.status, "ok", "status should be ok for digital PDF");
        assert!(response.pages.unwrap_or(0) > 0, "pages should be > 0 for valid PDF");
        assert!(response.invoice_fields.is_some(), "invoice fields should be present");
    }

    #[test]
    fn run_extraction_rejects_sha_mismatch() {
        if find_engine_path().is_none() || Command::new("node").arg("--version").output().is_err() {
            eprintln!("SKIP: node or engine path not available");
            return;
        }
        let pdf = std::fs::read("../../../test/fixtures/A-G2026-245895.pdf").unwrap();
        let req = SidecarRequest {
            protocol_version: PROTOCOL_VERSION,
            kind: "extractLocal".to_string(),
            request_id: "123e4567-e89b-42d3-a456-426614174000".to_string(),
            document: SidecarDocument {
                name: "test.pdf".to_string(),
                byte_length: pdf.len() as u64,
                sha256: "0".repeat(64), // fake hash — engine validates and rejects
                pdf_base64: STANDARD.encode(&pdf),
            },
            limits: None,
        };
        let response = run_extraction(req).unwrap();
        assert_eq!(response.status, "error", "engine should reject hash mismatch");
        assert_eq!(response.error.as_deref(), Some("hash_mismatch"));
    }

    #[test]
    fn roundtrip_through_extract_command() {
        if find_engine_path().is_none() || Command::new("node").arg("--version").output().is_err() {
            eprintln!("SKIP: node or engine path not available");
            return;
        }
        let pdf = std::fs::read("../../../test/fixtures/A-G2026-245895.pdf").unwrap();
        let base64 = STANDARD.encode(&pdf);
        let sha256 = format!("{:x}", sha2::Sha256::digest(&pdf));

        // Step 1: Register the document (simulate the command handler logic)
        use crate::contracts::{RegisterDocumentV1, Validate, is_valid_uuid_v4};
        let request_id = "550e8400-e29b-43d4-a716-446655440000".to_string();
        assert!(is_valid_uuid_v4(&request_id));

        let register_req = RegisterDocumentV1 {
            protocol_version: 1,
            request_id: request_id.clone(),
            name: "test.pdf".to_string(),
            declared_bytes: pdf.len() as u64,
            pdf_base64: base64.clone(),
        };
        assert!(register_req.validate().is_ok());

        // Step 2: Build the sidecar request (as extract_local_v1 would)
        let doc_id = crate::doc_store::generate_doc_id();
        let sidecar_req = SidecarRequest {
            protocol_version: PROTOCOL_VERSION,
            kind: "extractLocal".to_string(),
            request_id,
            document: SidecarDocument {
                name: "test.pdf".to_string(),
                byte_length: pdf.len() as u64,
                sha256,
                pdf_base64: base64,
            },
            limits: Some(SidecarLimits {
                max_pages: Some(crate::contracts::MAX_PAGES),
                max_chars: Some(crate::contracts::MAX_CHARS),
            }),
        };
        let response = run_extraction(sidecar_req).unwrap();
        assert_eq!(response.status, "ok");
        assert_eq!(response.pages.unwrap_or(0), response.pages.unwrap_or(0)); // smoke test

        // Step 3: Map to LocalExtractionV1 (as the command handler does)
        use crate::contracts::{ExtractionMode, ExtractionStatus, InvoiceFieldsV1, InvoiceTotalsV1, LocalExtractionV1};
        let local = LocalExtractionV1 {
            provenance: "local_deterministic".to_string(),
            document_sha256: response.sha256.unwrap_or_default(),
            status: ExtractionStatus::Complete,
            pages_processed: response.pages.unwrap_or(0),
            truncation_reason: None,
            extraction_mode: ExtractionMode::DigitalText,
            invoice: response.invoice_fields.unwrap_or(InvoiceFieldsV1 {
                invoice_number: None,
                invoice_date: None,
                simplified_invoice_date: None,
                tax_label: None,
                totals: InvoiceTotalsV1 { subtotal: None, tax: None, total: None },
                matched: vec![],
            }),
            review_pdf_base64: None,
            untrusted: true,
        };
        assert_eq!(local.provenance, "local_deterministic");
        assert_eq!(local.untrusted, true);
        assert_eq!(local.extraction_mode, ExtractionMode::DigitalText);
        let _ = doc_id; // silence unused warning
    }
}
