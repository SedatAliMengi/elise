use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::settings::Settings;
use crate::AppState;

pub struct TrayChecks {
    hover: CheckMenuItem<Wry>,
    wake: CheckMenuItem<Wry>,
    voice: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

impl TrayChecks {
    pub fn sync(&self, s: &Settings) {
        let _ = self.hover.set_checked(s.hover_mode);
        let _ = self.wake.set_checked(s.wake_word);
        let _ = self.voice.set_checked(s.voice_responses);
        let _ = self.autostart.set_checked(s.autostart);
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<TrayChecks> {
    let s = app.state::<AppState>().settings.lock().unwrap().clone();
    let summon = MenuItem::with_id(app, "summon", "Summon Elise", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Calendar", true, None::<&str>)?;
    let hover = CheckMenuItem::with_id(app, "hover", "Hover on screen", true, s.hover_mode, None::<&str>)?;
    let wake = CheckMenuItem::with_id(app, "wake", "Listen for \"Hey Elise\"", true, s.wake_word, None::<&str>)?;
    let voice = CheckMenuItem::with_id(app, "voice", "Voice responses", true, s.voice_responses, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, s.autostart, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Elise", true, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[&summon, &open, &sep()?, &hover, &wake, &voice, &autostart, &sep()?, &settings, &quit],
    )?;

    TrayIconBuilder::with_id("elise")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Elise")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "summon" => crate::overlay::summon(app, "tray"),
            "open" => crate::show_main(app, false),
            "settings" => crate::show_main(app, true),
            "quit" => app.exit(0),
            id @ ("hover" | "wake" | "voice" | "autostart") => {
                let mut s = app.state::<AppState>().settings.lock().unwrap().clone();
                match id {
                    "hover" => s.hover_mode = !s.hover_mode,
                    "wake" => s.wake_word = !s.wake_word,
                    "voice" => s.voice_responses = !s.voice_responses,
                    _ => s.autostart = !s.autostart,
                }
                let _ = crate::apply_settings(app, s);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                crate::show_main(tray.app_handle(), false);
            }
        })
        .build(app)?;

    Ok(TrayChecks { hover, wake, voice, autostart })
}
