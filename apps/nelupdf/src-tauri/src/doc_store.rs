use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::contracts::{ContractError, RegisterDocumentV1, RegisteredDocumentV1};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDoc {
    pub name: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
}

#[derive(Clone, Default)]
pub struct DocStore {
    docs: Arc<Mutex<HashMap<String, StoredDoc>>>,
}

impl DocStore {
    pub fn store(&self, req: RegisterDocumentV1) -> Result<RegisteredDocumentV1, ContractError> {
        let bytes = STANDARD
            .decode(req.pdf_base64.as_bytes())
            .map_err(|_| ContractError::new("invalid_base64"))?;
        if bytes.len() as u64 != req.declared_bytes {
            return Err(ContractError::new("declared_bytes"));
        }

        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let document_id = generate_doc_id();
        let byte_length = bytes.len() as u64;
        self.docs
            .lock()
            .expect("document store mutex poisoned")
            .insert(
                document_id.clone(),
                StoredDoc {
                    name: req.name.clone(),
                    bytes,
                    sha256,
                },
            );

        Ok(RegisteredDocumentV1 {
            document_id,
            display_name: req.name,
            byte_length,
        })
    }

    pub fn get(&self, document_id: &str) -> Option<StoredDoc> {
        self.docs
            .lock()
            .expect("document store mutex poisoned")
            .get(document_id)
            .cloned()
    }

    #[allow(dead_code)]
    pub fn remove(&self, document_id: &str) -> bool {
        self.docs
            .lock()
            .expect("document store mutex poisoned")
            .remove(document_id)
            .is_some()
    }
}

pub fn generate_doc_id() -> String {
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(data: &[u8]) -> RegisterDocumentV1 {
        RegisterDocumentV1 {
            protocol_version: 1,
            request_id: "123e4567-e89b-42d3-a456-426614174000".to_string(),
            name: "invoice.pdf".to_string(),
            declared_bytes: data.len() as u64,
            pdf_base64: STANDARD.encode(data),
        }
    }

    #[test]
    fn doc_store_generates_valid_22_char_id() {
        let id = generate_doc_id();
        assert_eq!(id.len(), 22);
        assert!(id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
    }

    #[test]
    fn doc_store_stores_and_retrieves() {
        let store = DocStore::default();
        let data = b"pdf bytes";
        let registered = store.store(request(data)).unwrap();
        let stored = store.get(&registered.document_id).unwrap();
        assert_eq!(stored.bytes, data);
        assert_eq!(stored.name, "invoice.pdf");
        assert_eq!(registered.byte_length, data.len() as u64);
    }

    #[test]
    fn doc_store_rejects_invalid_base64() {
        let store = DocStore::default();
        let mut req = request(b"pdf bytes");
        req.pdf_base64 = "!!!invalid!!!".to_string();
        assert_eq!(store.store(req).unwrap_err().code, "invalid_base64");
    }

    #[test]
    fn doc_store_removes_doc() {
        let store = DocStore::default();
        let registered = store.store(request(b"pdf bytes")).unwrap();
        assert!(store.remove(&registered.document_id));
        assert!(store.get(&registered.document_id).is_none());
    }

    #[test]
    fn doc_store_sha256_matches() {
        let store = DocStore::default();
        let data = b"pdf bytes";
        let registered = store.store(request(data)).unwrap();
        let stored = store.get(&registered.document_id).unwrap();
        assert_eq!(stored.sha256, format!("{:x}", Sha256::digest(data)));
    }
}
