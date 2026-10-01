//! Accuracy test for the command engine (makes real Claude API calls).
//!
//!     cd src-tauri
//!     cargo test accuracy -- --ignored --nocapture
//!
//! Reads tests/commands.json, runs every command through the same `llm::run_core`
//! the app uses (fresh in-memory calendar per case, fixed "now"), checks what
//! actually changed, and writes tests/results.md + tests/results.json.
//! API key: ANTHROPIC_API_KEY, else a .env file in the repo root, else the key
//! saved in Elise's settings. Optional: ELISE_EVAL_ONLY=1,5,9 to run some cases.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use chrono::NaiveDateTime;
use serde_json::{json, Value};

use crate::db::Db;
use crate::llm::{run_core, summarize, Ctx, Session, Turn};
use crate::model::Event;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn api_key() -> String {
    if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
        if !k.trim().is_empty() {
            return k.trim().to_string();
        }
    }
    if let Ok(env) = std::fs::read_to_string(root().join(".env")) {
        for line in env.lines() {
            if let Some(v) = line.trim().strip_prefix("ANTHROPIC_API_KEY=") {
                let v = v.trim().trim_matches('"');
                if !v.is_empty() && v != "your-key-here" {
                    return v.to_string();
                }
            }
        }
    }
    crate::settings::get_api_key().expect("set ANTHROPIC_API_KEY (env or .env) or save a key in Elise's settings")
}

fn all_events(db: &Db) -> HashMap<String, Event> {
    let p = |s| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap();
    db.events_in_range(p("1970-01-01 00:00"), p("2200-01-01 00:00"))
        .unwrap()
        .into_iter()
        .map(|e| (e.id.clone(), e))
        .collect()
}

/// The parts of an event that matter for "did it change?".
fn fingerprint(e: &Event) -> Value {
    let mut rem: Vec<_> = e.reminders.iter().map(|r| json!([r.offset_min, r.at_time, r.at])).collect();
    rem.sort_by_key(|v| v.to_string());
    json!([e.title, e.start, e.end, e.all_day, e.recurrence, e.exdates, rem])
}

fn as_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::String(s)) => vec![s.clone()],
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        _ => vec![],
    }
}

/// Check one event against the expectation's field checks; returns what's wrong.
fn check_event(e: &Event, x: &Value) -> Vec<String> {
    let mut bad = vec![];
    let titles = as_list(x.get("title_any"));
    if !titles.is_empty() {
        let t = e.title.to_lowercase();
        if !titles.iter().any(|k| t.contains(&k.to_lowercase())) {
            bad.push(format!("title {:?} lacks any of {:?}", e.title, titles));
        }
    }
    let starts = as_list(x.get("start"));
    if !starts.is_empty() {
        let full = e.start.format("%Y-%m-%dT%H:%M").to_string();
        let date = e.start.format("%Y-%m-%d").to_string();
        let ok = starts.iter().any(|s| if s.len() == 10 { *s == date } else { *s == full });
        if !ok {
            bad.push(format!("start {full} not in {starts:?}"));
        }
    }
    if let Some(end) = x.get("end").and_then(Value::as_str) {
        let got = e.end.map(|d| d.format("%Y-%m-%dT%H:%M").to_string()).unwrap_or_default();
        if got != end {
            bad.push(format!("end {got:?} != {end}"));
        }
    }
    if let Some(ad) = x.get("all_day").and_then(Value::as_bool) {
        if e.all_day != ad {
            bad.push(format!("all_day {} != {ad}", e.all_day));
        }
    }
    if let Some(f) = x.get("freq").and_then(Value::as_str) {
        let got = e.recurrence.as_ref().map(|r| format!("{:?}", r.freq).to_lowercase()).unwrap_or_else(|| "none".into());
        if got != f {
            bad.push(format!("repeat {got} != {f}"));
        }
    }
    if let Some(want) = x.get("reminders").and_then(Value::as_array) {
        let mut want: Vec<i64> = want.iter().filter_map(Value::as_i64).collect();
        let mut got: Vec<i64> = e.reminders.iter().filter_map(|r| r.offset_min).collect();
        want.sort();
        got.sort();
        if want != got {
            bad.push(format!("reminders {got:?} != {want:?} (minutes before)"));
        }
    }
    bad
}

struct Outcome {
    pass: bool,
    why: String,
    happened: String,
    ms: u128,
}

fn judge(x: &Value, turn: &Turn, before: &HashMap<String, Event>, after: &HashMap<String, Event>) -> (bool, String) {
    if let Turn::Error(e) = turn {
        return (false, format!("API error: {e}"));
    }
    let created: Vec<&Event> = after.values().filter(|e| !before.contains_key(&e.id)).collect();
    let deleted: Vec<&String> = before.keys().filter(|id| !after.contains_key(*id)).collect();
    let changed: Vec<&String> =
        before.keys().filter(|id| after.get(*id).map_or(false, |a| fingerprint(a) != fingerprint(&before[*id]))).collect();
    let nothing = created.is_empty() && deleted.is_empty() && changed.is_empty();
    let action = x["action"].as_str().unwrap_or("");

    match action {
        "create" => {
            if !deleted.is_empty() || !changed.is_empty() {
                return (false, format!("also deleted {deleted:?} / changed {changed:?}"));
            }
            if created.is_empty() {
                return (false, "nothing was created".into());
            }
            let mut reasons = vec![];
            for e in &created {
                let bad = check_event(e, x);
                if bad.is_empty() {
                    return (true, String::new());
                }
                reasons.push(bad.join("; "));
            }
            (false, reasons.join(" | "))
        }
        "update" => {
            let t = x["target"].as_str().unwrap();
            let Some(e) = after.get(t) else { return (false, format!("{t} was deleted")) };
            if !created.is_empty() || !deleted.is_empty() {
                return (false, format!("also created {} / deleted {deleted:?}", created.len()));
            }
            if changed.iter().any(|id| id.as_str() != t) {
                return (false, format!("also changed {changed:?}"));
            }
            let bad = check_event(e, x);
            (bad.is_empty(), bad.join("; "))
        }
        "delete" => {
            let targets = as_list(x.get("targets"));
            let missing: Vec<_> = targets.iter().filter(|t| after.contains_key(*t)).collect();
            if !missing.is_empty() {
                return (false, format!("not deleted: {missing:?}"));
            }
            let extra: Vec<_> = deleted.iter().filter(|d| !targets.contains(d)).collect();
            if !extra.is_empty() || !created.is_empty() || !changed.is_empty() {
                return (false, format!("collateral: deleted {extra:?}, created {}, changed {changed:?}", created.len()));
            }
            (true, String::new())
        }
        "skip_occurrence" => {
            let t = x["target"].as_str().unwrap();
            let date = x["date"].as_str().unwrap();
            let Some(e) = after.get(t) else { return (false, "whole series was deleted".into()) };
            if !e.exdates.iter().any(|d| d.format("%Y-%m-%d").to_string() == date) {
                return (false, format!("{date} not skipped (exdates {:?})", e.exdates));
            }
            if !created.is_empty() || !deleted.is_empty() {
                return (false, "collateral changes".into());
            }
            (true, String::new())
        }
        "none" => {
            if !nothing {
                return (false, format!("changed the calendar (created {}, deleted {deleted:?}, changed {changed:?})", created.len()));
            }
            let Turn::Done(text) = turn else { return (false, "asked a question instead of answering".into()) };
            let keys = as_list(x.get("answer_any"));
            let low = text.to_lowercase();
            if !keys.is_empty() && !keys.iter().any(|k| low.contains(&k.to_lowercase())) {
                return (false, format!("answer lacks any of {keys:?}"));
            }
            (true, String::new())
        }
        "clarify_or_none" => {
            if matches!(turn, Turn::Clarify(_)) || nothing {
                (true, String::new())
            } else {
                (false, format!("guessed instead of asking (created {}, deleted {deleted:?}, changed {changed:?})", created.len()))
            }
        }
        other => (false, format!("unknown action {other}")),
    }
}

#[test]
#[ignore]
fn accuracy() {
    let spec: Value = serde_json::from_str(&std::fs::read_to_string(root().join("tests/commands.json")).unwrap()).unwrap();
    let now = NaiveDateTime::parse_from_str(spec["now"].as_str().unwrap(), "%Y-%m-%dT%H:%M:%S").unwrap();
    let seed: Vec<Event> = serde_json::from_value(spec["seed"].clone()).unwrap();
    let key = api_key();
    let only: Option<Vec<u64>> = std::env::var("ELISE_EVAL_ONLY").ok().map(|s| s.split(',').filter_map(|x| x.trim().parse().ok()).collect());

    let mut rows = vec![];
    for case in spec["cases"].as_array().unwrap() {
        let id = case["id"].as_u64().unwrap();
        if only.as_ref().map_or(false, |o| !o.contains(&id)) {
            continue;
        }
        let mut db = Db::memory().unwrap();
        for e in &seed {
            db.upsert(e.clone()).unwrap();
        }
        let before = all_events(&db);
        let db = Mutex::new(db);
        let ctx = Ctx { db: &db, default_time: "09:00".into(), default_len: 60, user_name: "Enigma".into(), now };
        let mut session = Session::default();
        let text = case["text"].as_str().unwrap();

        let t0 = Instant::now();
        let turn = tauri::async_runtime::block_on(run_core(&ctx, &key, &mut session, text));
        let ms = t0.elapsed().as_millis();
        let after = all_events(&db.lock().unwrap());
        let (pass, why) = judge(&case["expect"], &turn, &before, &after);

        let happened = match &turn {
            Turn::Clarify(q) => format!("asked: {q}"),
            Turn::Error(e) => format!("error: {e}"),
            Turn::Done(t) => {
                let ch: Vec<String> = session.changes.iter().map(summarize).filter(|s| !s.is_empty()).collect();
                if ch.is_empty() { format!("answered: {}", t.trim()) } else { ch.join(" / ") }
            }
        };
        println!("{:>3} {} {:<10} {:<2} {:>5}ms  {}", id, if pass { "PASS" } else { "FAIL" }, case["category"].as_str().unwrap(), case["lang"].as_str().unwrap(), ms, text);
        if !pass {
            println!("      why: {why}\n      got: {happened}");
        }
        rows.push((case.clone(), Outcome { pass, why, happened, ms }));
    }
    write_report(&rows);
}

fn pct(p: usize, n: usize) -> String {
    if n == 0 { "-".into() } else { format!("{:.0}%", 100.0 * p as f64 / n as f64) }
}

fn write_report(rows: &[(Value, Outcome)]) {
    let mut groups: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut add = |k: String, pass: bool| {
        let g = groups.entry(k).or_default();
        g.0 += pass as usize;
        g.1 += 1;
    };
    for (c, o) in rows {
        add(format!("2 lang: {}", c["lang"].as_str().unwrap()), o.pass);
        add(format!("3 category: {}", c["category"].as_str().unwrap()), o.pass);
    }
    let total = rows.len();
    let passed = rows.iter().filter(|(_, o)| o.pass).count();
    let mut ms: Vec<u128> = rows.iter().map(|(_, o)| o.ms).collect();
    ms.sort();
    let median = ms.get(ms.len() / 2).copied().unwrap_or(0);

    let label = |k: &str| -> String {
        let name = &k[2..];
        match name {
            "lang: en" => "English".into(),
            "lang: tr" => "Turkish".into(),
            n => {
                let c = n.trim_start_matches("category: ");
                match c {
                    "create" => "Simple adds".into(),
                    "relative" => "Relative dates".into(),
                    "reminders" => "Reminders".into(),
                    "recurring" => "Repeating events".into(),
                    "edit" => "Moves & edits".into(),
                    "delete" => "Cancels".into(),
                    "query" => "Questions".into(),
                    "ambiguous" => "Unclear (should ask)".into(),
                    o => o.into(),
                }
            }
        }
    };

    let mut md = String::new();
    md.push_str("# Command accuracy\n\n");
    md.push_str(&format!(
        "Model: `claude-haiku-4-5` · {} commands · run {} · fixed \"now\": Thursday 2026-10-01 10:00 · median latency {:.1} s\n\n",
        total,
        chrono::Local::now().format("%Y-%m-%d"),
        median as f64 / 1000.0
    ));
    md.push_str("| Test set | Commands | Accuracy |\n|---|---:|---:|\n");
    md.push_str(&format!("| **All** | {total} | **{}** |\n", pct(passed, total)));
    for (k, (p, n)) in &groups {
        md.push_str(&format!("| {} | {n} | {} |\n", label(k), pct(*p, *n)));
    }
    md.push_str("\nA command passes only if the calendar ends up exactly right: correct event, date, time, ");
    md.push_str("length, repeat rule and reminders, and nothing else touched. Questions must not change anything; ");
    md.push_str("unclear commands pass if Elise asks back (or does nothing) instead of guessing.\n\n");
    md.push_str("## Failures\n\n");
    let fails: Vec<_> = rows.iter().filter(|(_, o)| !o.pass).collect();
    if fails.is_empty() {
        md.push_str("None.\n");
    } else {
        md.push_str("| # | Command | Expected | What happened |\n|---|---|---|---|\n");
        for (c, o) in fails {
            let esc = |s: &str| s.replace('|', "\\|").replace('\n', " ");
            md.push_str(&format!(
                "| {} | {} | {} | {} |\n",
                c["id"],
                esc(c["text"].as_str().unwrap()),
                esc(&o.why),
                esc(&o.happened.chars().take(160).collect::<String>())
            ));
        }
    }
    md.push_str("\nRegenerate: `python tests/make_commands.py` then `cd src-tauri && cargo test accuracy -- --ignored --nocapture`.\n");
    std::fs::write(root().join("tests/results.md"), md).unwrap();

    let json_rows: Vec<Value> = rows
        .iter()
        .map(|(c, o)| json!({"id": c["id"], "category": c["category"], "lang": c["lang"], "text": c["text"], "pass": o.pass, "why": o.why, "happened": o.happened, "ms": o.ms}))
        .collect();
    std::fs::write(root().join("tests/results.json"), serde_json::to_string_pretty(&json_rows).unwrap()).unwrap();
    println!("\nACCURACY {passed}/{total} = {}  (median {median} ms) -> tests/results.md", pct(passed, total));
}
