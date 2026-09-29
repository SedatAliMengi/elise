//! The overlay window: a transparent, always-on-top window that hosts Elise's
//! eye in the corner of the screen. Three modes:
//!  - Hidden
//!  - Compact  (hover mode: just the small draggable eye)
//!  - Expanded (eye + speech bubble + command box / reminder card)

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::scheduler::ReminderPayload;
use crate::AppState;

pub const LABEL: &str = "overlay";
/// Logical sizes.
const COMPACT: (f64, f64) = (112.0, 112.0);
const EXPANDED: (f64, f64) = (480.0, 400.0);
const MARGIN: f64 = 12.0;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Hidden,
    Compact,
    Expanded,
}

fn win(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// (x, y, w, h, scale) of the work area of the monitor near `pt` (or primary).
fn work_area(app: &AppHandle, pt: Option<(i32, i32)>) -> (i32, i32, i32, i32, f64) {
    let mon = pt
        .and_then(|(x, y)| app.monitor_from_point(x as f64, y as f64).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    match mon {
        Some(m) => {
            let wa = m.work_area();
            (wa.position.x, wa.position.y, wa.size.width as i32, wa.size.height as i32, m.scale_factor())
        }
        None => (0, 0, 1920, 1040, 1.0),
    }
}

fn clamp(v: i32, lo: i32, hi: i32) -> i32 {
    v.max(lo).min(hi.max(lo))
}

pub fn mode(app: &AppHandle) -> Mode {
    *app.state::<AppState>().overlay_mode.lock().unwrap()
}

pub fn set_mode(app: &AppHandle, mode: Mode) {
    let Some(w) = win(app) else { return };
    let state = app.state::<AppState>();
    let (hover, hover_pos) = {
        let s = state.settings.lock().unwrap();
        (s.hover_mode, s.hover_pos)
    };
    *state.overlay_mode.lock().unwrap() = mode;

    if mode == Mode::Hidden {
        let _ = w.hide();
        crate::webview::set_active(&w, false);
        let _ = app.emit_to(LABEL, "overlay-mode", mode);
        return;
    }

    let (ax, ay, aw, ah, scale) = work_area(app, hover_pos);
    let margin = (MARGIN * scale) as i32;
    let (cw, ch) = ((COMPACT.0 * scale) as i32, (COMPACT.1 * scale) as i32);
    // Where the compact eye sits (top-left); defaults to the bottom-right corner.
    let (cx, cy) = hover_pos
        .filter(|_| hover)
        .map(|(x, y)| (clamp(x, ax, ax + aw - cw), clamp(y, ay, ay + ah - ch)))
        .unwrap_or((ax + aw - cw - margin, ay + ah - ch - margin));

    let (w_px, h_px, x, y) = match mode {
        Mode::Compact => (cw, ch, cx, cy),
        _ => {
            let (ew, eh) = ((EXPANDED.0 * scale) as i32, (EXPANDED.1 * scale) as i32);
            // Keep the eye where it is; the bubble opens up/left of it.
            let x = clamp(cx + cw - ew, ax, ax + aw - ew);
            let y = clamp(cy + ch - eh, ay, ay + ah - eh);
            (ew, eh, x, y)
        }
    };
    crate::webview::set_active(&w, true);
    state.ignore_moves.store(true, Ordering::SeqCst);
    let _ = w.set_size(PhysicalSize::new(w_px as u32, h_px as u32));
    let _ = w.set_position(PhysicalPosition::new(x, y));
    let _ = w.set_always_on_top(true);
    let _ = w.show();
    state.ignore_moves.store(false, Ordering::SeqCst);
    let _ = app.emit_to(LABEL, "overlay-mode", mode);
}

/// Mode to return to when Elise is done talking.
pub fn resting_mode(app: &AppHandle) -> Mode {
    if app.state::<AppState>().settings.lock().unwrap().hover_mode {
        Mode::Compact
    } else {
        Mode::Hidden
    }
}

pub fn summon(app: &AppHandle, source: &str) {
    set_mode(app, Mode::Expanded);
    if source != "voice" {
        if let Some(w) = win(app) {
            let _ = w.set_focus();
        }
    }
    let _ = app.emit_to(LABEL, "summon", source);
}

pub fn show_reminder(app: &AppHandle, payload: ReminderPayload) {
    app.state::<AppState>().pending_reminders.lock().unwrap().push(payload);
    if mode(app) != Mode::Expanded {
        set_mode(app, Mode::Expanded);
    }
    let _ = app.emit_to(LABEL, "reminder", ());
}

/// Called on window Moved events: remember where the hover eye was dragged.
pub fn on_moved(app: &AppHandle, pos: PhysicalPosition<i32>) {
    let state = app.state::<AppState>();
    if state.ignore_moves.load(Ordering::SeqCst) || mode(app) != Mode::Compact {
        return;
    }
    state.settings.lock().unwrap().hover_pos = Some((pos.x, pos.y));
    // Debounced save: only the last move of a drag writes to disk.
    let n = state.move_counter.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        let state = app.state::<AppState>();
        if state.move_counter.load(Ordering::SeqCst) == n {
            let s = state.settings.lock().unwrap().clone();
            let _ = crate::settings::save(&state.data_dir, &s);
        }
    });
}
