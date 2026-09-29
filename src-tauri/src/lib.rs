mod db;
mod events;
mod llm;
mod model;
mod overlay;
mod recur;
mod scheduler;
mod settings;
mod tray;
mod voice;
mod webview;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::mpsc::Sender;
use std::sync::Mutex;

use chrono::NaiveDateTime;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

use db::Db;
use events::Scope;
use model::{Event, Occurrence};
use overlay::Mode;
use scheduler::ReminderPayload;
use settings::Settings;

pub struct AppState {
    pub db: Mutex<Db>,
    pub settings: Mutex<Settings>,
    pub data_dir: PathBuf,
    pub sched: Mutex<Option<Sender<()>>>,
    pub overlay_mode: Mutex<Mode>,
    pub pending_reminders: Mutex<Vec<ReminderPayload>>,
    pub tray: Mutex<Option<tray::TrayChecks>>,
    pub sessions: Mutex<HashMap<String, llm::Session>>,
    pub move_counter: AtomicU64,
    pub ignore_moves: AtomicBool,
}

type CmdResult<T> = Result<T, String>;

/// Tell every window that events changed and wake the scheduler.
pub fn notify_changed(app: &AppHandle) {
    let _ = app.emit("events-changed", ());
    if let Some(tx) = app.state::<AppState>().sched.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

pub fn show_main(app: &AppHandle, open_settings: bool) {
    if let Some(w) = app.get_webview_window("main") {
        webview::set_active(&w, true);
        let _ = app.emit_to("main", "main-visible", true);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if open_settings {
            let _ = app.emit_to("main", "open-settings", ());
        }
    }
}

/// Hide the calendar to the tray. The page is told so it can stop all
/// rendering (WebView2 doesn't report hidden windows as hidden).
pub fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = app.emit_to("main", "main-visible", false);
        let _ = w.hide();
        webview::set_active(&w, false);
    }
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> CmdResult<()> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if hotkey.trim().is_empty() {
        return Ok(());
    }
    gs.register(hotkey).map_err(|e| format!("Couldn't register hotkey \"{hotkey}\": {e}"))
}

fn apply_autostart(app: &AppHandle, on: bool) {
    // Only the installed (release) build registers itself with Windows.
    if cfg!(debug_assertions) {
        return;
    }
    let al = app.autolaunch();
    let _ = if on { al.enable() } else { al.disable() };
}

/// Persist settings and apply their side effects everywhere.
pub fn apply_settings(app: &AppHandle, next: Settings) -> CmdResult<Settings> {
    let state = app.state::<AppState>();
    let prev = state.settings.lock().unwrap().clone();
    let mut next = next;
    // The hover position is owned by the backend (drags); windows may hold a stale copy.
    next.hover_pos = prev.hover_pos;
    *state.settings.lock().unwrap() = next.clone();
    settings::save(&state.data_dir, &next)?;

    if prev.hotkey != next.hotkey {
        if let Err(e) = register_hotkey(app, &next.hotkey) {
            let _ = register_hotkey(app, &prev.hotkey);
            state.settings.lock().unwrap().hotkey = prev.hotkey.clone();
            return Err(e);
        }
    }
    if prev.autostart != next.autostart {
        apply_autostart(app, next.autostart);
    }
    if prev.hover_mode != next.hover_mode && overlay::mode(app) != Mode::Expanded {
        overlay::set_mode(app, overlay::resting_mode(app));
    }
    if prev.wake_word != next.wake_word {
        voice::set_wake(app, next.wake_word);
    }
    if prev.default_reminder_time != next.default_reminder_time {
        notify_changed(app);
    }
    if let Some(t) = state.tray.lock().unwrap().as_ref() {
        t.sync(&next);
    }
    let _ = app.emit("settings-changed", &next);
    Ok(next)
}

// ---------------- commands: calendar ----------------

#[tauri::command]
fn list_occurrences(state: tauri::State<AppState>, from: NaiveDateTime, to: NaiveDateTime) -> CmdResult<Vec<Occurrence>> {
    events::list_occurrences(&state.db.lock().unwrap(), from, to)
}

#[tauri::command]
fn get_event(state: tauri::State<AppState>, id: String) -> CmdResult<Option<Event>> {
    state.db.lock().unwrap().get_event(&id)
}

#[tauri::command]
fn create_event(app: AppHandle, state: tauri::State<AppState>, event: Event) -> CmdResult<Event> {
    let (ev, _) = events::create(&mut state.db.lock().unwrap(), event)?;
    notify_changed(&app);
    Ok(ev)
}

#[tauri::command]
fn update_event(
    app: AppHandle,
    state: tauri::State<AppState>,
    id: String,
    occ_start: Option<NaiveDateTime>,
    scope: Option<Scope>,
    event: Event,
) -> CmdResult<Event> {
    let (ev, _) = events::edit(&mut state.db.lock().unwrap(), &id, occ_start, scope.unwrap_or_default(), event)?;
    notify_changed(&app);
    Ok(ev)
}

#[tauri::command]
fn delete_event(app: AppHandle, state: tauri::State<AppState>, id: String, occ_start: Option<NaiveDateTime>, scope: Option<Scope>) -> CmdResult<()> {
    events::remove(&mut state.db.lock().unwrap(), &id, occ_start, scope.unwrap_or_default())?;
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
fn search_events(state: tauri::State<AppState>, query: String) -> CmdResult<Vec<Event>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    state.db.lock().unwrap().search(&query, 50)
}

// ---------------- commands: assistant ----------------

#[tauri::command]
async fn run_command(app: AppHandle, session_id: String, text: String) -> CmdResult<llm::CommandResult> {
    Ok(llm::run(&app, &session_id, text.trim()).await)
}

#[tauri::command]
fn cancel_session(state: tauri::State<AppState>, session_id: String) {
    state.sessions.lock().unwrap().remove(&session_id);
}

#[tauri::command]
fn undo_command(app: AppHandle, state: tauri::State<AppState>, id: String) -> CmdResult<()> {
    state.db.lock().unwrap().undo_command(&id)?;
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
fn last_command(state: tauri::State<AppState>) -> CmdResult<Option<(String, String)>> {
    state.db.lock().unwrap().last_undoable_command()
}

// ---------------- commands: settings ----------------

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings) -> CmdResult<Settings> {
    apply_settings(&app, settings)
}

#[tauri::command]
fn reset_hover_pos(app: AppHandle, state: tauri::State<AppState>) -> CmdResult<()> {
    let s = {
        let mut s = state.settings.lock().unwrap();
        s.hover_pos = None;
        s.clone()
    };
    settings::save(&state.data_dir, &s)?;
    if s.hover_mode && overlay::mode(&app) == Mode::Compact {
        overlay::set_mode(&app, Mode::Compact);
    }
    Ok(())
}

#[tauri::command]
fn has_api_key() -> bool {
    settings::get_api_key().is_some()
}

#[tauri::command]
fn set_api_key(key: String) -> CmdResult<()> {
    settings::set_api_key(&key)
}

#[tauri::command]
async fn test_api_key() -> CmdResult<()> {
    let key = settings::get_api_key().ok_or("No API key saved yet.")?;
    llm::test_key(&key).await
}

// ---------------- commands: overlay ----------------

#[tauri::command]
fn summon(app: AppHandle, source: String) {
    overlay::summon(&app, &source);
}

#[tauri::command]
fn overlay_get_mode(app: AppHandle) -> Mode {
    overlay::mode(&app)
}

#[tauri::command]
fn overlay_expand(app: AppHandle) {
    overlay::set_mode(&app, Mode::Expanded);
    if let Some(w) = app.get_webview_window(overlay::LABEL) {
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn overlay_done(app: AppHandle) {
    overlay::set_mode(&app, overlay::resting_mode(&app));
}

#[tauri::command]
fn take_reminders(state: tauri::State<AppState>) -> Vec<ReminderPayload> {
    std::mem::take(&mut *state.pending_reminders.lock().unwrap())
}

#[tauri::command]
fn reminder_action(
    app: AppHandle,
    state: tauri::State<AppState>,
    reminder_id: String,
    occ_key: String,
    action: String,
    minutes: Option<i64>,
) -> CmdResult<()> {
    let db = state.db.lock().unwrap();
    match action.as_str() {
        "snooze" => {
            let until = db::now() + chrono::Duration::minutes(minutes.unwrap_or(10).max(1));
            db.set_log(&reminder_id, &occ_key, "snoozed", Some(until))?;
        }
        _ => db.set_log(&reminder_id, &occ_key, "dismissed", None)?,
    }
    drop(db);
    notify_changed(&app);
    Ok(())
}

/// Reminder wasn't acknowledged on screen: leave a Windows notification.
#[tauri::command]
fn reminder_toast(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

// ---------------- commands: voice ----------------

#[tauri::command]
fn voice_listen(app: AppHandle, window: tauri::Window) {
    voice::listen(&app, window.label());
}

#[tauri::command]
fn voice_cancel(app: AppHandle) {
    voice::cancel(&app);
}

#[tauri::command]
fn voice_status(app: AppHandle) -> voice::VoiceStatus {
    voice::status(&app)
}

#[tauri::command]
fn show_calendar(app: AppHandle, settings: Option<bool>) {
    show_main(&app, settings.unwrap_or(false));
}

#[tauri::command]
fn hide_calendar(app: AppHandle) {
    hide_main(&app);
}

#[tauri::command]
fn is_calendar_visible(app: AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ---------------- app ----------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app, false)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, ev| {
                    if ev.state() == ShortcutState::Pressed {
                        overlay::summon(app, "hotkey");
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = Db::open(&data_dir.join("elise.db")).map_err(|e| e.to_string())?;
            let settings = settings::load(&data_dir);

            app.manage(AppState {
                db: Mutex::new(db),
                settings: Mutex::new(settings.clone()),
                data_dir,
                sched: Mutex::new(None),
                overlay_mode: Mutex::new(Mode::Hidden),
                pending_reminders: Mutex::new(vec![]),
                tray: Mutex::new(None),
                sessions: Mutex::new(HashMap::new()),
                move_counter: AtomicU64::new(0),
                ignore_moves: AtomicBool::new(false),
            });

            app.manage(voice::Voice::default());
            voice::start(&handle);

            let checks = tray::build(&handle)?;
            *app.state::<AppState>().tray.lock().unwrap() = Some(checks);

            if let Err(e) = register_hotkey(&handle, &settings.hotkey) {
                eprintln!("{e}");
            }
            apply_autostart(&handle, settings.autostart);

            let tx = scheduler::start(handle.clone());
            *app.state::<AppState>().sched.lock().unwrap() = Some(tx);

            if settings.hover_mode {
                overlay::set_mode(&handle, Mode::Compact);
            }
            let hidden = std::env::args().any(|a| a == "--hidden");
            if !hidden {
                show_main(&handle, false);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Closing any window just hides it; Elise lives in the tray.
                api.prevent_close();
                if window.label() == "main" {
                    hide_main(window.app_handle());
                } else {
                    let _ = window.hide();
                }
            }
            WindowEvent::Moved(pos) if window.label() == overlay::LABEL => {
                overlay::on_moved(window.app_handle(), *pos);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            list_occurrences,
            get_event,
            create_event,
            update_event,
            delete_event,
            search_events,
            run_command,
            cancel_session,
            undo_command,
            last_command,
            get_settings,
            set_settings,
            reset_hover_pos,
            has_api_key,
            set_api_key,
            test_api_key,
            summon,
            overlay_get_mode,
            overlay_expand,
            overlay_done,
            take_reminders,
            reminder_action,
            reminder_toast,
            voice_listen,
            voice_cancel,
            voice_status,
            show_calendar,
            hide_calendar,
            is_calendar_visible,
            quit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Elise")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                voice::shutdown(app);
            }
        });
}
