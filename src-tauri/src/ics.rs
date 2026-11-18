//! Calendar files (.ics, iCalendar): export Elise's calendar so Google
//! Calendar, Outlook or a phone can open it, and import one from them.
//!
//! A one-time copy each way, not a sync. Times are local wall-clock times like
//! everywhere in Elise: times in UTC ("Z") are converted to local time, times
//! with a TZID are taken as they are (right when the file's zone is the PC's).
//! What Elise can't represent is approximated and counted in the report
//! (e.g. "every 2nd Monday of the month" becomes "monthly").

use std::collections::{HashMap, HashSet};

use chrono::{Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;

use crate::db::{now, Db};
use crate::model::{Event, Freq, Recurrence, Reminder};

const DAYS: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: usize,
    /// Already in the calendar (same title and start), or twice in the file.
    pub skipped: usize,
    /// Repeat rules Elise can't express exactly, kept as the nearest one.
    pub approximated: usize,
    /// Entries that couldn't be read at all.
    pub failed: usize,
}

// ---------------- export ----------------

fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

/// Lines longer than 75 bytes continue on the next line after a space.
fn fold(line: &str, out: &mut String) {
    let mut n = 0;
    for ch in line.chars() {
        let w = ch.len_utf8();
        if n + w > 75 {
            out.push_str("\r\n ");
            n = 1;
        }
        out.push(ch);
        n += w;
    }
    out.push_str("\r\n");
}

fn dt(d: NaiveDateTime) -> String {
    d.format("%Y%m%dT%H%M%S").to_string()
}

fn date(d: NaiveDate) -> String {
    d.format("%Y%m%d").to_string()
}

fn rrule(r: &Recurrence, all_day: bool) -> String {
    let mut s = format!(
        "RRULE:FREQ={}",
        match r.freq {
            Freq::Daily => "DAILY",
            Freq::Weekly => "WEEKLY",
            Freq::Monthly => "MONTHLY",
            Freq::Yearly => "YEARLY",
        }
    );
    if r.interval > 1 {
        s.push_str(&format!(";INTERVAL={}", r.interval));
    }
    if let Some(days) = r.by_weekday.as_ref().filter(|d| !d.is_empty() && r.freq == Freq::Weekly) {
        let codes: Vec<&str> = days.iter().filter_map(|d| DAYS.get(*d as usize).copied()).collect();
        s.push_str(&format!(";BYDAY={}", codes.join(",")));
    }
    if let Some(u) = r.until {
        s.push_str(&if all_day { format!(";UNTIL={}", date(u)) } else { format!(";UNTIL={}T235959", date(u)) });
    }
    if let Some(c) = r.count {
        s.push_str(&format!(";COUNT={c}"));
    }
    s
}

/// Minutes before the start that a reminder fires (day-based ones are pinned
/// to their time of day, which a calendar file can only say as an offset).
fn reminder_offset(ev: &Event, r: &Reminder) -> Option<i64> {
    let off = r.offset_min?;
    match r.at_time.as_deref().and_then(crate::recur::parse_hhmm) {
        Some(t) => {
            let days = (off + 1439) / 1440;
            Some((ev.start - (ev.start.date() - Duration::days(days)).and_time(t)).num_minutes())
        }
        None => Some(off),
    }
}

pub fn export(db: &Db) -> Result<String, String> {
    let stamp = dt(Utc::now().naive_utc());
    let mut out = String::new();
    for l in ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Elise//Calendar//EN", "CALSCALE:GREGORIAN"] {
        fold(l, &mut out);
    }
    for ev in db.all_events()? {
        let mut lines = vec!["BEGIN:VEVENT".to_string(), format!("UID:{}@elise", ev.id), format!("DTSTAMP:{stamp}Z")];
        if ev.all_day {
            lines.push(format!("DTSTART;VALUE=DATE:{}", date(ev.start.date())));
            lines.push(format!("DTEND;VALUE=DATE:{}", date(ev.start.date() + Duration::days(1))));
        } else {
            lines.push(format!("DTSTART:{}", dt(ev.start)));
            if let Some(e) = ev.end {
                lines.push(format!("DTEND:{}", dt(e)));
            }
        }
        lines.push(format!("SUMMARY:{}", esc(&ev.title)));
        if let Some(l) = &ev.location {
            lines.push(format!("LOCATION:{}", esc(l)));
        }
        if let Some(n) = &ev.notes {
            lines.push(format!("DESCRIPTION:{}", esc(n)));
        }
        if let Some(r) = &ev.recurrence {
            lines.push(rrule(r, ev.all_day));
            for x in &ev.exdates {
                lines.push(if ev.all_day {
                    format!("EXDATE;VALUE=DATE:{}", date(*x))
                } else {
                    format!("EXDATE:{}", dt(x.and_time(ev.start.time())))
                });
            }
        }
        for r in &ev.reminders {
            let trigger = if let Some(at) = r.at {
                format!("TRIGGER;VALUE=DATE-TIME:{}", dt(at))
            } else if let Some(m) = reminder_offset(&ev, r) {
                format!("TRIGGER:{}PT{}M", if m >= 0 { "-" } else { "" }, m.abs())
            } else {
                continue;
            };
            lines.extend(["BEGIN:VALARM".into(), "ACTION:DISPLAY".into(), format!("DESCRIPTION:{}", esc(&ev.title)), trigger, "END:VALARM".into()]);
        }
        lines.push("END:VEVENT".into());
        for l in &lines {
            fold(l, &mut out);
        }
    }
    fold("END:VCALENDAR", &mut out);
    Ok(out)
}

// ---------------- import ----------------

struct Prop {
    name: String,
    params: HashMap<String, String>,
    value: String,
}

fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = vec![];
    for raw in text.split('\n') {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(&raw[1..]);
        } else if !raw.is_empty() {
            lines.push(raw.to_string());
        }
    }
    lines
}

fn parse_prop(line: &str) -> Option<Prop> {
    // The value starts at the first ':' outside quotes.
    let mut quoted = false;
    let split = line.char_indices().find(|&(_, c)| {
        if c == '"' {
            quoted = !quoted;
        }
        c == ':' && !quoted
    })?;
    let (head, value) = (&line[..split.0], &line[split.0 + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string()))
        .collect();
    Some(Prop { name, params, value: value.to_string() })
}

fn unesc(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// A date or date-time value: (local wall-clock start, is it a plain date).
fn when(v: &str) -> Option<(NaiveDateTime, bool)> {
    let v = v.trim();
    if v.len() == 8 {
        return NaiveDate::parse_from_str(v, "%Y%m%d").ok().map(|d| (d.and_hms_opt(0, 0, 0).unwrap(), true));
    }
    if let Some(u) = v.strip_suffix('Z') {
        let utc = NaiveDateTime::parse_from_str(u, "%Y%m%dT%H%M%S").ok()?;
        return Some((Local.from_utc_datetime(&utc).naive_local(), false));
    }
    NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok().map(|d| (d, false))
}

/// "P1D", "PT1H30M", "-PT15M", "P1W": minutes (sign kept).
fn duration_min(v: &str) -> Option<i64> {
    let (neg, v) = match v.trim().strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, v.trim().strip_prefix('+').unwrap_or(v.trim())),
    };
    let v = v.strip_prefix('P')?;
    let (mut total, mut num, mut in_time) = (0i64, String::new(), false);
    for c in v.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (c, in_time) {
                    ('W', _) => 7 * 1440,
                    ('D', _) => 1440,
                    ('H', true) => 60,
                    ('M', true) => 1,
                    ('S', true) => 0,
                    _ => return None,
                };
            }
        }
    }
    Some(if neg { -total } else { total })
}

/// Returns the rule and whether it had to be approximated.
fn parse_rrule(v: &str) -> Option<(Recurrence, bool)> {
    let kv: HashMap<String, String> = v.split(';').filter_map(|p| p.split_once('=')).map(|(k, v)| (k.to_ascii_uppercase(), v.to_string())).collect();
    let freq = match kv.get("FREQ")?.to_ascii_uppercase().as_str() {
        "DAILY" => Freq::Daily,
        "WEEKLY" => Freq::Weekly,
        "MONTHLY" => Freq::Monthly,
        "YEARLY" => Freq::Yearly,
        _ => return None,
    };
    let mut approx = false;
    let mut by_weekday = None;
    if let Some(days) = kv.get("BYDAY") {
        let codes: Vec<&str> = days.split(',').collect();
        let plain = codes.iter().all(|c| DAYS.contains(&c.to_ascii_uppercase().as_str()));
        if freq == Freq::Weekly && plain {
            by_weekday = Some(codes.iter().filter_map(|c| DAYS.iter().position(|d| d.eq_ignore_ascii_case(c)).map(|i| i as u8)).collect());
        } else {
            approx = true; // e.g. "2MO" (second Monday) or daily-on-weekdays
        }
    }
    if ["BYMONTHDAY", "BYSETPOS", "BYMONTH", "BYYEARDAY", "BYWEEKNO", "BYHOUR"].iter().any(|k| kv.contains_key(*k)) {
        approx = true;
    }
    Some((
        Recurrence {
            freq,
            interval: kv.get("INTERVAL").and_then(|i| i.parse().ok()).filter(|i| *i >= 1).unwrap_or(1),
            by_weekday,
            until: kv.get("UNTIL").and_then(|u| when(u)).map(|(d, _)| d.date()),
            count: kv.get("COUNT").and_then(|c| c.parse().ok()),
        },
        approx,
    ))
}

#[derive(Default)]
struct Raw {
    uid: Option<String>,
    props: Vec<Prop>,
    alarms: Vec<Vec<Prop>>,
}

fn to_event(raw: &Raw, rep: &mut ImportReport) -> Option<(Event, Option<NaiveDateTime>)> {
    let get = |n: &str| raw.props.iter().find(|p| p.name == n);
    if get("STATUS").map_or(false, |p| p.value.eq_ignore_ascii_case("CANCELLED")) {
        return None;
    }
    let ds = get("DTSTART")?;
    let (start, date_only) = when(&ds.value)?;
    let all_day = date_only || ds.params.get("VALUE").map_or(false, |v| v.eq_ignore_ascii_case("DATE"));
    let end = if all_day {
        None
    } else {
        get("DTEND")
            .and_then(|p| when(&p.value))
            .map(|(e, _)| e)
            .or_else(|| get("DURATION").and_then(|p| duration_min(&p.value)).map(|m| start + Duration::minutes(m)))
            .filter(|e| *e > start)
    };
    let mut notes = get("DESCRIPTION").map(|p| unesc(&p.value)).filter(|s| !s.trim().is_empty());
    if all_day {
        // Elise's all-day events are one day long; keep the real end in the notes.
        if let Some((e, _)) = get("DTEND").and_then(|p| when(&p.value)) {
            if e.date() > start.date() + Duration::days(1) {
                let until = format!("Until {}", (e.date() - Duration::days(1)).format("%Y-%m-%d"));
                notes = Some(notes.map_or(until.clone(), |n| format!("{until}\n{n}")));
            }
        }
    }
    let recurrence = get("RRULE").and_then(|p| parse_rrule(&p.value)).map(|(r, approx)| {
        if approx {
            rep.approximated += 1;
        }
        r
    });
    let exdates: Vec<NaiveDate> = raw
        .props
        .iter()
        .filter(|p| p.name == "EXDATE")
        .flat_map(|p| p.value.split(',').filter_map(|v| when(v).map(|(d, _)| d.date())).collect::<Vec<_>>())
        .collect();
    let mut reminders = vec![];
    for a in &raw.alarms {
        let Some(t) = a.iter().find(|p| p.name == "TRIGGER") else { continue };
        if t.params.get("VALUE").map_or(false, |v| v.eq_ignore_ascii_case("DATE-TIME")) {
            if let Some((at, _)) = when(&t.value) {
                reminders.push(Reminder { id: String::new(), offset_min: None, at_time: None, at: Some(at), created_at: None });
            }
        } else if t.params.get("RELATED").map_or(true, |r| !r.eq_ignore_ascii_case("END")) {
            if let Some(m) = duration_min(&t.value).filter(|m| *m <= 0) {
                reminders.push(Reminder { id: String::new(), offset_min: Some(-m), at_time: None, at: None, created_at: None });
            }
        }
    }
    let recurrence_id = get("RECURRENCE-ID").and_then(|p| when(&p.value)).map(|(d, _)| d);
    Some((
        Event {
            id: String::new(),
            title: get("SUMMARY").map(|p| unesc(&p.value)).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "Untitled".into()),
            start,
            end,
            all_day,
            location: get("LOCATION").map(|p| unesc(&p.value)).filter(|s| !s.trim().is_empty()),
            notes,
            color: None,
            recurrence: if recurrence_id.is_some() { None } else { recurrence },
            exdates,
            parent_id: None,
            reminders,
            created_at: Some(now()),
            updated_at: None,
        },
        recurrence_id,
    ))
}

pub fn import(db: &mut Db, text: &str) -> Result<ImportReport, String> {
    if !text.contains("BEGIN:VCALENDAR") && !text.contains("BEGIN:VEVENT") {
        return Err("That isn't a calendar file (.ics).".into());
    }
    let mut raws: Vec<Raw> = vec![];
    let (mut cur, mut alarm): (Option<Raw>, Option<Vec<Prop>>) = (None, None);
    for line in unfold(text) {
        let Some(p) = parse_prop(&line) else { continue };
        match (p.name.as_str(), p.value.to_ascii_uppercase().as_str()) {
            ("BEGIN", "VEVENT") => cur = Some(Raw::default()),
            ("END", "VEVENT") => raws.extend(cur.take()),
            ("BEGIN", "VALARM") if cur.is_some() => alarm = Some(vec![]),
            ("END", "VALARM") => {
                if let (Some(c), Some(a)) = (cur.as_mut(), alarm.take()) {
                    c.alarms.push(a);
                }
            }
            _ => {
                if let Some(a) = alarm.as_mut() {
                    a.push(p);
                } else if let Some(c) = cur.as_mut() {
                    if p.name == "UID" {
                        c.uid = Some(p.value.clone());
                    }
                    c.props.push(p);
                }
            }
        }
    }

    let mut rep = ImportReport::default();
    let key = |e: &Event| (e.title.trim().to_lowercase(), e.start, e.all_day);
    let mut seen: HashSet<(String, NaiveDateTime, bool)> = db.all_events()?.iter().map(key).collect();
    let mut masters: Vec<(Option<String>, Event)> = vec![];
    let mut overrides: Vec<(Option<String>, NaiveDateTime, Event)> = vec![];
    for raw in &raws {
        match to_event(raw, &mut rep) {
            Some((ev, None)) => masters.push((raw.uid.clone(), ev)),
            Some((ev, Some(rid))) => overrides.push((raw.uid.clone(), rid, ev)),
            None => {
                if !raw.props.iter().any(|p| p.name == "STATUS" && p.value.eq_ignore_ascii_case("CANCELLED")) {
                    rep.failed += 1;
                }
            }
        }
    }
    // A moved or changed occurrence: the series skips that date, and the
    // occurrence comes in as an event of its own.
    for (uid, rid, _) in &overrides {
        if let Some((_, m)) = masters.iter_mut().find(|(u, _)| u.is_some() && u == uid) {
            if !m.exdates.contains(&rid.date()) {
                m.exdates.push(rid.date());
            }
        }
    }
    for ev in masters.into_iter().map(|(_, e)| e).chain(overrides.into_iter().map(|(_, _, e)| e)) {
        if !seen.insert(key(&ev)) {
            rep.skipped += 1;
            continue;
        }
        db.upsert(ev)?;
        rep.added += 1;
    }
    Ok(rep)
}

/// `Elise calendar 2026-11-19.ics` in the given folder (never overwrites).
pub fn export_to(db: &Db, dir: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let text = export(db)?;
    let base = format!("Elise calendar {}", Local::now().format("%Y-%m-%d"));
    let mut path = dir.join(format!("{base}.ics"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} ({n}).ics"));
        n += 1;
    }
    std::fs::write(&path, text).map_err(|e| format!("Couldn't save the file: {e}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(title: &str, start: &str) -> Event {
        let s = NaiveDateTime::parse_from_str(start, "%Y-%m-%dT%H:%M").unwrap();
        Event {
            id: String::new(),
            title: title.into(),
            start: s,
            end: Some(s + Duration::minutes(60)),
            all_day: false,
            location: None,
            notes: None,
            color: None,
            recurrence: None,
            exdates: vec![],
            parent_id: None,
            reminders: vec![],
            created_at: None,
            updated_at: None,
        }
    }

    #[test]
    fn round_trip() {
        let mut a = Db::memory().unwrap();
        let mut gym = ev("Gym, legs; heavy", "2027-03-01T18:00");
        gym.notes = Some("Bring\nwater".into());
        gym.recurrence = Some(Recurrence { freq: Freq::Weekly, interval: 1, by_weekday: Some(vec![0, 3]), until: None, count: None });
        gym.exdates = vec![NaiveDate::from_ymd_opt(2027, 3, 4).unwrap()];
        gym.reminders = vec![Reminder { id: String::new(), offset_min: Some(30), at_time: None, at: None, created_at: None }];
        a.upsert(gym).unwrap();
        let mut bday = ev("Ayşe's birthday", "2027-03-20T00:00");
        bday.all_day = true;
        bday.end = None;
        bday.recurrence = Some(Recurrence { freq: Freq::Yearly, interval: 1, by_weekday: None, until: None, count: None });
        a.upsert(bday).unwrap();

        let text = export(&a).unwrap();
        assert!(text.contains("SUMMARY:Gym\\, legs\\; heavy"), "{text}");
        assert!(text.contains("RRULE:FREQ=WEEKLY;BYDAY=MO,TH"));
        assert!(text.contains("DTSTART;VALUE=DATE:20270320"));
        assert!(text.lines().all(|l| l.len() <= 75));

        let mut b = Db::memory().unwrap();
        let rep = import(&mut b, &text).unwrap();
        assert_eq!(rep, ImportReport { added: 2, skipped: 0, approximated: 0, failed: 0 });
        let got = b.all_events().unwrap();
        let g = got.iter().find(|e| e.title.starts_with("Gym")).unwrap();
        assert_eq!(g.title, "Gym, legs; heavy");
        assert_eq!(g.notes.as_deref(), Some("Bring\nwater"));
        assert_eq!(g.recurrence.as_ref().unwrap().by_weekday, Some(vec![0, 3]));
        assert_eq!(g.exdates, vec![NaiveDate::from_ymd_opt(2027, 3, 4).unwrap()]);
        assert_eq!(g.reminders[0].offset_min, Some(30));
        assert_eq!(g.end.unwrap() - g.start, Duration::minutes(60));
        let d = got.iter().find(|e| e.all_day).unwrap();
        assert_eq!(d.recurrence.as_ref().unwrap().freq, Freq::Yearly);

        // Importing the same file again adds nothing.
        let again = import(&mut b, &text).unwrap();
        assert_eq!((again.added, again.skipped), (0, 2));
    }

    #[test]
    fn google_style_file() {
        let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc@google.com\r\nDTSTART;TZID=Europe/Istanbul:20270302T100000\r\nDURATION:PT1H30M\r\nSUMMARY:Team sync\r\nRRULE:FREQ=MONTHLY;BYDAY=1TU\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:abc@google.com\r\nRECURRENCE-ID;TZID=Europe/Istanbul:20270406T100000\r\nDTSTART;TZID=Europe/Istanbul:20270407T110000\r\nDTEND;TZID=Europe/Istanbul:20270407T120000\r\nSUMMARY:Team sync (moved)\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20270310\r\nDTEND;VALUE=DATE:20270313\r\nSUMMARY:Trip to Izmir with a very long title that goes on and on so the line has to be fol\r\n ded\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nDTSTART:20270305T090000Z\r\nSUMMARY:Cancelled thing\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let mut db = Db::memory().unwrap();
        let rep = import(&mut db, text).unwrap();
        assert_eq!(rep, ImportReport { added: 3, skipped: 0, approximated: 1, failed: 0 });
        let all = db.all_events().unwrap();
        let sync = all.iter().find(|e| e.title == "Team sync").unwrap();
        assert_eq!(sync.end.unwrap() - sync.start, Duration::minutes(90));
        assert_eq!(sync.recurrence.as_ref().unwrap().freq, Freq::Monthly);
        assert_eq!(sync.exdates, vec![NaiveDate::from_ymd_opt(2027, 4, 6).unwrap()]);
        assert_eq!(sync.reminders[0].offset_min, Some(1440));
        assert!(all.iter().any(|e| e.title == "Team sync (moved)" && e.recurrence.is_none()));
        let trip = all.iter().find(|e| e.title.starts_with("Trip")).unwrap();
        assert!(trip.all_day && trip.title.ends_with("folded"), "{}", trip.title);
        assert_eq!(trip.notes.as_deref(), Some("Until 2027-03-12"));
        assert!(import(&mut db, "hello").is_err());
    }
}
