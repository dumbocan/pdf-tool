import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VisualReview } from "./VisualReview";
import type { Bbox, MatchedField, Template } from "../lib/types";
import type { DesktopApi } from "../lib/desktop-api";

vi.mock("pdfjs-dist", () => {
  const renderStub = vi.fn(async () => ({ promise: Promise.resolve() }));
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: () =>
          Promise.resolve({
            getViewport: ({ width }: { width: number }) => ({
              width,
              height: width * 1.4,
            }),
            render: renderStub,
          }),
      }),
    }),
  };
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

const bbox = (overrides: Partial<Bbox> = {}): Bbox => ({
  page: 1,
  x: 10,
  y: 20,
  width: 30,
  height: 5,
  ...overrides,
});

const field = (overrides: Partial<MatchedField> = {}): MatchedField => ({
  label: "invoice_number",
  value: "A-1",
  bbox: bbox(),
  editable: true,
  ...overrides,
});

const noopApi: DesktopApi = {
  registerDocument: async () => ({
    documentId: "document-1",
    displayName: "invoice.pdf",
    byteLength: 4,
  }),
  extractLocal: async () => ({
    ok: true,
    protocolVersion: 1,
    requestId: "00000000-0000-4000-8000-000000000001",
    data: {
      provenance: "local_deterministic",
      documentSha256: "sha256",
      status: "complete",
      pagesProcessed: 1,
      truncationReason: null,
      extractionMode: "digital_text",
      invoice: {
        invoiceNumber: null,
        invoiceDate: null,
        simplifiedInvoiceDate: null,
        taxLabel: null,
        totals: { subtotal: null, tax: null, total: null },
        matched: [],
      },
      reviewPdfBase64: null,
      untrusted: true,
    },
  }),
  getDocumentPdfBase64: async () => "JVBERi0=",
};

function renderReview(
  overrides: Partial<{
    fields: MatchedField[];
    templates: Template[];
    onConfirm: () => void;
    onEdit: (field: MatchedField, newValue: string) => void;
    onRectChange: (field: MatchedField, newBbox: Bbox) => void;
    onSaveTemplate: (template: Template) => void;
  }> = {},
) {
  const props = {
    pdfBase64: "JVBERi0=",
    fields: [field()],
    templates: [],
    onConfirm: vi.fn(),
    onEdit: vi.fn(),
    onRectChange: vi.fn(),
    onSaveTemplate: vi.fn(),
    api: noopApi,
    ...overrides,
  };
  const result = render(<VisualReview {...props} />);
  return { ...result, props };
}

describe("VisualReview", () => {
  it("renders the PDF canvas and an SVG overlay rect per matched field", async () => {
    const fields = [
      field({ label: "invoice_number", value: "A-1", bbox: bbox({ x: 5, y: 5 }) }),
      field({ label: "total", value: "100", bbox: bbox({ x: 50, y: 60 }) }),
    ];

    const { container } = renderReview({ fields });

    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();

    const rects = container.querySelectorAll("svg.review-overlay rect.field-rect");
    expect(rects.length).toBe(2);
  });

  it("uses the field-type color for each rect (invoice_number → blue)", () => {
    const fields = [field({ label: "invoice_number", value: "A-1" })];

    const { container } = renderReview({ fields });

    const rect = container.querySelector(
      "svg.review-overlay rect.field-rect",
    ) as SVGElement | null;
    expect(rect).not.toBeNull();
    const style = rect!.getAttribute("style") ?? "";
    expect(style).toContain("#3b82f6");
  });

  it("opens an inline editor when a rect is clicked", async () => {
    const user = userEvent.setup();
    const fields = [field({ label: "invoice_number", value: "A-1" })];

    const { container } = renderReview({ fields });

    const rect = container.querySelector(
      "svg.review-overlay rect.field-rect",
    ) as HTMLElement;
    await user.click(rect);

    expect(screen.getByRole("textbox", { name: /valor/i })).toHaveValue("A-1");
  });

  it("calls onEdit when the inline editor value changes", async () => {
    const user = userEvent.setup();
    const fields = [field({ label: "invoice_number", value: "A-1" })];
    const onEdit = vi.fn();
    const { container } = renderReview({ fields, onEdit });

    const rect = container.querySelector(
      "svg.review-overlay rect.field-rect",
    ) as HTMLElement;
    await user.click(rect);

    const input = screen.getByRole("textbox", { name: /valor/i });
    await user.clear(input);
    await user.type(input, "A-2");

    await user.click(screen.getByRole("button", { name: /correcto/i }));

    expect(onEdit).toHaveBeenCalled();
    const lastCall = onEdit.mock.calls[onEdit.mock.calls.length - 1];
    expect(lastCall[0].label).toBe("invoice_number");
    expect(lastCall[1]).toBe("A-2");
  });

  it("calls onRectChange after dragging a resize handle", async () => {
    const fields = [field({ label: "invoice_number", bbox: bbox({ x: 10, y: 10, width: 20, height: 5 }) })];
    const onRectChange = vi.fn();
    const { container } = renderReview({ fields, onRectChange });

    const handle = container.querySelector(
      "svg.review-overlay rect.resize-handle",
    ) as HTMLElement;
    expect(handle).not.toBeNull();

    fireEvent.mouseDown(handle, { clientX: 50, clientY: 30, button: 0 });
    fireEvent.mouseMove(window, { clientX: 80, clientY: 30, button: 0 });
    fireEvent.mouseUp(window, { clientX: 80, clientY: 30, button: 0 });

    expect(onRectChange).toHaveBeenCalled();
    const [fieldArg, newBbox] = onRectChange.mock.calls[0];
    expect(fieldArg.label).toBe("invoice_number");
    expect(newBbox.width).toBeGreaterThan(20);
  });

  it("disables confirm until at least one field has been reviewed", async () => {
    const user = userEvent.setup();
    const fields = [field({ label: "invoice_number", value: "A-1" })];
    const onConfirm = vi.fn();
    const { container } = renderReview({ fields, onConfirm });

    const confirmBtn = screen.getByRole("button", { name: /confirmar/i });
    expect(confirmBtn).toBeDisabled();

    const rect = container.querySelector(
      "svg.review-overlay rect.field-rect",
    ) as HTMLElement;
    await user.click(rect);
    const input = screen.getByRole("textbox", { name: /valor/i });
    await user.clear(input);
    await user.type(input, "A-2");
    await user.click(screen.getByRole("button", { name: /correcto/i }));

    expect(confirmBtn).not.toBeDisabled();

    await user.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders the color legend with all field types", () => {
    const { container } = renderReview({ fields: [field()] });

    const legend = container.querySelector(".color-legend");
    expect(legend).toBeInTheDocument();

    const swatches = legend?.querySelectorAll(".legend-swatch") ?? [];
    expect(swatches.length).toBeGreaterThanOrEqual(6);

    expect(legend?.textContent ?? "").toMatch(/invoice_number|factura|número/i);
  });

  it("shows the save-template checkbox and lets the user toggle it", async () => {
    const user = userEvent.setup();
    const onSaveTemplate = vi.fn();

    renderReview({ onSaveTemplate });

    const checkbox = screen.getByRole("checkbox", {
      name: /guardar template|guardar como plantilla/i,
    });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});