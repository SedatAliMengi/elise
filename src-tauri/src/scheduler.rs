//! Reminder scheduler: a background thread that sleeps until the next due
//! reminder (capped at 60 s so sleep/wake and clock changes are picked up),
//! and wakes early whenever events change.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::time::Duration as StdDuration;

use chrono::{Duration, NaiveDateTime, NaiveTime};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::db::{now, Db};
use crate::model::{Event, Reminder};
use crate::{recur, AppState};

/// How long after an event starts a missed reminder is still worth showing.
const MISSED_GRACE_H: i64 = 24;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPayload {
    pub reminder_id: String,
    pub occ_key: String,
    pub event_id: String,
    pub title: String,
    pub start: NaiveDateTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub missed: bool,
}

pub fn start(app: AppHandle) -> Sender<()> {
    let (tx, rx) = channel::<()>();
    std::thread::Builder::new()
        .name("elise-scheduler".into())
        .spawn(move || loop {
            let wait = tick(&app).unwrap_or(StdDuration::from_secs(60));
            match rx.recv_timeout(wait) {
                Ok(()) | Err(RecvTimeoutError::Timeout) => {
                    // Coalesce bursts of change notifications.
                    while rx.try_recv().is_ok() {}
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        })
        .expect("spawn scheduler");
    tx
}

fn occ_key(rem: &Reminder, occ: NaiveDateTime) -> String {
    if rem.at.is_some() {
        "abs".into()
    } else {
        occ.format("%Y-%m-%dT%H:%M").to_string()
    }
}

struct Due {
    ev: Event,
    rem: Reminder,
    occ: NaiveDateTime,
    fire: NaiveDateTime,
}

/// Find due reminders and the next future fire time.
fn scan(db: &Db, now: NaiveDateTime, default_time: NaiveTime) -> Result<(Vec<Due>, Option<NaiveDateTime>), String> {
    let mut due = Vec::new();
    let mut next: Option<NaiveDateTime> = None;
    let mut bump = |t: NaiveDateTime| {
        if t > now && next.map_or(true, |n| t < n) {
            next = Some(t);
        }
    };
    let grace = Duration::hours(MISSED_GRACE_H);
    let events = db.events_with_reminders()?;

    for ev in &events {
        let max_days = ev
            .reminders
            .iter()
            .filter_map(|r| r.offset_min)
            .max()
            .unwrap_or(0)
            / 1440
            + 2;
        let occs = recur::occurrence_starts(ev, now - grace, now + Duration::days(max_days));
        for rem in &ev.reminders {
            let created = rem.created_at.unwrap_or(NaiveDateTime::MIN);
            let candidates: Vec<NaiveDateTime> = if rem.at.is_some() { vec![ev.start] } else { occs.clone() };
            for occ in candidates {
                let Some(fire) = recur::fire_time(rem, ev.all_day, occ, default_time) else { continue };
                if fire > now {
                    bump(fire);
                    continue;
                }
                let stale = if rem.at.is_some() { fire < now - grace } else { occ + grace < now };
                if fire < created || stale {
                    continue;
                }
                if db.log_status(&rem.id, &occ_key(rem, occ))?.is_none() {
                    due.push(Due { ev: ev.clone(), rem: rem.clone(), occ, fire });
                }
            }
        }
    }

    for (rid, key, until) in db.snoozed()? {
        if until > now {
            bump(until);
            continue;
        }
        let found = events.iter().find_map(|ev| ev.reminders.iter().find(|r| r.id == rid).map(|r| (ev, r)));
        let Some((ev, rem)) = found else { continue };
        let occ = if key == "abs" {
            ev.start
        } else {
            NaiveDateTime::parse_from_str(&key, "%Y-%m-%dT%H:%M").unwrap_or(ev.start)
        };
        due.push(Due { ev: ev.clone(), rem: rem.clone(), occ, fire: until });
    }
    due.sort_by_key(|d| d.fire);
    Ok((due, next))
}

fn tick(app: &AppHandle) -> Result<StdDuration, String> {
    let state = app.state::<AppState>();
    let default_time = {
        let s = state.settings.lock().unwrap();
        recur::parse_hhmm(&s.default_reminder_time).unwrap_or(NaiveTime::from_hms_opt(9, 0, 0).unwrap())
    };
    let n = now();
    let (due, next) = {
        let db = state.db.lock().unwrap();
        let (due, next) = scan(&db, n, default_time)?;
        for d in &due {
            db.set_log(&d.rem.id, &occ_key(&d.rem, d.occ), "fired", None)?;
        }
        (due, next)
    };
    for d in due {
        let payload = ReminderPayload {
            reminder_id: d.rem.id.clone(),
            occ_key: occ_key(&d.rem, d.occ),
            event_id: d.ev.id.clone(),
            title: d.ev.title.clone(),
            start: d.occ,
            all_day: d.ev.all_day,
            location: d.ev.location.clone(),
            missed: n - d.fire > Duration::minutes(2),
        };
        crate::overlay::show_reminder(app, payload);
    }
    let wait = next
        .map(|t| (t - n).to_std().unwrap_or_default())
        .unwrap_or(StdDuration::from_secs(60))
        .min(StdDuration::from_secs(60))
        .max(StdDuration::from_millis(250));
    Ok(wait)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn due_and_next() {
        let mut db = Db::memory().unwrap();
        let ev: Event = serde_json::from_value(serde_json::json!({
            "title": "Doctor",
            "start": "2027-07-05T22:00:00",
            "reminders": [
                {"offsetMin": 2880, "atTime": "09:00", "createdAt": "2027-01-01T00:00:00"},
                {"offsetMin": 1440, "atTime": "09:00", "createdAt": "2027-01-01T00:00:00"}
            ]
        }))
        .unwrap();
        let (ev, _) = db.upsert(ev).unwrap();
        // upsert stamps created_at = now (2026), which is before 2027 fire times.
        let nine = NaiveTime::from_hms_opt(9, 0, 0).unwrap();

        let (due, next) = scan(&db, dt("2027-07-03 08:00"), nine).unwrap();
        assert!(due.is_empty());
        assert_eq!(next, Some(dt("2027-07-03 09:00")));

        let (due, next) = scan(&db, dt("2027-07-03 09:00"), nine).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(next, Some(dt("2027-07-04 09:00")));
        db.set_log(&due[0].rem.id, &occ_key(&due[0].rem, due[0].occ), "fired", None).unwrap();
        assert!(scan(&db, dt("2027-07-03 09:01"), nine).unwrap().0.is_empty());

        // Missed while off: both show later, as long as the event isn't >24h past.
        let (due, _) = scan(&db, dt("2027-07-05 10:00"), nine).unwrap();
        assert_eq!(due.len(), 1);
        assert!(scan(&db, dt("2027-07-07 10:00"), nine).unwrap().0.is_empty());
        let _ = ev;
    }
}
