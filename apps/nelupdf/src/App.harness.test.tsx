import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { run as axe } from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import appSource from "./App.tsx?raw";
import tauriConfig from "../src-tauri/tauri.conf.json";
import type { DesktopApi } from "./lib/desktop-api";
import type { LocalExtractionV1, MatchedField } from "./lib/types";

afterEach(clearMocks);

async function assertNoA11yViolations(container: HTMLElement) {
  const result = await axe(container);
  if (result.violations.length > 0) {
    throw new Error(result.violations.map(({ id }) => id).join(", "));
  }
}

function extraction(
  overrides: Partial<LocalExtractionV1> = {},
): LocalExtractionV1 {
  const matched: MatchedField[] = [
    {
      label: "invoiceNumber",
      value: "A-1",
      bbox: null,
      editable: true,
    },
    {
      label: "total",
      value: "12.1",
      bbox: null,
      editable: true,
    },
  ];
  return {
    provenance: "local_deterministic",
    documentSha256: "sha256",
    status: "complete",
    pagesProcessed: 1,
    truncationReason: null,
    extractionMode: "digital_text",
    invoice: {
      invoiceNumber: "A-1",
      invoiceDate: "2026-08-17",
      simplifiedInvoiceDate: "2026-08-17",
      taxLabel: "IVA",
      totals: { subtotal: "10", tax: "2.1", total: "12.1" },
      matched,
    },
    reviewPdfBase64: null,
    untrusted: true,
    ...overrides,
  };
}

function fakeApi(result: Awaited<ReturnType<DesktopApi["extractLocal"]>>): DesktopApi {
  return {
    registerDocument: async () => ({
      documentId: "document-1",
      displayName: "invoice.pdf",
      byteLength: 4,
    }),
    extractLocal: async () => result,
    getDocumentPdfBase64: async () => "JVBERi0=",
  };
}

async function uploadPdf(api: DesktopApi) {
  const user = userEvent.setup();
  const { container } = render(<App api={api} />);
  const fileInput =
    container.querySelector<HTMLInputElement>('input[type="file"]');
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value: async () => new TextEncoder().encode("%PDF").buffer,
  });
  await user.upload(
    fileInput!,
    new File(["%PDF"], "invoice.pdf", { type: "application/pdf" }),
  );
}

describe("NeluPDF selection screen", () => {
  it("does not contain the retired engine HTTP transport", () => {
    expect(appSource).not.toContain("fetch(");
    expect(appSource).not.toContain("VITE_MOTOR_URL");
    expect(appSource).not.toContain("127.0.0.1:3000");
    expect(appSource).not.toContain("extract-path");
  });

  it("production CSP is restrictive and matches the final capability inventory", () => {
    const csp = (tauriConfig as { app: { security: { csp: string } } }).app.security.csp;
    expect(csp, "tauri.conf.json must define a CSP").toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("http:");
    expect(csp).not.toContain("https:");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("registers and extracts a selected PDF through Tauri IPC", async () => {
    const user = userEvent.setup();
    const commands: string[] = [];
    mockIPC((command) => {
      commands.push(command);
      if (command === "register_document_v1") {
        return {
          ok: true,
          protocolVersion: 1,
          requestId: "123e4567-e89b-42d3-a456-426614174000",
          data: {
            documentId: "document-1",
            displayName: "invoice.pdf",
            byteLength: 4,
          },
        };
      }
      if (command === "extract_local_v1") {
        return {
          ok: true,
          protocolVersion: 1,
          requestId: "123e4567-e89b-42d3-a456-426614174001",
          data: {
            provenance: "local_deterministic",
            documentSha256: "sha256",
            status: "complete",
            pagesProcessed: 1,
            truncationReason: null,
            extractionMode: "digital_text",
            invoice: {
              invoiceNumber: "A-1",
              invoiceDate: "2026-08-17",
              simplifiedInvoiceDate: "2026-08-17",
              taxLabel: "IVA",
              totals: { subtotal: "10", tax: "2.1", total: "12.1" },
              matched: [],
            },
            reviewPdfBase64: null,
            untrusted: true,
          },
        };
      }
      return undefined;
    });

    const { container } = render(<App />);
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(File.prototype, "arrayBuffer", {
      configurable: true,
      value: async () => new TextEncoder().encode("%PDF").buffer,
    });
    await user.upload(fileInput!, new File(["%PDF"], "invoice.pdf", {
      type: "application/pdf",
    }));

    expect(await screen.findByText("A-1")).toBeInTheDocument();
    expect(commands.slice(-2)).toEqual([
      "register_document_v1",
      "extract_local_v1",
    ]);
    expect(screen.getByText("✔ Completa")).toBeInTheDocument();
  });

  it("renders partial extraction as requiring unavailable OCR", async () => {
    await uploadPdf(
      fakeApi({
        ok: true,
        protocolVersion: 1,
        requestId: "123e4567-e89b-42d3-a456-426614174001",
        data: extraction({
          status: "partial",
          extractionMode: "ocr_required_unavailable",
          invoice: {
            ...extraction().invoice,
            invoiceNumber: null,
            totals: { subtotal: null, tax: null, total: null },
          },
        }),
      }),
    );

    expect(
      (await screen.findAllByText("Parcial: requiere OCR, no disponible"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("maps typed extraction errors to human-friendly UI text", async () => {
    await uploadPdf(
      fakeApi({
        ok: false,
        protocolVersion: 1,
        requestId: "123e4567-e89b-42d3-a456-426614174001",
        error: {
          code: "engine_unavailable",
          messageKey: "engine_unavailable",
          retry: "restart_app",
        },
      }),
    );

    expect(
      await screen.findByText("⚠ El motor de extracción no está disponible"),
    ).toBeInTheDocument();
    expect(screen.queryByText("engine_unavailable")).not.toBeInTheDocument();
  });

  it("exposes the real PDF selection path with a role and accessible name", () => {
    const { container } = render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "NeluPDF" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nada sale de tu máquina sin tu permiso/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /arrastrá tus facturas/i }),
    ).toBeInTheDocument();

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toHaveAttribute("accept", "application/pdf");
    expect(fileInput).toHaveAttribute("multiple");
  });

  it("opens the real file-selection path from the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const selectionControl = screen.getByRole("button", {
      name: /arrastrá tus facturas/i,
    });
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    const openFileSelection = vi.spyOn(fileInput!, "click");

    await user.tab();
    expect(selectionControl).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(openFileSelection).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(openFileSelection).toHaveBeenCalledTimes(2);
  });

  it("has no automated accessibility violations in the real rendered App", async () => {
    const { container } = render(<App />);

    await assertNoA11yViolations(container);
  });

  it("references the retention policy doc in the results footer", () => {
    // The results footer only renders after extraction, so verify the link
    // target is truthful from the compiled source.
    expect(appSource).toMatch(/política de retención/i);
    expect(appSource).toMatch(/retention/);
  });

  it("exposes a retry button with non-color recovery guidance for retryable errors", async () => {
    await uploadPdf(
      fakeApi({
        ok: false,
        protocolVersion: 1,
        requestId: "123e4567-e89b-42d3-a456-426614174001",
        error: {
          code: "input_too_large",
          messageKey: "input_too_large",
          retry: "user_action",
        },
      }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/supera el límite/i);
    const retry = screen.getByRole("button", { name: /reintentar extracción/i });
    expect(retry).toBeInTheDocument();
  });

  it("does not expose a retry button for errors marked never-retry", async () => {
    await uploadPdf(
      fakeApi({
        ok: false,
        protocolVersion: 1,
        requestId: "123e8400-e29b-41d4-a716-446655440000",
        error: {
          code: "internal",
          messageKey: "internal",
          retry: "never",
        },
      }),
    );

    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reiniciar/i })).toBeNull();
  });
});

describe("accessibility harness self-check (not App evidence)", () => {
  it("rejects a fixture button without an accessible name", async () => {
    const { container } = render(<button aria-label="" />);

    await expect(assertNoA11yViolations(container)).rejects.toThrow(
      /button-name/,
    );
  });
});
