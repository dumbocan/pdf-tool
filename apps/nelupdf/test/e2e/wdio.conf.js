// WU-5A1-RED: WebDriverIO config skeleton.
// This file is intentionally minimal — the full pinned harness/dependencies
// belong in WU-5A1-GREEN. Running `npx wdio run test/e2e/wdio.conf.js`
// without a running WebDriverIO server + Tauri driver will fail (RED).
const { resolve } = require("node:path");

const appPath = resolve(__dirname, "../../src-tauri/target/debug/nelupdf");

exports.config = {
  runner: "sync",
  specs: [resolve(__dirname, "*.e2e.test.js")],
  capabilities: [
    {
      // RED: no real Tauri webdriver capability — to be wired in GREEN.
      browserName: "tauri",
      "tauri:options": {
        application: appPath,
      },
    },
  ],
  waitforTimeout: 15000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 0,
  logLevel: "error",
  bail: 0,
  outputDir: resolve(__dirname, "../../target/e2e"),
  // RED: no services configured — @tauri-apps/webdriver-io-plugin or
  // tawern-webdriverio not installed yet.
  services: [],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    require: ["@babel/register"],
  },
};
