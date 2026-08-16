import { invoke } from "@tauri-apps/api/core";

import type { LocalExtractionV1, PublicError } from "./types";

export type ExtractResult =
  | {
      ok: true;
      protocolVersion: number;
      requestId: string;
      data: LocalExtractionV1;
    }
  | {
      ok: false;
      protocolVersion: number;
      requestId: string;
      error: PublicError;
    };

export interface DesktopApi {
  registerDocument(opts: {
    requestId: string;
    name: string;
    declaredBytes: number;
    pdfBase64: string;
  }): Promise<{
    documentId: string;
    displayName: string;
    byteLength: number;
  }>;
  extractLocal(opts: {
    requestId: string;
    documentId: string;
    maxPages?: number;
    maxChars?: number;
  }): Promise<ExtractResult>;
  requestLlmPreview?(): Promise<never>;
  confirmLlm?(): Promise<never>;
}

export function createTauriDesktopApi(): DesktopApi {
  return {
    async registerDocument(opts) {
      const result = await invoke("register_document_v1", {
        req: {
          protocolVersion: 1,
          requestId: opts.requestId,
          name: opts.name,
          declaredBytes: opts.declaredBytes,
          pdfBase64: opts.pdfBase64,
        },
      });
      return (result as { data: {
        documentId: string;
        displayName: string;
        byteLength: number;
      } }).data;
    },
    async extractLocal(opts) {
      const result = await invoke("extract_local_v1", {
        req: {
          protocolVersion: 1,
          requestId: opts.requestId,
          documentId: opts.documentId,
          options: {
            maxPages: opts.maxPages,
            maxChars: opts.maxChars,
          },
        },
      });
      return result as ExtractResult;
    },
  };
}
