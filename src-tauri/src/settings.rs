use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub user_name: String,
    pub voice_responses: bool,
    pub voice_name: Option<String>,
    pub voice_rate: f32,
    pub wake_word: bool,
    pub hotkey: String,
    pub hover_mode: bool,
    /// Physical screen position of the compact hover eye window.
    pub hover_pos: Option<(i32, i32)>,
    pub autostart: bool,
    pub default_reminder_time: String,
    pub default_event_minutes: i64,
    pub week_starts_monday: bool,
    pub time_24h: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            user_name: "Enigma".into(),
            voice_responses: true,
            voice_name: None,
            voice_rate: 1.0,
            wake_word: true,
            hotkey: "Ctrl+Alt+E".into(),
            hover_mode: false,
            hover_pos: None,
            autostart: true,
            default_reminder_time: "09:00".into(),
            default_event_minutes: 60,
            week_starts_monday: true,
            time_24h: true,
        }
    }
}

pub fn path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path) -> Settings {
    std::fs::read_to_string(path(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, s: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(path(dir), json).map_err(|e| e.to_string())
}

// ----- API key (Windows Credential Manager) -----

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("Elise", "claude-api-key").map_err(|e| e.to_string())
}

pub fn get_api_key() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|k| !k.trim().is_empty())
}

pub fn set_api_key(key: &str) -> Result<(), String> {
    let e = entry()?;
    if key.trim().is_empty() {
        let _ = e.delete_credential();
        Ok(())
    } else {
        e.set_password(key.trim()).map_err(|e| e.to_string())
    }
}
