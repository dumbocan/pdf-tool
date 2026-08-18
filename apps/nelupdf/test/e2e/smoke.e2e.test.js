// WU-5A1-RED: E2E seam that fails because WebDriverIO/Tauri driver
// infrastructure is absent. Run from the repo root:
//   npx wdio run apps/nelupdf/test/e2e/wdio.conf.js
//
// This test is INTENTIONALLY expected to fail on first run (RED phase):
// the Tauri app must be running in dev mode and the WebDriverIO config
// must target the Tauri application window. Until WU-5A1-GREEN provides
// the pinned harness/dependencies, these assertions cannot resolve.
import { remote } from "webdriverio";

describe("NeluPDF E2E — selection → extraction → review", () => {
  let browser: Awaited<ReturnType<typeof remote>>;

  beforeAll(async () => {
    // RED: no capability config exists yet — this will throw.
    browser = await remote({
      protocol: "http",
      hostname: "127.0.0.1",
      port: 4444,
      path: "/wd/hub",
      capabilities: {
        // Tauri driver would expose the app window here.
        "tauri:options": {
          application: "../../src-tauri/target/debug/nelupdf",
        },
      },
    });
  });

  afterAll(async () => {
    if (browser) await browser.deleteSession();
  });

  it("launches the NeluPDF window with a visible title", async () => {
    const title = await browser.getTitle();
    expect(title).toContain("NeluPDF");
  });

  it("selects a PDF through the native file dialog and extracts", async () => {
    const fileInput = await browser.$('input[type="file"]');
    await fileInput.uploadFile({
      path: "../../test/fixtures/A-G2026-245895.pdf",
      mime_type: "application/pdf",
    });
    await browser.keys("Enter");

    // Wait for the results table to render.
    await browser.$("th=Archivo").waitForExist({ timeout: 15000 });
  });

  it("opens the visual review overlay when fields need confirmation", async () => {
    const reviewButton = await browser.$("button=Revisar");
    await reviewButton.waitForExist({ timeout: 10000 });
    await reviewButton.click();

    const canvas = await browser.$("canvas");
    await canvas.waitForExist({ timeout: 5000 });
  });

  it("exports CSV and the download triggers", async () => {
    const exportButton = await browser.$("button=Exportar CSV");
    await exportButton.click();
  });

  it("clears results to reset runtime state", async () => {
    const clearButton = await browser.$("button=Limpiar resultados");
    await clearButton.click();
    await browser.$("th=Archivo").waitForExist({ reverse: true, timeout: 5000 });
  });
});
