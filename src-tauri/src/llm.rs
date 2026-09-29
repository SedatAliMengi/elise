//! Command engine: turns a natural-language command into calendar changes via
//! the Claude Messages API (raw HTTP + client-side tools).

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::events::{self, Scope};
use crate::model::{Change, Event, Freq, Recurrence, Reminder};
use crate::{db::now, AppState};

const MODEL: &str = "claude-haiku-4-5";
const API_URL: &str = "https://api.anthropic.com/v1/messages";
const MAX_STEPS: usize = 8;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    /// "done" | "answer" | "clarify" | "error"
    pub kind: String,
    pub message: String,
    pub summary: Vec<String>,
    pub history_id: Option<String>,
}

impl CommandResult {
    fn error(msg: &str) -> Self {
        Self { kind: "error".into(), message: msg.into(), summary: vec![], history_id: None }
    }
}

/// Conversation kept alive while Elise asks a clarification question.
#[derive(Default, Clone)]
pub struct Session {
    messages: Vec<Value>,
    changes: Vec<Change>,
    text: String,
    /// Waiting for the answer to ask_clarification: (tool_use_id, other tool results of that turn).
    pending: Option<(String, Vec<Value>)>,
}

fn system_prompt(user: &str) -> String {
    format!(
        "You are Elise, a calendar assistant living on {user}'s Windows PC. {user} gives short spoken or typed \
commands; you carry them out with the calendar tools.

Rules:
- All date-times are local wall-clock time in the format YYYY-MM-DDTHH:MM:SS. Dates are YYYY-MM-DD.
- A date without a year means its next occurrence from today. \"10pm\" is 22:00. If only a date is given with no time, \
create an all-day event.
- Timed events without a stated end last the default length given in the context.
- To change or delete an existing event, find its id first (the context lists upcoming events; use find_events for \
anything else). Never invent ids.
- Recurring events: occurrence_start identifies one occurrence. Use scope \"this\" for one occurrence, \"following\" \
for this and later ones, \"all\" for the whole series (default when the user speaks about the event in general).
- Reminders: \"remind me N days before\" is one reminder with days_before=N. \"remind me N days before, each of those \
days\" / \"every day for the N days before\" means N reminders: days_before=N, N-1, ..., 1. Day-based reminders fire \
at the default reminder time unless the user gives a time. \"30 minutes before\" is minutes_before=30.
- Moving several events (\"push everything tomorrow one hour later\") means one update_event call per event.
- Only call ask_clarification when you truly cannot tell what the user means (e.g. two matching events). Ask one \
short question. Otherwise act.
- Questions like \"what do I have on Friday?\" are answered in text: one or two short spoken-style sentences, no \
lists or markdown.
- After making changes, reply with a very short confirmation (a few words). Never ask for confirmation first."
    )
}

fn reminder_schema() -> Value {
    json!({
        "type": "array",
        "description": "Replaces all reminders of the event. Relative reminders use days_before/hours_before/minutes_before (summed); optional at_time HH:MM fixes the time of day. Absolute reminders use at.",
        "items": {
            "type": "object",
            "properties": {
                "days_before": {"type": "integer"},
                "hours_before": {"type": "integer"},
                "minutes_before": {"type": "integer"},
                "at_time": {"type": "string", "description": "HH:MM"},
                "at": {"type": "string", "description": "YYYY-MM-DDTHH:MM:SS, one-off absolute reminder"}
            }
        }
    })
}

fn recurrence_schema() -> Value {
    json!({
        "type": ["object", "null"],
        "description": "Repeat rule; null removes repetition.",
        "properties": {
            "freq": {"type": "string", "enum": ["daily", "weekly", "monthly", "yearly"]},
            "interval": {"type": "integer", "description": "Every N periods, default 1"},
            "by_weekday": {"type": "array", "items": {"type": "string", "enum": ["mon","tue","wed","thu","fri","sat","sun"]}},
            "until": {"type": "string", "description": "YYYY-MM-DD, inclusive"},
            "count": {"type": "integer"}
        },
        "required": ["freq"]
    })
}

fn tools() -> Value {
    json!([
        {
            "name": "create_event",
            "description": "Create a calendar event (optionally repeating, with reminders).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "start": {"type": "string", "description": "YYYY-MM-DDTHH:MM:SS (use T00:00:00 for all-day)"},
                    "end": {"type": "string"},
                    "all_day": {"type": "boolean"},
                    "location": {"type": "string"},
                    "notes": {"type": "string"},
                    "recurrence": recurrence_schema(),
                    "reminders": reminder_schema()
                },
                "required": ["title", "start"]
            }
        },
        {
            "name": "update_event",
            "description": "Change an existing event: move it, rename it, change time, repetition or reminders. Only include fields that change. start/end are the new times of the given occurrence.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string"},
                    "occurrence_start": {"type": "string", "description": "Start of the occurrence being changed (recurring events)"},
                    "scope": {"type": "string", "enum": ["this", "following", "all"]},
                    "title": {"type": "string"},
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                    "all_day": {"type": "boolean"},
                    "location": {"type": "string"},
                    "notes": {"type": "string"},
                    "recurrence": recurrence_schema(),
                    "reminders": reminder_schema()
                },
                "required": ["event_id"]
            }
        },
        {
            "name": "delete_event",
            "description": "Delete an event, or one/following occurrences of a repeating event.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "event_id": {"type": "string"},
                    "occurrence_start": {"type": "string"},
                    "scope": {"type": "string", "enum": ["this", "following", "all"]}
                },
                "required": ["event_id"]
            }
        },
        {
            "name": "find_events",
            "description": "Search events by text and/or list occurrences in a date range.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "from": {"type": "string", "description": "YYYY-MM-DD"},
                    "to": {"type": "string", "description": "YYYY-MM-DD inclusive"}
                }
            }
        },
        {
            "name": "ask_clarification",
            "description": "Ask the user one short question when the command is genuinely ambiguous.",
            "input_schema": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
                "required": ["question"]
            }
        }
    ])
}

// ---------- helpers ----------

fn parse_dt(v: &Value) -> Option<NaiveDateTime> {
    let s = v.as_str()?.trim();
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M"))
        .ok()
        .or_else(|| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().map(|d| d.and_hms_opt(0, 0, 0).unwrap()))
}

fn parse_date(v: &Value) -> Option<NaiveDate> {
    parse_dt(v).map(|d| d.date())
}

fn fmt_dt(d: NaiveDateTime, all_day: bool) -> String {
    if all_day {
        d.format("%a %-d %b %Y").to_string()
    } else {
        d.format("%a %-d %b %Y %H:%M").to_string()
    }
}

fn parse_reminders(v: &Value, default_time: &str) -> Vec<Reminder> {
    let Some(arr) = v.as_array() else { return vec![] };
    arr.iter()
        .filter_map(|r| {
            if let Some(at) = r.get("at").and_then(|a| parse_dt(a)) {
                return Some(Reminder { id: String::new(), offset_min: None, at_time: None, at: Some(at), created_at: None });
            }
            let d = r.get("days_before").and_then(Value::as_i64).unwrap_or(0);
            let h = r.get("hours_before").and_then(Value::as_i64).unwrap_or(0);
            let m = r.get("minutes_before").and_then(Value::as_i64).unwrap_or(0);
            let mut at_time = r.get("at_time").and_then(Value::as_str).map(str::to_string);
            if at_time.is_none() && d > 0 && h == 0 && m == 0 {
                at_time = Some(default_time.to_string());
            }
            Some(Reminder {
                id: String::new(),
                offset_min: Some(d * 1440 + h * 60 + m),
                at_time,
                at: None,
                created_at: None,
            })
        })
        .collect()
}

fn parse_recurrence(v: &Value) -> Option<Recurrence> {
    let freq = match v.get("freq")?.as_str()? {
        "daily" => Freq::Daily,
        "weekly" => Freq::Weekly,
        "monthly" => Freq::Monthly,
        "yearly" => Freq::Yearly,
        _ => return None,
    };
    let days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    let by_weekday = v.get("by_weekday").and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(|d| d.as_str())
            .filter_map(|d| days.iter().position(|x| d.to_lowercase().starts_with(x)).map(|i| i as u8))
            .collect::<Vec<_>>()
    });
    Some(Recurrence {
        freq,
        interval: v.get("interval").and_then(Value::as_u64).unwrap_or(1).max(1) as u32,
        by_weekday,
        until: v.get("until").and_then(parse_date),
        count: v.get("count").and_then(Value::as_u64).map(|c| c as u32),
    })
}

fn describe_reminders(ev: &Event) -> String {
    if ev.reminders.is_empty() {
        return String::new();
    }
    let parts: Vec<String> = ev
        .reminders
        .iter()
        .map(|r| {
            if let Some(at) = r.at {
                return at.format("%-d %b %H:%M").to_string();
            }
            let m = r.offset_min.unwrap_or(0);
            let base = if m == 0 {
                "at start".to_string()
            } else if m % 1440 == 0 {
                format!("{}d before", m / 1440)
            } else if m % 60 == 0 {
                format!("{}h before", m / 60)
            } else {
                format!("{}m before", m)
            };
            match &r.at_time {
                Some(t) => format!("{base} {t}"),
                None => base,
            }
        })
        .collect();
    format!("reminders: {}", parts.join(", "))
}

fn occ_line(ev: &Event, start: NaiveDateTime) -> String {
    let mut s = format!(
        "id={} | {} | {}{}",
        ev.id,
        ev.title,
        if ev.all_day { start.format("%Y-%m-%d (all day)").to_string() } else { start.format("%Y-%m-%dT%H:%M:%S").to_string() },
        if ev.recurrence.is_some() { " | repeating" } else { "" }
    );
    if let Some(end) = ev.end.filter(|_| !ev.all_day) {
        s.push_str(&format!(" | lasts {} min", (end - ev.start).num_minutes()));
    }
    if let Some(l) = &ev.location {
        s.push_str(&format!(" | at {l}"));
    }
    let r = describe_reminders(ev);
    if !r.is_empty() {
        s.push_str(&format!(" | {r}"));
    }
    s
}

pub fn summarize(c: &Change) -> String {
    match (&c.before, &c.after) {
        (None, Some(a)) => {
            let mut s = format!("Added: {} · {}", a.title, fmt_dt(a.start, a.all_day));
            if a.recurrence.is_some() {
                s.push_str(" · repeating");
            }
            let r = describe_reminders(a);
            if !r.is_empty() {
                s.push_str(&format!(" · {r}"));
            }
            s
        }
        (Some(b), None) => format!("Removed: {} · {}", b.title, fmt_dt(b.start, b.all_day)),
        (Some(_), Some(a)) => {
            let mut s = format!("Updated: {} · {}", a.title, fmt_dt(a.start, a.all_day));
            let r = describe_reminders(a);
            if !r.is_empty() {
                s.push_str(&format!(" · {r}"));
            }
            s
        }
        _ => String::new(),
    }
}

// ---------- tool execution ----------

enum ToolOutcome {
    Result(String),
    Clarify(String),
}

fn run_tool(app: &AppHandle, name: &str, input: &Value, changes: &mut Vec<Change>) -> Result<ToolOutcome, String> {
    let state = app.state::<AppState>();
    let (default_time, default_len) = {
        let s = state.settings.lock().unwrap();
        (s.default_reminder_time.clone(), s.default_event_minutes)
    };
    let mut db = state.db.lock().unwrap();
    exec_tool(&mut db, &default_time, default_len, name, input, changes)
}

fn exec_tool(
    db: &mut crate::db::Db,
    default_time: &str,
    default_len: i64,
    name: &str,
    input: &Value,
    changes: &mut Vec<Change>,
) -> Result<ToolOutcome, String> {
    let db = &mut *db;
    let str_field = |k: &str| input.get(k).and_then(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    match name {
        "create_event" => {
            let start = input.get("start").and_then(parse_dt).ok_or("start is not a valid date-time")?;
            let all_day = input.get("all_day").and_then(Value::as_bool).unwrap_or(false);
            let end = input
                .get("end")
                .and_then(parse_dt)
                .or_else(|| (!all_day).then(|| start + Duration::minutes(default_len)));
            let ev = Event {
                id: String::new(),
                title: str_field("title").unwrap_or_else(|| "Untitled".into()),
                start: if all_day { start.date().and_hms_opt(0, 0, 0).unwrap() } else { start },
                end: if all_day { None } else { end },
                all_day,
                location: str_field("location"),
                notes: str_field("notes"),
                color: None,
                recurrence: input.get("recurrence").and_then(parse_recurrence),
                exdates: vec![],
                parent_id: None,
                reminders: input.get("reminders").map(|r| parse_reminders(r, default_time)).unwrap_or_default(),
                created_at: None,
                updated_at: None,
            };
            let (saved, ch) = events::create(db, ev)?;
            changes.extend(ch);
            Ok(ToolOutcome::Result(format!("Created. {}", occ_line(&saved, saved.start))))
        }
        "update_event" => {
            let id = str_field("event_id").ok_or("event_id is required")?;
            let series = db.get_event(&id)?.ok_or("No event with that id")?;
            let occ_start = input.get("occurrence_start").and_then(parse_dt);
            let scope: Scope = match input.get("scope").and_then(Value::as_str) {
                Some("this") => Scope::This,
                Some("following") => Scope::Following,
                _ => Scope::All,
            };
            let base_start = occ_start.unwrap_or(series.start);
            let len = series.end.map(|e| e - series.start);
            let mut ev = series.clone();
            ev.start = base_start;
            ev.end = len.map(|l| base_start + l);
            if let Some(t) = str_field("title") {
                ev.title = t;
            }
            if let Some(all_day) = input.get("all_day").and_then(Value::as_bool) {
                ev.all_day = all_day;
            }
            if let Some(s) = input.get("start").and_then(parse_dt) {
                ev.start = s;
                ev.end = len.map(|l| s + l);
            }
            if let Some(e) = input.get("end").and_then(parse_dt) {
                ev.end = Some(e);
            }
            if ev.all_day {
                ev.start = ev.start.date().and_hms_opt(0, 0, 0).unwrap();
                ev.end = None;
            } else if ev.end.is_none() {
                ev.end = Some(ev.start + Duration::minutes(default_len));
            }
            if input.get("location").is_some() {
                ev.location = str_field("location");
            }
            if input.get("notes").is_some() {
                ev.notes = str_field("notes");
            }
            if let Some(r) = input.get("recurrence") {
                ev.recurrence = parse_recurrence(r);
            }
            if let Some(r) = input.get("reminders") {
                // Keep ids of identical reminders so they aren't re-fired.
                let mut new = parse_reminders(r, default_time);
                for n in new.iter_mut() {
                    if let Some(o) = series.reminders.iter().find(|o| o.offset_min == n.offset_min && o.at_time == n.at_time && o.at == n.at) {
                        n.id = o.id.clone();
                    }
                }
                ev.reminders = new;
            }
            let (saved, ch) = events::edit(db, &id, occ_start, scope, ev)?;
            changes.extend(ch);
            Ok(ToolOutcome::Result(format!("Updated. {}", occ_line(&saved, saved.start))))
        }
        "delete_event" => {
            let id = str_field("event_id").ok_or("event_id is required")?;
            let occ_start = input.get("occurrence_start").and_then(parse_dt);
            let scope: Scope = match input.get("scope").and_then(Value::as_str) {
                Some("this") => Scope::This,
                Some("following") => Scope::Following,
                _ => Scope::All,
            };
            let ch = events::remove(db, &id, occ_start, scope)?;
            changes.extend(ch);
            Ok(ToolOutcome::Result("Deleted.".into()))
        }
        "find_events" => {
            let from = input.get("from").and_then(parse_date);
            let to = input.get("to").and_then(parse_date);
            let q = str_field("query");
            let mut lines = Vec::new();
            if from.is_some() || to.is_some() {
                let f = from.unwrap_or_else(|| now().date());
                let t = to.unwrap_or(f) + Duration::days(1);
                for o in events::list_occurrences(db, f.and_hms_opt(0, 0, 0).unwrap(), t.and_hms_opt(0, 0, 0).unwrap())? {
                    if q.as_ref().map_or(true, |q| o.event.title.to_lowercase().contains(&q.to_lowercase())) {
                        lines.push(occ_line(&o.event, o.start));
                    }
                }
            } else if let Some(q) = &q {
                for ev in db.search(q, 25)? {
                    lines.push(occ_line(&ev, ev.start));
                }
            }
            if lines.is_empty() {
                Ok(ToolOutcome::Result("No matching events.".into()))
            } else {
                lines.truncate(60);
                Ok(ToolOutcome::Result(lines.join("\n")))
            }
        }
        "ask_clarification" => Ok(ToolOutcome::Clarify(str_field("question").unwrap_or_else(|| "Could you say that differently?".into()))),
        other => Err(format!("Unknown tool {other}")),
    }
}

fn context_block(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let (default_time, default_len) = {
        let s = state.settings.lock().unwrap();
        (s.default_reminder_time.clone(), s.default_event_minutes)
    };
    let n = now();
    let db = state.db.lock().unwrap();
    let from = (n.date() - Duration::days(3)).and_hms_opt(0, 0, 0).unwrap();
    let to = (n.date() + Duration::days(45)).and_hms_opt(0, 0, 0).unwrap();
    let mut occ = events::list_occurrences(&db, from, to)?;
    occ.sort_by_key(|o| o.start);
    let lines: Vec<String> = occ.iter().take(80).map(|o| occ_line(&o.event, o.start)).collect();
    Ok(format!(
        "Now: {} ({}, week {}).\nDefault reminder time: {default_time}. Default event length: {default_len} minutes.\n\
Events from 3 days ago to 45 days ahead:\n{}",
        n.format("%Y-%m-%dT%H:%M:%S"),
        n.format("%A"),
        n.iso_week().week(),
        if lines.is_empty() { "(none)".into() } else { lines.join("\n") }
    ))
}

// ---------- API ----------

async fn call_api(key: &str, system: &str, messages: &[Value]) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(40))
        .build()
        .map_err(|e| e.to_string())?;
    let body = json!({
        "model": MODEL,
        "max_tokens": 2048,
        "system": system,
        "tools": tools(),
        "messages": messages,
    });
    let res = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|_| "I can't reach my mind right now. Try again, or add it manually.".to_string())?;
    let status = res.status();
    let v: Value = res.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(v);
    }
    Err(match status.as_u16() {
        401 | 403 => "My API key isn't working. Check it in Settings.".into(),
        429 | 529 => "My mind is busy right now. Try again in a moment.".into(),
        402 => "My API credit ran out. Top it up in the Anthropic console.".into(),
        s if s >= 500 => "My mind is having trouble right now. Try again shortly.".into(),
        _ => format!(
            "Something went wrong ({}).",
            v.pointer("/error/message").and_then(Value::as_str).unwrap_or("unknown error")
        ),
    })
}

/// Minimal request to verify a key.
pub async fn test_key(key: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({"model": MODEL, "max_tokens": 5, "messages": [{"role": "user", "content": "Hi"}]}))
        .send()
        .await
        .map_err(|_| "Can't reach the Anthropic API (no internet?)".to_string())?;
    match res.status().as_u16() {
        200 => Ok(()),
        401 | 403 => Err("That key was rejected.".into()),
        s => Err(format!("The API answered with status {s}.")),
    }
}

pub async fn run(app: &AppHandle, session_id: &str, text: &str) -> CommandResult {
    let Some(key) = crate::settings::get_api_key() else {
        return CommandResult::error("I need my API key. Open Settings to add it.");
    };
    let state = app.state::<AppState>();
    let user_name = state.settings.lock().unwrap().user_name.clone();
    let system = system_prompt(&user_name);

    let mut session = state.sessions.lock().unwrap().remove(session_id).unwrap_or_default();
    let ctx = match context_block(app) {
        Ok(c) => c,
        Err(e) => return CommandResult::error(&e),
    };
    if session.messages.is_empty() {
        session.text = text.to_string();
        session.messages.push(json!({
            "role": "user",
            "content": [
                {"type": "text", "text": format!("<context>\n{ctx}\n</context>")},
                {"type": "text", "text": text}
            ]
        }));
    } else if let Some((tool_id, mut results)) = session.pending.take() {
        // The user's answer becomes the result of the ask_clarification call.
        session.text.push_str(" / ");
        session.text.push_str(text);
        results.push(json!({"type": "tool_result", "tool_use_id": tool_id, "content": format!("The user answered: {text}")}));
        session.messages.push(json!({"role": "user", "content": results}));
    }

    let mut final_text = String::new();
    for _ in 0..MAX_STEPS {
        let resp = match call_api(&key, &system, &session.messages).await {
            Ok(v) => v,
            Err(e) => return finish_with_error(app, session, &e),
        };
        let content = resp.get("content").cloned().unwrap_or(json!([]));
        session.messages.push(json!({"role": "assistant", "content": content.clone()}));
        let stop = resp.get("stop_reason").and_then(Value::as_str).unwrap_or("");

        final_text = content
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_default();

        if stop != "tool_use" {
            break;
        }
        let mut results = Vec::new();
        let mut clarify: Option<(String, String)> = None;
        for block in content.as_array().into_iter().flatten() {
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            let id = block.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
            let input = block.get("input").cloned().unwrap_or(json!({}));
            match run_tool(app, name, &input, &mut session.changes) {
                Ok(ToolOutcome::Result(r)) => results.push(json!({"type": "tool_result", "tool_use_id": id, "content": r})),
                Ok(ToolOutcome::Clarify(q)) => clarify = Some((id, q)),
                Err(e) => results.push(json!({"type": "tool_result", "tool_use_id": id, "content": e, "is_error": true})),
            }
        }
        if let Some((id, q)) = clarify {
            // Park the conversation; the user's answer becomes this tool's result.
            session.pending = Some((id, results));
            let summary = session.changes.iter().map(summarize).collect();
            state.sessions.lock().unwrap().insert(session_id.to_string(), session);
            return CommandResult { kind: "clarify".into(), message: q, summary, history_id: None };
        }
        session.messages.push(json!({"role": "user", "content": results}));
    }
    finish(app, session, final_text)
}

fn finish_with_error(app: &AppHandle, session: Session, msg: &str) -> CommandResult {
    if session.changes.is_empty() {
        return CommandResult::error(msg);
    }
    let mut r = finish(app, session, String::new());
    r.message = format!("Understood — but then: {msg}");
    r
}

fn finish(app: &AppHandle, session: Session, final_text: String) -> CommandResult {
    let state = app.state::<AppState>();
    if !session.changes.is_empty() {
        let summary: Vec<String> = session.changes.iter().map(summarize).filter(|s| !s.is_empty()).collect();
        let history_id = state.db.lock().unwrap().record_command(&session.text, &session.changes).ok();
        crate::notify_changed(app);
        return CommandResult { kind: "done".into(), message: "Understood.".into(), summary, history_id };
    }
    let t = final_text.trim();
    if t.is_empty() {
        CommandResult::error("I didn't catch that. Could you say it differently?")
    } else {
        CommandResult { kind: "answer".into(), message: t.to_string(), summary: vec![], history_id: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn run(db: &mut Db, name: &str, input: Value) -> (String, Vec<Change>) {
        let mut ch = vec![];
        match exec_tool(db, "09:00", 60, name, &input, &mut ch).unwrap() {
            ToolOutcome::Result(r) => (r, ch),
            ToolOutcome::Clarify(q) => (q, ch),
        }
    }

    #[test]
    fn doctor_example_from_the_prd() {
        let mut db = Db::memory().unwrap();
        let (_, ch) = run(
            &mut db,
            "create_event",
            json!({"title": "Doctor appointment", "start": "2027-07-05T22:00:00",
                   "reminders": [{"days_before": 2}, {"days_before": 1}]}),
        );
        let ev = ch[0].after.clone().unwrap();
        assert_eq!(ev.end.unwrap().format("%H:%M").to_string(), "23:00");
        assert_eq!(ev.reminders.len(), 2);
        assert!(ev.reminders.iter().all(|r| r.at_time.as_deref() == Some("09:00")));
        let s = summarize(&ch[0]);
        assert!(s.contains("Doctor appointment") && s.contains("2d before 09:00") && s.contains("1d before 09:00"), "{s}");
    }

    #[test]
    fn move_repeat_find_delete() {
        let mut db = Db::memory().unwrap();
        let (_, ch) = run(&mut db, "create_event", json!({"title": "Dentist", "start": "2027-03-10T15:00:00"}));
        let id = ch[0].after.as_ref().unwrap().id.clone();

        // "push it one hour later"
        run(&mut db, "update_event", json!({"event_id": id, "start": "2027-03-10T16:00:00"}));
        let ev = db.get_event(&id).unwrap().unwrap();
        assert_eq!(ev.start.format("%H:%M").to_string(), "16:00");
        assert_eq!(ev.end.unwrap().format("%H:%M").to_string(), "17:00");

        // "change the reminder to 30 minutes before"
        run(&mut db, "update_event", json!({"event_id": id, "reminders": [{"minutes_before": 30}]}));
        assert_eq!(db.get_event(&id).unwrap().unwrap().reminders[0].offset_min, Some(30));

        // "every Monday at 8 take out the trash"
        run(&mut db, "create_event", json!({"title": "Trash", "start": "2027-03-15T08:00:00",
            "recurrence": {"freq": "weekly", "by_weekday": ["mon"]}}));
        let (found, _) = run(&mut db, "find_events", json!({"from": "2027-03-15", "to": "2027-03-29"}));
        assert_eq!(found.matches("Trash").count(), 3, "{found}");

        let (_, ch) = run(&mut db, "delete_event", json!({"event_id": id}));
        assert!(ch[0].after.is_none());
        assert!(db.get_event(&id).unwrap().is_none());
    }

    #[test]
    fn all_day_birthday_yearly() {
        let mut db = Db::memory().unwrap();
        let (_, ch) = run(&mut db, "create_event", json!({"title": "Mom's birthday", "start": "2027-03-03",
            "all_day": true, "recurrence": {"freq": "yearly"}, "reminders": [{"days_before": 7}]}));
        let ev = ch[0].after.clone().unwrap();
        assert!(ev.all_day && ev.end.is_none());
        assert_eq!(ev.reminders[0].offset_min, Some(7 * 1440));
    }
}
