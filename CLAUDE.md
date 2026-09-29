# Elise — personal calendar assistant (Windows)

Spec: `docs/PRD.md` (source of truth; milestones M0–M9 + status table at the end).
Tauri 2 (Rust) + React/TS/Vite. Single user ("Enigma"), local only.

## Layout
- `src-tauri/src/`
  - `model.rs` Event/Reminder/Recurrence. **Times are local naive** (`YYYY-MM-DDTHH:MM:SS`, no zone).
  - `recur.rs` recurrence expansion + reminder fire times (unit-tested).
  - `db.rs` SQLite (`%APPDATA%\com.enigma.elise\elise.db`); upsert returns a `Change` (before/after) for undo.
  - `events.rs` create/edit/remove with scope (this / following / all) for repeating events.
  - `scheduler.rs` reminder thread: sleeps until next due (≤60 s), woken by `notify_changed`.
  - `llm.rs` command engine: Claude Messages API via raw reqwest, model `claude-haiku-4-5`, client tools
    (create/update/delete/find_events, ask_clarification). Summary lines are built from real changes.
  - `overlay.rs` overlay window modes Hidden / Compact (hover eye) / Expanded; geometry in physical px.
  - `tray.rs`, `settings.rs` (JSON settings + API key in Windows Credential Manager via `keyring`).
  - `lib.rs` AppState, Tauri commands, setup.
- `src/` — `main.tsx` routes `?window=overlay` to `overlay/OverlayApp`, else `calendar/CalendarApp`.
  - `components/Eye.tsx` the eye (SVG + motion); states appearing/idle/listening/thinking/speaking/error/vanishing/closed.
  - `components/CommandPanel.tsx` bubble + input, used by both the overlay and the calendar title bar.
  - `lib/speech.ts` the only place that speaks (`speak()`), so voice output can be removed cleanly.

## Rules
- Hover position is owned by Rust (`on_moved`); `set_settings` ignores incoming `hoverPos`. Use `reset_hover_pos`.
- Don't put side effects inside React state updaters (no StrictMode on purpose: it double-speaks).
- Every mutation must go through `notify_changed` (refreshes windows + wakes scheduler).
- Never log or persist the API key anywhere except the keyring.
- Autostart only registers in release builds (`cfg!(debug_assertions)` guard).

## Verify
- Rust: `cd src-tauri && cargo test` (recurrence, reminders, undo, scoped edits, scheduler)
- TS: `npx tsc --noEmit`
- Run: `npm run tauri dev` · Build installer: `npm run tauri build` (NSIS, `src-tauri/target/release/bundle/nsis/`)
- Icons: `node scripts/make-icons.mjs` (renders the eye → `tauri icon`)
- Dev gotcha: after a Rust hot-rebuild the window can stay black (WebView2 didn't start). Kill `elise.exe`
  and rerun `npm run tauri dev`.
- WebView2 never reports hidden windows via `document.hidden`; the backend emits `main-visible` and
  suspends the hidden calendar (`webview.rs`). Don't rely on the Page Visibility API.
