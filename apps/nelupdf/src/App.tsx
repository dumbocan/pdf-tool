import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import {
  createTauriDesktopApi,
  type DesktopApi,
} from "./lib/desktop-api";
import { uuidv4 } from "./lib/uuid";

type Row = {
  file: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: string;
  subtotal: string;
  tax: string;
  taxLabel: string;
  error?: string;
};

type Progress = { file: string; index: number; total: number };

const desktopApi = createTauriDesktopApi();

type AppProps = { api?: DesktopApi };

function App({ api = desktopApi }: AppProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{
    row: Row;
    notice: string;
    sample: string;
    provider: string;
  } | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingSet = useRef<Set<string>>(new Set());

  const extractFile = useCallback(async (file: File): Promise<Row> => {
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    let base64 = btoa(binary);
    try {
      const requestId = uuidv4();
      const registered = await api.registerDocument({
        requestId,
        name: file.name,
        declaredBytes: buf.byteLength,
        pdfBase64: base64,
      });
      const result = await api.extractLocal({
        requestId: uuidv4(),
        documentId: registered.documentId,
      });
      if (!result.ok) {
        return {
          file: file.name,
          invoiceNumber: "",
          invoiceDate: "",
          total: "",
          subtotal: "",
          tax: "",
          taxLabel: "",
          error: result.error.messageKey,
        };
      }
      const { invoice } = result.data;
      return {
        file: file.name,
        invoiceNumber: invoice.invoiceNumber ?? "",
        invoiceDate: invoice.invoiceDate ?? "",
        subtotal: invoice.totals.subtotal ?? "",
        tax: invoice.totals.tax ?? "",
        total: invoice.totals.total ?? "",
        taxLabel: invoice.taxLabel ?? "",
      };
    } finally {
      base64 = "";
    }
  }, [api]);

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setProcessing(true);
      const out: Row[] = [];
      for (let i = 0; i < files.length; i += 1) {
        setProgress({ file: files[i].name, index: i + 1, total: files.length });
        try {
          out.push(await extractFile(files[i]));
        } catch (error) {
          out.push({
            file: files[i].name,
            invoiceNumber: "",
            invoiceDate: "",
            total: "",
            subtotal: "",
            tax: "",
            taxLabel: "",
            error: String(error),
          });
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
    // Dedupe: el drag&drop nativo de Tauri puede disparar 'drop' más de una vez
    // y/o junto al handler del DOM — nunca procesar el mismo path dos veces.
    const fresh = paths.filter((p) => !processingSet.current.has(p));
    if (fresh.length === 0) return;
    for (const p of fresh) processingSet.current.add(p);
    setProcessing(true);
    const out: Row[] = [];
    for (let i = 0; i < paths.length; i += 1) {
      setProgress({
        file: paths[i].split(/[\\/]/).pop() ?? paths[i],
        index: i + 1,
        total: paths.length,
      });
      try {
        out.push({
          file: paths[i].split(/[\\/]/).pop() ?? paths[i],
          invoiceNumber: "",
          invoiceDate: "",
          total: "",
          subtotal: "",
          tax: "",
          taxLabel: "",
          error: "La importación de rutas nativas no está disponible en esta versión.",
        });
      } catch (error) {
        out.push({
          file: paths[i],
          invoiceNumber: "",
          invoiceDate: "",
          total: "",
          subtotal: "",
          tax: "",
          taxLabel: "",
          error: String(error),
        });
      }
    }
    setRows((prev) => [...prev, ...out]);
    for (const p of fresh) processingSet.current.delete(p);
    setProgress(null);
    setProcessing(false);
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
    alert("La extracción con IA estará disponible en una versión futura.");
  }, []);

  const confirmLlm = useCallback(async () => {
    if (!preview) return;
    setLlmBusy(true);
    try {
      alert("La extracción con IA estará disponible en una versión futura.");
    } finally {
      setLlmBusy(false);
      setPreview(null);
    }
  }, [preview]);

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
          Procesando {progress.index}/{progress.total}: {progress.file}
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
                      `⚠ ${r.error}`
                    ) : r.total ? (
                      "✔"
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

function exportCsv(rows: Row[]) {
  const header =
    "archivo,invoiceNumber,invoiceDate,subtotal,tax,total,taxLabel\n";
  const body = rows
    .map((r) =>
      [
        r.file,
        r.invoiceNumber,
        r.invoiceDate,
        r.subtotal,
        r.tax,
        r.total,
        r.taxLabel,
      ]
        .map(csvCell)
        .join(","),
    )
    .join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "facturas.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvCell(v: string) {
  // CSV hardening (el motor ya lo hace; acá también): prevenir inyección de fórmulas
  const s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) return `"${s}"`;
  return s.includes(",") ? `"${s}"` : s;
}

export default App;
