//! "Big eye on screen": a borderless, always-on-top window covering the whole
//! primary monitor with Elise's eye in the middle. While it's on, summons are answered there instead of the corner
//! overlay, and Esc is grabbed globally so it can always be closed.

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::AppState;

pub const LABEL: &str = "stage";

pub fn is_on(app: &AppHandle) -> bool {
    app.state::<AppState>().stage_on.load(Ordering::SeqCst)
}

pub fn set(app: &AppHandle, on: bool) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let state = app.state::<AppState>();
    let was_on = state.stage_on.swap(on, Ordering::SeqCst);
    let gs = app.global_shortcut();
    if on && !was_on {
        let _ = gs.register("Escape");
    } else if !on && was_on {
        let _ = gs.unregister("Escape");
    }
    if on {
        // Whole monitor, taskbar included. Exits: global Esc, the Close button,
        // double-clicking the background, or the tray.
        if let Ok(Some(m)) = app.primary_monitor() {
            let _ = w.set_position(PhysicalPosition::new(m.position().x, m.position().y));
            let _ = w.set_size(PhysicalSize::new(m.size().width, m.size().height));
        }
        crate::webview::set_active(&w, true);
        let _ = app.emit_to(LABEL, "stage-visible", true);
        let _ = w.show();
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
    } else {
        let _ = app.emit_to(LABEL, "stage-visible", false);
        let _ = w.hide();
        crate::webview::set_active(&w, false);
    }
    let tray = state.tray.lock().unwrap();
    if let Some(t) = tray.as_ref() {
        t.sync_stage(on);
    }
}

/// Answer a summon on the big screen. Returns false when the stage is off.
pub fn summon(app: &AppHandle, source: &str) -> bool {
    if !is_on(app) {
        return false;
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        if source != "voice" {
            let _ = w.set_focus();
        }
    }
    let _ = app.emit_to(LABEL, "summon", source);
    true
}
