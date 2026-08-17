import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { Bbox, MatchedField, Template } from "../lib/types";

export const FIELD_COLORS: Record<string, string> = {
  invoice_number: "#3b82f6",
  invoice_date: "#22c55e",
  total: "#f59e0b",
  subtotal: "#ec4899",
  tax: "#8b5cf6",
  tax_label: "#f97316",
  default: "#6b7280",
};

export const FIELD_LABELS: Record<string, string> = {
  invoice_number: "Número de factura",
  invoice_date: "Fecha",
  total: "Total",
  subtotal: "Subtotal",
  tax: "Impuesto",
  tax_label: "Etiqueta impuesto",
};

export interface VisualReviewProps {
  pdfBase64: string;
  fields: MatchedField[];
  templates: Template[];
  onConfirm: () => void;
  onEdit: (field: MatchedField, newValue: string) => void;
  onRectChange: (field: MatchedField, newBbox: Bbox) => void;
  onSaveTemplate?: (template: Template) => void;
}

type DragState =
  | null
  | {
      kind: "move";
      fieldLabel: string;
      startPointerX: number;
      startPointerY: number;
      startBbox: Bbox;
    }
  | {
      kind: "resize";
      fieldLabel: string;
      handle: "se" | "sw" | "ne" | "nw";
      startPointerX: number;
      startPointerY: number;
      startBbox: Bbox;
    };

export function VisualReview(props: VisualReviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageWidth, setPageWidth] = useState(800);
  const [, setRendered] = useState(false);
  const [activeRect, setActiveRect] = useState<MatchedField | null>(null);
  const [draftValue, setDraftValue] = useState<string>("");
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [drag, setDrag] = useState<DragState>(null);

  useEffect(() => {
    let cancelled = false;
    setRendered(false);
    setActiveRect(null);
    setReviewed(new Set());

    if (!props.pdfBase64) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

        const bytes = Uint8Array.from(atob(props.pdfBase64), (c) =>
          c.charCodeAt(0),
        );
        const loadingTask = pdfjs.getDocument({
          data: bytes,
          disableAutoFetch: true,
          disableStream: true,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        if (cancelled) return;
        const targetWidth = 800;
        const viewport = page.getViewport({ scale: 1 });
        const scale = targetWidth / viewport.width;
        const scaled = page.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        setPageWidth(scaled.width);
        await page.render({ canvasContext: ctx, viewport: scaled }).promise;
        if (!cancelled) setRendered(true);
      } catch {
        if (!cancelled) setRendered(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.pdfBase64]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const dxPct = ((e.clientX - drag.startPointerX) / pageWidth) * 100;
      const dyPct = ((e.clientY - drag.startPointerY) / pageWidth) * 100;
      const start = drag.startBbox;
      if (drag.kind === "move") {
        const next: Bbox = {
          ...start,
          x: clamp(start.x + dxPct, 0, 100 - start.width),
          y: clamp(start.y + dyPct, 0, 100 - start.height),
        };
        props.onRectChange(
          { ...activeRectFor(props.fields, drag.fieldLabel), bbox: next },
          next,
        );
      } else {
        let { x, y, width, height } = start;
        if (drag.handle === "se") {
          width = clamp(start.width + dxPct, 1, 100 - x);
          height = clamp(start.height + dyPct, 1, 100 - y);
        } else if (drag.handle === "sw") {
          const newX = clamp(start.x + dxPct, 0, start.x + start.width - 1);
          width = start.x + start.width - newX;
          height = clamp(start.height + dyPct, 1, 100 - y);
          x = newX;
        } else if (drag.handle === "ne") {
          width = clamp(start.width + dxPct, 1, 100 - x);
          const newY = clamp(start.y + dyPct, 0, start.y + start.height - 1);
          height = start.y + start.height - newY;
          y = newY;
        } else if (drag.handle === "nw") {
          const newX = clamp(start.x + dxPct, 0, start.x + start.width - 1);
          const newY = clamp(start.y + dyPct, 0, start.y + start.height - 1);
          width = start.x + start.width - newX;
          height = start.y + start.height - newY;
          x = newX;
          y = newY;
        }
        const next: Bbox = { page: start.page, x, y, width, height };
        props.onRectChange(
          { ...activeRectFor(props.fields, drag.fieldLabel), bbox: next },
          next,
        );
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, pageWidth, props]);

  const allLabelTypes = useMemo(
    () => [
      "invoice_number",
      "invoice_date",
      "total",
      "subtotal",
      "tax",
      "tax_label",
    ],
    [],
  );

  const onRectClick = (f: MatchedField) => {
    setActiveRect(f);
    setDraftValue(f.value ?? "");
  };

  const commitDraft = () => {
    if (!activeRect) return;
    props.onEdit(activeRect, draftValue);
    setReviewed((prev) => {
      const next = new Set(prev);
      next.add(activeRect.label);
      return next;
    });
    setActiveRect(null);
  };

  const cancelDraft = () => setActiveRect(null);

  const confirmDisabled = reviewed.size === 0;

  const handleConfirm = () => {
    if (saveTemplate && props.onSaveTemplate) {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tpl-${Date.now()}`;
      props.onSaveTemplate({
        id,
        providerId: "default",
        fields: props.fields
          .filter((f) => f.bbox !== null)
          .map((f) => ({ label: f.label, bbox: f.bbox as Bbox })),
        createdAt: Date.now(),
      });
    }
    props.onConfirm();
  };

  return (
    <div className="visual-review" data-testid="visual-review">
      <div className="visual-review-top">
        <span className="visual-review-title">
          Factura: {props.templates.length > 0 ? "cargada" : "sin template"}
        </span>
        <span className="visual-review-page">
          Página 1 de 1
        </span>
      </div>

      <div
        className="visual-review-canvas"
        style={{ width: pageWidth, position: "relative" }}
        data-testid="canvas-wrapper"
      >
        <canvas
          ref={canvasRef}
          aria-label="Vista previa del PDF"
          data-testid="pdf-canvas"
        />
        <svg
          className="review-overlay"
          width={pageWidth}
          height={pageWidth * 1.4}
          viewBox="0 0 100 140"
          preserveAspectRatio="none"
          role="group"
          aria-label="Cajas de campos detectados"
          data-testid="svg-overlay"
        >
          {props.fields.map((f) => {
            if (!f.bbox) return null;
            const color = FIELD_COLORS[f.label] ?? FIELD_COLORS.default;
            const style: CSSProperties = {
              fill: "transparent",
              stroke: color,
              strokeWidth: 0.5,
            };
            return (
              <g key={f.label}>
                <rect
                  className="field-rect"
                  data-label={f.label}
                  x={f.bbox.x}
                  y={f.bbox.y}
                  width={f.bbox.width}
                  height={f.bbox.height}
                  style={style}
                  onClick={() => onRectClick(f)}
                  onMouseDown={(e) => {
                    if (!f.bbox) return;
                    setDrag({
                      kind: "move",
                      fieldLabel: f.label,
                      startPointerX: e.clientX,
                      startPointerY: e.clientY,
                      startBbox: f.bbox,
                    });
                    e.stopPropagation();
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${FIELD_LABELS[f.label] ?? f.label}: ${f.value ?? ""}`}
                />
                <rect
                  className="resize-handle"
                  data-handle="se"
                  x={f.bbox.x + f.bbox.width - 1.5}
                  y={f.bbox.y + f.bbox.height - 1.5}
                  width={3}
                  height={3}
                  style={{ fill: color, cursor: "nwse-resize" }}
                  onMouseDown={(e) => {
                    if (!f.bbox) return;
                    setDrag({
                      kind: "resize",
                      fieldLabel: f.label,
                      handle: "se",
                      startPointerX: e.clientX,
                      startPointerY: e.clientY,
                      startBbox: f.bbox,
                    });
                    e.stopPropagation();
                  }}
                />
              </g>
            );
          })}
        </svg>

        {activeRect && (
          <div
            className="inline-editor"
            role="dialog"
            aria-label="Editar campo"
            data-testid="inline-editor"
          >
            <label className="inline-editor-label">
              <strong>
                {FIELD_LABELS[activeRect.label] ?? activeRect.label}
              </strong>
            </label>
            <input
              type="text"
              value={draftValue}
              aria-label="Valor"
              onChange={(e) => setDraftValue(e.target.value)}
              data-testid="inline-editor-input"
            />
            <div className="inline-editor-actions">
              <button type="button" onClick={cancelDraft}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary"
                onClick={commitDraft}
                data-testid="inline-editor-confirm"
              >
                Correcto
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="visual-review-bottom">
        <ul className="color-legend" aria-label="Leyenda de colores">
          {allLabelTypes.map((label) => (
            <li key={label} className="legend-swatch">
              <span
                className="legend-color"
                style={{
                  backgroundColor:
                    FIELD_COLORS[label] ?? FIELD_COLORS.default,
                }}
                aria-hidden
              />
              <span className="legend-text">
                {FIELD_LABELS[label] ?? label}
              </span>
            </li>
          ))}
        </ul>

        <div className="visual-review-actions">
          <label className="save-template-toggle">
            <input
              type="checkbox"
              checked={saveTemplate}
              onChange={(e) => setSaveTemplate(e.target.checked)}
              aria-label="Guardar template para este proveedor"
              data-testid="save-template-checkbox"
            />
            Guardar template para este proveedor
          </label>

          <button
            type="button"
            onClick={() => props.onConfirm()}
            data-testid="cancel-button"
          >
            ✕ Cancelar
          </button>
          <button
            type="button"
            className="primary"
            disabled={confirmDisabled}
            onClick={handleConfirm}
            data-testid="confirm-button"
          >
            ✔ Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function activeRectFor(
  fields: MatchedField[],
  label: string,
): MatchedField {
  const f = fields.find((x) => x.label === label);
  return f ?? { label, value: null, bbox: null, editable: true };
}