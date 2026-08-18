import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import { VisualReview } from "./components/VisualReview";
import {
  createTauriDesktopApi,
  type DesktopApi,
} from "./lib/desktop-api";
import { LocalTemplateStore, type TemplateStore } from "./lib/template-store";
import type {
  Bbox,
  LocalExtractionV1,
  MatchedField,
  PublicError,
  RetryCategory,
  Template,
} from "./lib/types";
import { uuidv4 } from "./lib/uuid";
import { encodeCsv } from "./features/export/csv.ts";

type ExtractionState =
  | "idle"
  | "registering"
  | "ready"
  | "extracting"
  | "complete"
  | "truncated"
  | "partial"
  | "cancelled"
  | "invalid-input"
  | "engine-unavailable"
  | "timeout"
  | "cancellation"
  | "bounded-resource"
  | "engine_error"
  | "native-path-unavailable";

type Row = {
  file: string;
  invoiceNumber: string;
  invoiceDate: string;
  simplifiedInvoiceDate: string;
  total: string;
  subtotal: string;
  tax: string;
  taxLabel: string;
  matched: MatchedField[];
  state: ExtractionState;
  error?: PublicError;
};

type Progress = { file: string; index: number; total: number };

type ReviewState = {
  file: string;
  documentId: string;
  pdfBase64: string;
  extraction: LocalExtractionV1;
  fields: MatchedField[];
  templates: Template[];
};

const desktopApi = createTauriDesktopApi();
const templateStore: TemplateStore = new LocalTemplateStore();

type AppProps = {
  api?: DesktopApi;
  store?: TemplateStore;
};

function App({
  api = desktopApi,
  store = templateStore,
}: AppProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [processing, setProcessing] = useState(false);
  const [extractionState, setExtractionState] =
    useState<ExtractionState>("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    row: Row;
    notice: string;
    sample: string;
    provider: string;
  } | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const extractFile = useCallback(
    async (file: File): Promise<Row> => {
      const buf = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunk));
      }
      let base64 = btoa(binary);
      try {
        const requestId = uuidv4();
        setExtractionState("registering");
        const registered = await api.registerDocument({
          requestId,
          name: file.name,
          declaredBytes: buf.byteLength,
          pdfBase64: base64,
        });
        setExtractionState("ready");
        setExtractionState("extracting");
        const result = await api.extractLocal({
          requestId: uuidv4(),
          documentId: registered.documentId,
        });
        if (!result.ok) {
          const state = stateForError(result.error);
          setExtractionState(state);
          return emptyRow(file.name, state, result.error);
        }
        const state = stateForExtraction(result.data);
        setExtractionState(state);

        const fields = result.data.invoice.matched;
        const templates = await store.getByProvider("default");
        const matchedTemplate = await store.findMatch(fields, "default");
        const resolvedFields: MatchedField[] = matchedTemplate
          ? fields.map((f) => {
              const tpl = matchedTemplate.fields.find(
                (m) => m.label === f.label,
              );
              return tpl ? { ...f, bbox: tpl.bbox } : f;
            })
          : fields;

        if (matchedTemplate) {
          return rowFromExtraction(
            file.name,
            {
              ...result.data,
              invoice: { ...result.data.invoice, matched: resolvedFields },
            },
            state,
          );
        }

        if (resolvedFields.length === 0) {
          return rowFromExtraction(
            file.name,
            {
              ...result.data,
              invoice: { ...result.data.invoice, matched: resolvedFields },
            },
            state,
          );
        }

        const pdfBase64 =
          result.data.reviewPdfBase64 ??
          (await api.getDocumentPdfBase64(registered.documentId));
        setReview({
          file: file.name,
          documentId: registered.documentId,
          pdfBase64,
          extraction: result.data,
          fields: resolvedFields,
          templates,
        });
        return emptyRow(file.name, state);
      } catch {
        const error = internalError();
        setExtractionState("engine_error");
        return emptyRow(file.name, "engine_error", error);
      } finally {
        base64 = "";
      }
    },
    [api, store],
  );

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setProcessing(true);
      const out: Row[] = [];
      for (let i = 0; i < files.length; i += 1) {
        setProgress({ file: files[i].name, index: i + 1, total: files.length });
        try {
          out.push(await extractFile(files[i]));
        } catch {
          out.push(emptyRow(files[i].name, "engine_error", internalError()));
        }
      }
      setRows((prev) => [...prev, ...out]);
      setProgress(null);
      setProcessing(false);
    },
    [extractFile],
  );

  const processPaths = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    setExtractionState("native-path-unavailable");
    setNotice(
      "Extracción desde rutas de archivo no disponible en esta versión. Usá el selector de archivos.",
    );
  }, []);

  // Drag&drop NATIVO de Tauri: WebKit intercepta los archivos del sistema y no
  // los pasa al DOM; usamos el evento de la ventana (también con logs para debug).
  useEffect(() => {
    // getCurrentWindow() lanza SINCRÓNICAMENTE fuera del runtime de Tauri
    // (navegador/test). El try/catch permite que la app funcione igual
    // (sin drag nativo) en ese caso.
    try {
      let unlisten: (() => void) | undefined;
      getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            console.log("[nelupdf] drop nativo:", event.payload.paths);
            void processPaths(event.payload.paths);
          } else {
            console.log("[nelupdf] drag event:", event.payload.type);
          }
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((err) =>
          console.error(
            "[nelupdf] no se pudo registrar drag&drop nativo:",
            err,
          ),
        );
      return () => {
        unlisten?.();
      };
    } catch (err) {
      console.error(
        "[nelupdf] modo navegador (sin drag nativo):",
        String(err).slice(0, 80),
      );
    }
  }, [processPaths]);

  const requestLlmPreview = useCallback(async (row: Row) => {
    void row;
    setNotice("La extracción con IA no está disponible en esta versión.");
  }, []);

  const confirmLlm = useCallback(async () => {
    if (!preview) return;
    setLlmBusy(true);
    try {
      setNotice("La extracción con IA no está disponible en esta versión.");
    } finally {
      setLlmBusy(false);
      setPreview(null);
    }
  }, [preview]);

  const handleReviewEdit = useCallback(
    (field: MatchedField, newValue: string) => {
      setReview((prev) => {
        if (!prev) return prev;
        const updated = prev.fields.map((f) =>
          f.label === field.label ? { ...f, value: newValue } : f,
        );
        return { ...prev, fields: updated };
      });
    },
    [],
  );

  const handleReviewRectChange = useCallback(
    (field: MatchedField, newBbox: Bbox) => {
      setReview((prev) => {
        if (!prev) return prev;
        const updated = prev.fields.map((f) =>
          f.label === field.label ? { ...f, bbox: newBbox } : f,
        );
        return { ...prev, fields: updated };
      });
    },
    [],
  );

  const handleReviewConfirm = useCallback(
    (template: Template | null) => {
      setReview((r) => {
        if (!r) return r;
        if (template) {
          void store.save(template);
        }
        const updated: LocalExtractionV1 = {
          ...r.extraction,
          invoice: { ...r.extraction.invoice, matched: r.fields },
        };
        const state = stateForExtraction(updated);
        const row = rowFromExtraction(r.file, updated, state);
        setRows((prev) => [...prev, row]);
        return null;
      });
    },
    [store],
  );

  const handleReviewCancel = useCallback(() => {
    setReview(null);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>NeluPDF</h1>
        <p className="subtitle">
          Tus facturas en PDF → datos ordenados. Local-first: nada sale de tu
          máquina sin tu permiso.
        </p>
      </header>

      {/* Patrón del mercado: drop zone (Dext/Expensify) */}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
      />
      <button
        type="button"
        className={`dropzone ${dragOver ? "dropzone-active" : ""}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
      >
        <span className="dropzone-icon" aria-hidden="true">
          📄
        </span>
        <span className="dropzone-title">
          Arrastrá tus facturas acá, o hacé clic para elegirlas
        </span>
        <span className="dropzone-hint">
          PDF digitales o escaneados — soporta varias a la vez
        </span>
      </button>

      {progress && (
        <div className="progress">
          Procesando {progress.index}/{progress.total}: {progress.file} ({stateLabel(extractionState)})
        </div>
      )}

      {notice && (
        <div className="progress" role="status">
          {notice}
        </div>
      )}

      {extractionState !== "idle" && !progress && !notice && (
        <div className="progress" role="status">
          {stateLabel(extractionState)}
        </div>
      )}

      {review && (
        <div className="review-overlay-host">
          <VisualReview
            pdfBase64={review.pdfBase64}
            fields={review.fields}
            templates={review.templates}
            onConfirm={() => handleReviewConfirm(null)}
            onEdit={handleReviewEdit}
            onRectChange={handleReviewRectChange}
            onSaveTemplate={(tpl) => handleReviewConfirm(tpl)}
          />
          <button
            type="button"
            onClick={handleReviewCancel}
            className="review-overlay-close"
          >
            Cerrar revisión
          </button>
        </div>
      )}

      {/* Tabla de resultados: review-first (solo excepciones marcadas) */}
      {rows.length > 0 && (
        <div className="results">
          <div className="results-header">
            <h2>Resultados</h2>
            <button onClick={() => exportCsv(rows)} disabled={processing}>
              Exportar CSV
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Archivo</th>
                <th>Nº factura</th>
                <th>Fecha</th>
                <th>Subtotal</th>
                <th>Impuesto</th>
                <th>Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.file}
                  className={r.error ? "row-error" : r.total ? "" : "row-warn"}
                >
                  <td>{r.file}</td>
                  <td>{r.invoiceNumber}</td>
                  <td>{r.invoiceDate}</td>
                  <td>{r.subtotal}</td>
                  <td>
                    {r.tax} {r.taxLabel}
                  </td>
                  <td>{r.total}</td>
                   <td>
                     {r.error ? (
                       <span role="alert" className="row-error-group">
                         <span className="row-error-text">⚠ {errorMessage(r.error)}</span>
                         {retryAction(r.error.retry, r.file) && (
                           <button
                             onClick={retryAction(r.error.retry, r.file)!}
                             className="btn-retry"
                           >
                             {retryLabel(r.error.retry)}
                           </button>
                         )}
                       </span>
                     ) : r.state === "complete" || r.state === "truncated" ? (
                       `✔ ${stateLabel(r.state)}`
                     ) : r.state === "partial" ? (
                       stateLabel(r.state)
                     ) : (
                       <button
                         onClick={() => requestLlmPreview(r)}
                         disabled={llmBusy}
                         className="btn-ia"
                       >
                         Extraer con IA
                     </button>
                     )}
                   </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="results-footer">
            <button
              onClick={() => {
                setRows([]);
                setReview(null);
                void store.clear();
              }}
              disabled={processing || rows.length === 0}
            >
              Limpiar resultados
            </button>
            <a href="https://nelupdf.ar/docs/retention" target="_blank" rel="noopener">
              Política de retención
            </a>
          </div>
        </div>
      )}

      {/* Modal de preview de privacidad (transparencia informada — GDPR Art. 12) */}
      {preview && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Extraer con IA — {preview.provider}</h3>
            <pre className="notice">{preview.notice}</pre>
            <p className="modal-label">
              Así se verá lo que sale de tu máquina (pseudonimizado):
            </p>
            <pre className="sample">{preview.sample}</pre>
            <div className="modal-actions">
              <button onClick={() => setPreview(null)} disabled={llmBusy}>
                Cancelar
              </button>
              <button
                className="primary"
                onClick={confirmLlm}
                disabled={llmBusy}
              >
                {llmBusy ? "Extrayendo..." : "Confirmar y enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSV_COLUMNS = [
  "file",
  "invoiceNumber",
  "invoiceDate",
  "subtotal",
  "tax",
  "total",
  "taxLabel",
] as string[];

function exportCsv(rows: Row[]) {
  const csv = encodeCsv(rows, CSV_COLUMNS);
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "facturas.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function emptyRow(file: string, state: ExtractionState, error?: PublicError): Row {
  return {
    file,
    invoiceNumber: "",
    invoiceDate: "",
    simplifiedInvoiceDate: "",
    total: "",
    subtotal: "",
    tax: "",
    taxLabel: "",
    matched: [],
    state,
    error,
  };
}

function rowFromExtraction(
  file: string,
  result: LocalExtractionV1,
  state: ExtractionState,
): Row {
  const { invoice } = result;
  const merged = mergeFieldsIntoInvoice(invoice.invoiceNumber, invoice.invoiceDate, invoice.totals.subtotal, invoice.totals.tax, invoice.totals.total, invoice.taxLabel, result.invoice.matched);
  return {
    file,
    invoiceNumber: merged.invoiceNumber,
    invoiceDate: merged.invoiceDate,
    simplifiedInvoiceDate: invoice.simplifiedInvoiceDate ?? "",
    subtotal: merged.subtotal,
    tax: merged.tax,
    total: merged.total,
    taxLabel: merged.taxLabel,
    matched: merged.matched,
    state,
  };
}

function mergeFieldsIntoInvoice(
  invoiceNumber: string | null,
  invoiceDate: string | null,
  subtotal: string | null,
  tax: string | null,
  total: string | null,
  taxLabel: string | null,
  fields: MatchedField[],
): {
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: string;
  tax: string;
  total: string;
  taxLabel: string;
  matched: MatchedField[];
} {
  const find = (label: string): string | null =>
    fields.find((f) => f.label === label)?.value ?? null;
  return {
    invoiceNumber: find("invoiceNumber") ?? invoiceNumber ?? "",
    invoiceDate: find("invoiceDate") ?? invoiceDate ?? "",
    subtotal: find("subtotal") ?? subtotal ?? "",
    tax: find("tax") ?? tax ?? "",
    total: find("total") ?? total ?? "",
    taxLabel: find("taxLabel") ?? taxLabel ?? "",
    matched: fields,
  };
}

function stateForExtraction(result: LocalExtractionV1): ExtractionState {
  if (result.status === "partial") return "partial";
  if (result.status === "truncated") return "truncated";
  return "complete";
}

function stateForError(error: PublicError): ExtractionState {
  switch (error.code) {
    case "invalid_request":
    case "invalid_pdf":
    case "unauthorized_document":
      return "invalid-input";
    case "engine_unavailable":
      return "engine-unavailable";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "input_too_large":
    case "page_limit":
    case "response_too_large":
    case "capacity_exhausted":
    case "ocr_resource_limit":
      return "bounded-resource";
    default:
      return "engine_error";
  }
}

function errorMessage(error: PublicError): string {
  switch (error.code) {
    case "invalid_request":
    case "invalid_pdf":
    case "unauthorized_document":
      return "Archivo inválido o datos incorrectos";
    case "input_too_large":
      return "El PDF supera el límite de 12 MB";
    case "page_limit":
      return "El PDF supera el límite de 100 páginas";
    case "engine_unavailable":
      return "El motor de extracción no está disponible";
    case "engine_lost":
      return "Error de comunicación con el motor";
    case "protocol_mismatch":
      return "Error de protocolo inesperado";
    case "timeout":
      return "La extracción excedió el tiempo límite";
    case "cancelled":
      return "Extracción cancelada";
    case "internal":
      return "Error interno. Por favor, informá un bug.";
    default:
      return "No se pudo completar la extracción";
  }
}

function stateLabel(state: ExtractionState): string {
  switch (state) {
    case "registering":
      return "Registrando PDF...";
    case "ready":
      return "PDF listo para extraer";
    case "extracting":
      return "Extrayendo...";
    case "complete":
      return "Completa";
    case "truncated":
      return "Extracción limitada por recursos";
    case "partial":
      return "Parcial: requiere OCR, no disponible";
    case "cancelled":
    case "cancellation":
      return "Extracción cancelada";
    case "invalid-input":
      return "Archivo inválido o datos incorrectos";
    case "engine-unavailable":
      return "El motor de extracción no está disponible";
    case "timeout":
      return "La extracción excedió el tiempo límite";
    case "bounded-resource":
      return "Extracción limitada por recursos";
    case "engine_error":
      return "Error del motor de extracción";
    case "native-path-unavailable":
      return "Usá el selector de archivos";
    default:
      return "Listo";
  }
}

function internalError(): PublicError {
  return { code: "internal", messageKey: "internal", retry: "never" };
}

// Maps a RetryCategory to an actionable label (design WU-4C1: deliberate
// retry semantics — the user must choose to retry, never auto-retry on failure).
function retryLabel(retry: RetryCategory): string | null {
  switch (retry) {
    case "user_action":
      return "Reintentar extracción";
    case "new_transaction":
      return "Seleccionar otro archivo";
    case "restart_app":
      return "Reiniciar aplicación";
    default:
      return null;
  }
}

function retryAction(retry: RetryCategory, file: string): (() => void) | null {
  const label = retryLabel(retry);
  if (!label) return null;
  return () => {
    // Deliberate retry triggers the file-selection dialog again so the user
    // can re-select the file. We never auto-re-extract — the user must choose.
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    void file; // reserved for per-file retry UX in WU-2D
    input?.click();
  };
}

export default App;
