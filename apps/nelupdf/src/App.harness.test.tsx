import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { run as axe } from "axe-core";
import { describe, expect, it, vi } from "vitest";

import App from "./App";

async function assertNoA11yViolations(container: HTMLElement) {
  const result = await axe(container);
  if (result.violations.length > 0) {
    throw new Error(result.violations.map(({ id }) => id).join(", "));
  }
}

describe("NeluPDF selection screen", () => {
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
});

describe("accessibility harness self-check (not App evidence)", () => {
  it("rejects a fixture button without an accessible name", async () => {
    const { container } = render(<button aria-label="" />);

    await expect(assertNoA11yViolations(container)).rejects.toThrow(
      /button-name/,
    );
  });
});
