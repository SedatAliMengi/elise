//! Daily and weekly briefings ("how's my day?", "brief me on next week").
//!
//! Everything here is worked out locally from the calendar: what's on, what
//! clashes, where the free time is. The command engine gets the facts as text
//! and speaks a short summary; the panel shows the agenda lines.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime};

use crate::db::Db;
use crate::events;
use crate::model::Occurrence;

/// Free time is only looked for inside the waking day.
const DAY_START: u32 = 8;
const DAY_END: u32 = 22;
/// Gaps shorter than this aren't worth mentioning.
const MIN_FREE_MIN: i64 = 60;

pub struct Briefing {
    /// Facts for the model, one per line.
    pub facts: String,
    /// What the panel shows under her answer.
    pub agenda: Vec<String>,
}

fn hm(t: NaiveDateTime) -> String {
    t.format("%H:%M").to_string()
}

fn label(o: &Occurrence) -> String {
    let mut s = o.event.title.clone();
    if let Some(l) = &o.event.location {
        s.push_str(&format!(" · {l}"));
    }
    s
}

/// Timed occurrences that overlap, as pairs of titles with the overlap start.
fn clashes(timed: &[&Occurrence]) -> Vec<(String, String, NaiveDateTime)> {
    let mut out = Vec::new();
    for (i, a) in timed.iter().enumerate() {
        for b in &timed[i + 1..] {
            if b.start < a.end && a.start < b.end {
                out.push((a.event.title.clone(), b.event.title.clone(), a.start.max(b.start)));
            }
        }
    }
    out
}

/// Free blocks of at least an hour between DAY_START and DAY_END, starting no
/// earlier than `not_before` (so "today" only counts the time still ahead).
fn free_blocks(day: NaiveDate, timed: &[&Occurrence], not_before: NaiveDateTime) -> Vec<(NaiveDateTime, NaiveDateTime)> {
    let open = day.and_time(NaiveTime::from_hms_opt(DAY_START, 0, 0).unwrap()).max(not_before);
    let close = day.and_time(NaiveTime::from_hms_opt(DAY_END, 0, 0).unwrap());
    let mut busy: Vec<(NaiveDateTime, NaiveDateTime)> = timed.iter().map(|o| (o.start, o.end)).collect();
    busy.sort();
    let mut out = Vec::new();
    let mut cur = open;
    for (s, e) in busy {
        if s > cur && (s.min(close) - cur).num_minutes() >= MIN_FREE_MIN {
            out.push((cur, s.min(close)));
        }
        cur = cur.max(e);
        if cur >= close {
            break;
        }
    }
    if cur < close && (close - cur).num_minutes() >= MIN_FREE_MIN {
        out.push((cur, close));
    }
    out
}

struct DayInfo<'a> {
    date: NaiveDate,
    all_day: Vec<&'a Occurrence>,
    timed: Vec<&'a Occurrence>,
    clashes: Vec<(String, String, NaiveDateTime)>,
    free: Vec<(NaiveDateTime, NaiveDateTime)>,
}

fn day_info<'a>(date: NaiveDate, occ: &'a [Occurrence], now: NaiveDateTime) -> DayInfo<'a> {
    let start = date.and_hms_opt(0, 0, 0).unwrap();
    let end = start + Duration::days(1);
    let mine: Vec<&Occurrence> = occ.iter().filter(|o| o.start < end && (o.end > start || o.start >= start)).collect();
    let all_day: Vec<&Occurrence> = mine.iter().copied().filter(|o| o.event.all_day).collect();
    let mut timed: Vec<&Occurrence> = mine.iter().copied().filter(|o| !o.event.all_day && o.start >= start).collect();
    timed.sort_by_key(|o| o.start);
    let not_before = if date == now.date() { now } else { start };
    DayInfo { date, clashes: clashes(&timed), free: free_blocks(date, &timed, not_before), all_day, timed }
}

fn when(date: NaiveDate, today: NaiveDate) -> String {
    match (date - today).num_days() {
        0 => format!("Today ({})", date.format("%a %Y-%m-%d")),
        1 => format!("Tomorrow ({})", date.format("%a %Y-%m-%d")),
        _ => date.format("%A %Y-%m-%d").to_string(),
    }
}

/// `period` is "day" or "week"; a week is the 7 days starting at `date`.
pub fn build(db: &Db, period: &str, date: NaiveDate, now: NaiveDateTime) -> Result<Briefing, String> {
    let days = if period == "week" { 7 } else { 1 };
    let from = date.and_hms_opt(0, 0, 0).unwrap();
    let to = from + Duration::days(days);
    let occ = events::list_occurrences(db, from, to)?;
    let infos: Vec<DayInfo> = (0..days).map(|i| day_info(date + Duration::days(i), &occ, now)).collect();
    let today = now.date();

    let mut facts = Vec::new();
    let mut agenda = Vec::new();

    if days == 1 {
        let d = &infos[0];
        facts.push(format!("Briefing for {}.", when(d.date, today)));
        if d.date == today {
            facts.push(format!("It is now {}.", hm(now)));
        }
        for o in &d.all_day {
            facts.push(format!("All day: {}", label(o)));
            agenda.push(format!("All day · {}", label(o)));
        }
        for o in &d.timed {
            let past = d.date == today && o.end <= now;
            facts.push(format!("{}-{} {}{}", hm(o.start), hm(o.end), label(o), if past { " (already over)" } else { "" }));
            if !past {
                agenda.push(format!("{}–{} · {}", hm(o.start), hm(o.end), label(o)));
            }
        }
        if d.all_day.is_empty() && d.timed.is_empty() {
            facts.push("Nothing is planned.".into());
            agenda.push("Nothing planned".into());
        }
        for (a, b, t) in &d.clashes {
            facts.push(format!("Clash: {a} and {b} overlap at {}.", hm(*t)));
            agenda.push(format!("⚠ Clash at {} · {a} / {b}", hm(*t)));
        }
        if !d.timed.is_empty() || d.date != today {
            for (s, e) in &d.free {
                facts.push(format!("Free: {}-{}", hm(*s), hm(*e)));
            }
            if let Some((s, e)) = d.free.iter().max_by_key(|(s, e)| *e - *s) {
                agenda.push(format!("Free · {}–{}", hm(*s), hm(*e)));
            }
        }
    } else {
        facts.push(format!(
            "Briefing for the 7 days from {} to {}.",
            when(date, today),
            (date + Duration::days(6)).format("%A %Y-%m-%d")
        ));
        let total: usize = infos.iter().map(|d| d.timed.len() + d.all_day.len()).sum();
        facts.push(format!("{total} events in total."));
        for d in &infos {
            let n = d.timed.len() + d.all_day.len();
            let mut items: Vec<String> = d.all_day.iter().map(|o| format!("{} (all day)", label(o))).collect();
            items.extend(d.timed.iter().map(|o| format!("{} {}", hm(o.start), label(o))));
            let free_h: i64 = d.free.iter().map(|(s, e)| (*e - *s).num_minutes()).sum::<i64>() / 60;
            facts.push(format!(
                "{}: {}{}; about {free_h} free hours between {DAY_START}:00 and {DAY_END}:00.",
                when(d.date, today),
                if n == 0 { "nothing".into() } else { items.join(", ") },
                if d.clashes.is_empty() {
                    String::new()
                } else {
                    format!("; clashes: {}", d.clashes.iter().map(|(a, b, t)| format!("{a} / {b} at {}", hm(*t))).collect::<Vec<_>>().join(", "))
                }
            ));
            let short: Vec<String> = d
                .all_day
                .iter()
                .map(|o| o.event.title.clone())
                .chain(d.timed.iter().map(|o| format!("{} {}", hm(o.start), o.event.title)))
                .collect();
            let head = format!("{} {}", d.date.format("%a"), d.date.day());
            agenda.push(match (n, d.clashes.is_empty()) {
                (0, _) => format!("{head} · free"),
                (_, true) => format!("{head} · {}", ellipsize(&short, 3)),
                (_, false) => format!("{head} · ⚠ {}", ellipsize(&short, 3)),
            });
        }
        if let Some(busiest) = infos.iter().filter(|d| !d.timed.is_empty() || !d.all_day.is_empty()).max_by_key(|d| d.timed.len() + d.all_day.len()) {
            facts.push(format!("Busiest day: {}.", busiest.date.format("%A")));
        }
        let empty: Vec<String> = infos.iter().filter(|d| d.timed.is_empty() && d.all_day.is_empty()).map(|d| d.date.format("%A").to_string()).collect();
        if !empty.is_empty() {
            facts.push(format!("Completely free days: {}.", empty.join(", ")));
        }
    }
    Ok(Briefing { facts: facts.join("\n"), agenda })
}

fn ellipsize(items: &[String], max: usize) -> String {
    if items.len() <= max {
        items.join(", ")
    } else {
        format!("{} +{} more", items[..max].join(", "), items.len() - max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Event;

    fn ev(title: &str, start: &str, mins: i64) -> Event {
        let s = NaiveDateTime::parse_from_str(start, "%Y-%m-%dT%H:%M").unwrap();
        Event {
            id: String::new(),
            title: title.into(),
            start: s,
            end: Some(s + Duration::minutes(mins)),
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
    fn day_with_clash_and_free_time() {
        let mut db = Db::memory().unwrap();
        events::create(&mut db, ev("Dentist", "2027-03-02T10:00", 60)).unwrap();
        events::create(&mut db, ev("Call", "2027-03-02T10:30", 30)).unwrap();
        events::create(&mut db, ev("Gym", "2027-03-02T18:00", 90)).unwrap();
        let now = NaiveDateTime::parse_from_str("2027-03-01T20:00", "%Y-%m-%dT%H:%M").unwrap();
        let b = build(&db, "day", NaiveDate::from_ymd_opt(2027, 3, 2).unwrap(), now).unwrap();
        assert!(b.facts.contains("Clash: Dentist and Call overlap at 10:30"), "{}", b.facts);
        assert!(b.facts.contains("Free: 11:00-18:00"), "{}", b.facts);
        assert!(b.facts.contains("Free: 08:00-10:00"), "{}", b.facts);
        assert!(b.agenda.iter().any(|l| l == "Free · 11:00–18:00"), "{:?}", b.agenda);
    }

    #[test]
    fn week_lists_every_day() {
        let mut db = Db::memory().unwrap();
        events::create(&mut db, ev("Gym", "2027-03-03T18:00", 90)).unwrap();
        let now = NaiveDateTime::parse_from_str("2027-03-01T09:00", "%Y-%m-%dT%H:%M").unwrap();
        let b = build(&db, "week", NaiveDate::from_ymd_opt(2027, 3, 1).unwrap(), now).unwrap();
        assert_eq!(b.agenda.len(), 7);
        assert_eq!(b.agenda[2], "Wed 3 · 18:00 Gym");
        assert!(b.facts.contains("1 events in total"));
        assert!(b.facts.contains("Busiest day: Wednesday"));
    }
}
