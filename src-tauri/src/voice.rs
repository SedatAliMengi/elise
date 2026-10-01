//! Runs the offline voice sidecar (`voice/elise_voice.py`, or the packaged
//! `elise-voice.exe`) and bridges its JSON-lines protocol to the windows.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

#[derive(Default)]
pub struct Voice {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    /// Window label that asked to listen; transcripts go only there.
    owner: Mutex<String>,
    status: Mutex<VoiceStatus>,
    restarts: Mutex<u32>,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub available: bool,
    pub message: String,
}

fn set_status(app: &AppHandle, available: bool, message: &str) {
    let v = app.state::<Voice>();
    let s = VoiceStatus { available, message: message.to_string() };
    *v.status.lock().unwrap() = s.clone();
    let _ = app.emit("voice-status", s);
}

pub fn status(app: &AppHandle) -> VoiceStatus {
    app.state::<Voice>().status.lock().unwrap().clone()
}

/// How to launch the sidecar: packaged exe first, then the dev venv.
fn command(app: &AppHandle, models: &PathBuf) -> Option<Command> {
    let packaged = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("elise-voice").join("elise-voice.exe"))
        .filter(|p| p.exists());
    let mut cmd = if let Some(exe) = packaged {
        Command::new(exe)
    } else {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("voice");
        let py = root.join(".venv").join("Scripts").join("python.exe");
        let script = root.join("elise_voice.py");
        if !py.exists() || !script.exists() {
            return None;
        }
        let mut c = Command::new(py);
        c.arg("-u").arg(script);
        c
    };
    cmd.arg("--models").arg(models).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    Some(cmd)
}

pub fn start(app: &AppHandle) {
    let models = app.state::<AppState>().data_dir.join("models");
    let Some(mut cmd) = command(app, &models) else {
        set_status(app, false, "Voice engine isn't installed.");
        return;
    };
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            set_status(app, false, &format!("Voice engine failed to start: {e}"));
            return;
        }
    };
    let stdout = child.stdout.take().unwrap();
    let v = app.state::<Voice>();
    *v.stdin.lock().unwrap() = child.stdin.take();
    *v.child.lock().unwrap() = Some(child);

    let app = app.clone();
    std::thread::Builder::new()
        .name("elise-voice".into())
        .spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                handle(&app, msg);
            }
            // The sidecar exited: mark unavailable and retry a few times.
            set_status(&app, false, "Voice engine stopped.");
            let v = app.state::<Voice>();
            *v.stdin.lock().unwrap() = None;
            if let Some(mut c) = v.child.lock().unwrap().take() {
                let _ = c.wait();
            }
            let n = {
                let mut r = v.restarts.lock().unwrap();
                *r = r.saturating_add(1);
                *r
            };
            if n <= 3 {
                std::thread::sleep(std::time::Duration::from_secs(3 * n as u64));
                start(&app);
            }
        })
        .ok();
}

fn handle(app: &AppHandle, msg: Value) {
    let evt = msg.get("evt").and_then(Value::as_str).unwrap_or("");
    match evt {
        "ready" => {
            set_status(app, true, "");
            let on = app.state::<AppState>().settings.lock().unwrap().wake_word;
            send(app, json!({"cmd": "set_wake", "on": on}));
            prewarm(app);
        }
        "spoken" => {
            let _ = app.emit("voice-spoken", msg.get("id").cloned().unwrap_or(Value::Null));
        }
        "status" => {
            let m = msg.get("msg").and_then(Value::as_str).unwrap_or("");
            set_status(app, true, m);
        }
        "wake" => {
            let owner = if crate::stage::is_on(app) { crate::stage::LABEL } else { crate::overlay::LABEL };
            *app.state::<Voice>().owner.lock().unwrap() = owner.to_string();
            // direct: "Elise, <command>" in one breath; the engine is already recording it.
            let direct = msg.get("direct").and_then(Value::as_bool).unwrap_or(false);
            crate::overlay::summon(app, if direct { "voice-direct" } else { "voice" });
        }
        _ => {
            let owner = app.state::<Voice>().owner.lock().unwrap().clone();
            if !owner.is_empty() {
                let _ = app.emit_to(owner.as_str(), "voice", msg);
            }
        }
    }
}

pub fn send(app: &AppHandle, msg: Value) {
    let v = app.state::<Voice>();
    let mut guard = v.stdin.lock().unwrap();
    if let Some(stdin) = guard.as_mut() {
        if writeln!(stdin, "{msg}").and_then(|_| stdin.flush()).is_err() {
            *guard = None;
        }
    }
}

pub fn listen(app: &AppHandle, owner: &str) {
    *app.state::<Voice>().owner.lock().unwrap() = owner.to_string();
    send(app, json!({"cmd": "listen"}));
}

/// The user is done talking: transcribe what was recorded so far.
pub fn finish(app: &AppHandle) {
    send(app, json!({"cmd": "finish"}));
}

pub fn cancel(app: &AppHandle) {
    send(app, json!({"cmd": "cancel"}));
}

pub fn set_wake(app: &AppHandle, on: bool) {
    send(app, json!({"cmd": "set_wake", "on": on}));
}

/// Elise's speaking rate: the settings slider scales a slightly calm default.
fn speed(app: &AppHandle) -> f64 {
    let rate = app.state::<AppState>().settings.lock().unwrap().voice_rate as f64;
    (rate * 0.95).clamp(0.5, 1.6)
}

/// Pre-render the phrases Elise says most, so they play instantly.
pub fn prewarm(app: &AppHandle) {
    let name = app.state::<AppState>().settings.lock().unwrap().user_name.clone();
    let name = if name.trim().is_empty() { "Enigma".to_string() } else { name };
    let texts = [
        format!("Hello {name}, what is your command?"),
        "Understood.".to_string(),
        "Undone.".to_string(),
        "As you wish.".to_string(),
        "Understood. Anything else?".to_string(),
        "Anything else?".to_string(),
        "I didn't hear anything. Say it again, or type it.".to_string(),
    ];
    send(app, json!({"cmd": "prewarm", "texts": texts, "speed": speed(app)}));
}

pub fn speak(app: &AppHandle, id: u64, text: &str) -> bool {
    if !status(app).available {
        return false;
    }
    send(app, json!({"cmd": "speak", "id": id, "text": text, "speed": speed(app)}));
    true
}

pub fn stop_speaking(app: &AppHandle) {
    send(app, json!({"cmd": "stop_speaking"}));
}

pub fn shutdown(app: &AppHandle) {
    let v = app.state::<Voice>();
    *v.restarts.lock().unwrap() = u32::MAX / 2; // no restarts while quitting
    *v.stdin.lock().unwrap() = None; // closing stdin makes the sidecar exit
    let child = v.child.lock().unwrap().take();
    if let Some(mut c) = child {
        let _ = c.kill();
    }
}
