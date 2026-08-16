import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

// Motor de extracción: el proceso Node de NeluPDF (server local del motor).
// En dev corre en 127.0.0.1:3000; configurable con VITE_MOTOR_URL.
const MOTOR_URL =
  (import.meta.env.VITE_MOTOR_URL as string) ?? "http://127.0.0.1:3000";

type Row = {
  file: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: string;
  subtotal: string;
  tax: string;
  taxLabel: string;
  data?: string; // base64 (filas del diálogo; el webview no puede leer rutas locales)
  error?: string;
};

type Progress = { file: string; index: number; total: number };

function App() {
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
    const base64 = btoa(binary);
    const res = await fetch(`${MOTOR_URL}/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: base64, name: file.name }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        file: file.name,
        invoiceNumber: "",
        invoiceDate: "",
        total: "",
        subtotal: "",
        tax: "",
        taxLabel: "",
        data: base64,
        error: `HTTP ${res.status} ${detail.slice(0, 80)}`,
      };
    }
    const payload = await res.json();
    const f = payload.invoiceFields ?? {};
    const t = f.totals ?? {};
    return {
      file: file.name,
      invoiceNumber: f.invoiceNumber ?? "",
      invoiceDate: f.invoiceDate ?? "",
      subtotal: t.subtotal ?? "",
      tax: t.tax ?? "",
      total: t.total ?? "",
      taxLabel: f.taxLabel ?? "",
      data: base64,
    };
  }, []);

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
        // Los paths del drag&drop nativo los lee el MOTOR local (el webview no
        // puede acceder a rutas del sistema).
        const res = await fetch(`${MOTOR_URL}/extract-path`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: paths[i] }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          out.push({
            file: paths[i],
            invoiceNumber: "",
            invoiceDate: "",
            total: "",
            subtotal: "",
            tax: "",
            taxLabel: "",
            error: `HTTP ${res.status} ${detail.slice(0, 80)}`,
          });
          continue;
        }
        const payload = await res.json();
        const f = payload.invoiceFields ?? {};
        const t = f.totals ?? {};
        out.push({
          file: paths[i].split(/[\\/]/).pop() ?? paths[i],
          invoiceNumber: f.invoiceNumber ?? "",
          invoiceDate: f.invoiceDate ?? "",
          subtotal: t.subtotal ?? "",
          tax: t.tax ?? "",
          total: t.total ?? "",
          taxLabel: f.taxLabel ?? "",
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
    // Las filas viejas (creadas con versiones anteriores) pueden no tener ni
    // path ni data: avisar claro en vez de enviar una petición vacía (400).
    if (!row.file.startsWith("/") && !row.data) {
      alert(
        "Esta fila se añadió con una versión anterior de la app. Recargá la app (F5) y volvé a añadir la factura para poder usar la IA.",
      );
      return;
    }
    setLlmBusy(true);
    try {
      // Las filas del drag&drop nativo tienen path absoluto; las del diálogo
      // solo nombre + base64 (data). El motor acepta ambos.
      const isPath = row.file.startsWith("/");
      const res = await fetch(`${MOTOR_URL}/llm-preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isPath ? { path: row.file } : { data: row.data }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        alert(`Preview falló (HTTP ${res.status}): ${detail.slice(0, 120)}`);
        return;
      }
      const payload = await res.json();
      setPreview({
        row,
        notice: payload.notice,
        sample: payload.pseudonymizedSample,
        provider: `${payload.provider.name} (${payload.provider.model})`,
      });
    } catch (error) {
      alert(`Preview falló: ${String(error)}`);
    } finally {
      setLlmBusy(false);
    }
  }, []);

  const confirmLlm = useCallback(async () => {
    if (!preview) return;
    setLlmBusy(true);
    try {
      const isPath = preview.row.file.startsWith("/");
      const res = await fetch(`${MOTOR_URL}/extract-with-llm-privacy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isPath ? { path: preview.row.file } : { data: preview.row.data },
        ),
      });
      const payload = await res.json();
      if (!res.ok || !payload.ok) {
        alert(
          `Extracción con IA falló: ${payload.error ?? `HTTP ${res.status}`}`,
        );
        return;
      }
      const f = payload.fields ?? {};
      const t = f.totals ?? {};
      setRows((prev) =>
        prev.map((r) =>
          r.file === preview.row.file
            ? {
                ...r,
                invoiceNumber: f.invoiceNumber ?? r.invoiceNumber,
                invoiceDate: f.invoiceDate ?? r.invoiceDate,
                subtotal: t.subtotal ?? r.subtotal,
                tax: t.tax ?? r.tax,
                total: t.total ?? r.total,
                taxLabel: f.taxLabel ?? r.taxLabel,
                error: undefined,
              }
            : r,
        ),
      );
    } catch (error) {
      alert(`Extracción con IA falló: ${String(error)}`);
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
