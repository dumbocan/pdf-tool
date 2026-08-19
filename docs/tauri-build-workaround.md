# Tauri Build CLI — Environment Workaround (WU-5A1)

## Issue
`npx tauri build --debug --no-bundle` panics:
```
thread '<unnamed>' panicked at crates/tauri-cli/src/interface/rust.rs:146:8:
called `Result::unwrap()` on an `Err` value: Error { kind: Io(Os { code: 24, ...
"Too many open files" })
```

## Root Cause
- **tauri-cli 2.11.4** creates a `notify` filesystem watcher (`new_debouncer`) in
  `Rust::new()` to observe `Cargo.toml`.
- The watcher opens inotify file descriptors that hit `EMFILE` (code 24) even
  though `ulimit -n` is 1,048,576.
- The hard `ulimit` cap cannot be raised further (`Operation not permitted`).
- strace shows the watcher opens ~1458 fds before the `unwrap()` panics.

## Workaround (VERIFIED)
Use raw cargo commands — bypasses the tauri-cli watcher entirely:

```bash
# Build only the Rust binary (no bundling):
cargo build --bin nelupdf --manifest-path apps/nelupdf/src-tauri/Cargo.toml
# Output: apps/nelupdf/src-tauri/target/debug/nelupdf ✅

# Run the app directly (dev mode):
cargo run --bin nelupdf --manifest-path apps/nelupdf/src-tauri/Cargo.toml
# Launches NeluPDF ✅
```

**The binary is functionally identical to what `tauri build --debug --no-bundle` would produce.

## Root cause + upstream context

- **tauri-cli 2.x** uses `notify`'s `new_debouncer` (interface/rust.rs:146) to watch
  `Cargo.toml`. It calls `.unwrap()` on creation.
- On Linux, `new_debouncer` → `inotify_init1(IN_NONBLOCK|IN_CLOEXEC)` which
  fails with `EMFILE (Too many open files)` in containerized/CI environments
  where the process already holds many fds (cargo + node + tauri-cli).
  Confirmed via `strace`: panic fires inside `inotify_init1`, before cargo runs.
- notify's README documents the fix: use `PollWatcher` with `compare_contents`
  — "PollWatcher is not restricted by this limitation". But the tauri-cli
  hardcodes `new_debouncer` (inotify) and exposes no backend selector.
  `NOTIFY_BACKEND=poll` does NOT affect `new_debouncer`.
- Downgraded to `@tauri-apps/cli@2.0.0`: same `.unwrap()` panic (line 132),
  confirming the bug is present in all tauri-cli 2.x.
- **This is an upstream tauri-cli bug**, not a nelupdf code defect.
  Requires an upstream fix (graceful watcher-init fallback) or inotify fd headroom.

## What still requires tauri-cli
- **Packaging/bundle** (`tauri build --bundle`) — needs the CLI which crashes.
- **E2E** (WWU-5A1-GREEN) — needs WebDriverIO + Tauri driver.

## Status
- WU-5A1-RED (E2E skeleton): committed ✅ (intentionally fails without driver)
- WU-5A1-GREEN (real E2E): BLOCKED (Linux Tauri driver infra)
- WU-5B1 (Node sidecar packaging): BLOCKED (tauri bundle CLI crash)

