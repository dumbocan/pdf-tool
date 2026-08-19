# NeluPDF Linux Support Matrix (Draft)

> Tracked under WU-5D1. Matches `openspec/specs/linux-release/spec.md` Requirement: Explicit Platform Support Matrix.

## Qualified support matrix

The first supported release targets a single self-contained Linux matrix entry. Each
entry below is qualified by the evidence recorded in the CI gate (`tauri-binary-smoke`,
Rust tests, Node tests, frontend vitest). Anything **not** listed is **unsupported**.

| Distribution | Version | Architecture | Desktop | Display/Session | A11y baseline | OCR |
|---|---|---|---|---|---|---|
| Ubuntu | 24.04 LTS | x86-64 | GNOME 46 | Wayland (GNOME) + XWayland fallback | AT-SPI2 (Orca) | None (engine text-only) |

> **macOS, Windows, and unqualified Linux variants are NOT supported** by this release.
> Build configuration may contain cross-target entries; these do not constitute a support claim.

### Evidence per requirement (spec Scenario 1)

- **Self-contained package**: `cargo build --bin nelupdf` produces a single Rust binary that
  bundles the Node sidecar (`src/engine-stdio.js` declared as `bundle.resources` per WU-5A2-GREEN).
- **No manual server start**: engine runs as a stdio subprocess spawned by the Rust shell
  (`engine.rs:run_extraction` → `Command::new("node")`). No separate service, no loopback listener.
- **Deterministic extraction**: proven by `test/engine-stdio.test.js`, `test/engine-protocol.test.js`
  (78 Rust + 155 Node tests covering framing, hash binding, malformed response, and truncation).
- **CSP/least-privilege**: `tauri.conf.json` `csp: default-src 'none'; script-src 'self'; ...; connect-src 'self'`
  + `capabilities/default.json: core:default` only. No opener plugin. See WU-1G1/WU-5B2 tests.

### Display/session constraints

- The app is a Tauri GUI binary; it requires a display server. Under Wayland it runs under
  the `wlroots`/GNOME compositor with XWayland for webview fallback. Headless CI (no `xvfb`)
  cannot perform true E2E — see WU-5A1-RED/GRAY (tauri-cli EMFILE bug workaround via `cargo run`).
- `tauri build --debug --no-bundle` is blocked in this environment by a tauri-cli 2.11.4
  `notify` watcher EMFILE panic (see `docs/tauri-build-workaround.md`). Production packaging
  must run on a supported Linux builder with adequate inotify fd headroom.

### Accessibility baseline

- Keyboard: tab order covers legend/buttons. Field rects not yet keyboard-navigable (WU-2E).
- Screen reader: webview AT-SPI2 bridge present under GNOME; no dedicated screen-reader mode yet.

### OCR availability

- **None in this release.** NeluPDF extracts structured invoice text via `pdfjs-dist` (text layer)
  + Rust sidecar. No OCR engine (Tesseract) is bundled. Unsupported OCR remains "unavailable"
  via typed state (`extraction_state: "partial"` when no text layer exists). Packaging OCR
  is deferred to WU-5B1 (qualified OCR set required).

> **Rollback**: if packaging is not qualified, the development `cargo run` adapter remains;
> no unsupported platform/provider/legal claims are published.
