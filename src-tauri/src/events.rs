//! Calendar operations shared by the UI and the command engine.

use chrono::{Duration, NaiveDateTime};
use serde::Deserialize;

use crate::db::{Db, DbResult};
use crate::model::{Change, Event, Occurrence};
use crate::recur;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    This,
    Following,
    #[default]
    All,
}

pub fn list_occurrences(db: &Db, from: NaiveDateTime, to: NaiveDateTime) -> DbResult<Vec<Occurrence>> {
    let mut out = Vec::new();
    for ev in db.events_in_range(from, to)? {
        let dur = recur::duration(&ev);
        for s in recur::occurrence_starts(&ev, from, to) {
            out.push(Occurrence { event: ev.clone(), start: s, end: s + dur });
        }
    }
    out.sort_by(|a, b| (!a.event.all_day, a.start).cmp(&(!b.event.all_day, b.start)));
    Ok(out)
}

fn load(db: &Db, id: &str) -> DbResult<Event> {
    db.get_event(id)?.ok_or_else(|| "That event no longer exists.".to_string())
}

/// Number of occurrences strictly before `date` (for splitting counted series).
fn count_before(ev: &Event, before: NaiveDateTime) -> u32 {
    let mut probe = ev.clone();
    probe.exdates.clear();
    recur::occurrence_starts(&probe, ev.start - Duration::days(1), before).len() as u32
}

/// Create a brand-new event.
pub fn create(db: &mut Db, mut ev: Event) -> DbResult<(Event, Vec<Change>)> {
    ev.id.clear();
    let (saved, c) = db.upsert(ev)?;
    Ok((saved, vec![c]))
}

/// Edit an event. `edited.start/end` describe the edited *occurrence*;
/// `occ_start` is the original start of that occurrence (None = the series start).
pub fn edit(db: &mut Db, id: &str, occ_start: Option<NaiveDateTime>, scope: Scope, mut edited: Event) -> DbResult<(Event, Vec<Change>)> {
    let series = load(db, id)?;
    let occ_start = occ_start.unwrap_or(series.start);
    let is_series = series.recurrence.is_some();
    let len = edited.end.map(|e| e - edited.start);

    if !is_series || scope == Scope::All || (scope == Scope::Following && occ_start.date() <= series.start.date()) {
        let mut next = edited.clone();
        next.id = series.id.clone();
        next.parent_id = series.parent_id.clone();
        next.created_at = series.created_at;
        if is_series {
            let delta = edited.start - occ_start;
            next.start = series.start + delta;
            next.end = len.map(|l| next.start + l);
            if next.recurrence.is_some() {
                next.exdates = series.exdates.clone();
            }
        }
        let (saved, c) = db.upsert(next)?;
        return Ok((saved, vec![c]));
    }

    let mut changes = Vec::new();
    let mut old = series.clone();
    match scope {
        Scope::This => {
            old.exdates.push(occ_start.date());
            edited.recurrence = None;
            edited.parent_id = Some(series.id.clone());
        }
        Scope::Following => {
            let rec = old.recurrence.as_mut().unwrap();
            let split = occ_start.date() - Duration::days(1);
            if let Some(c) = rec.count {
                let n = count_before(&series, occ_start);
                rec.count = Some(n);
                if let Some(r) = edited.recurrence.as_mut() {
                    r.count = Some(c.saturating_sub(n).max(1));
                }
            } else {
                rec.until = Some(rec.until.map_or(split, |u| u.min(split)));
            }
            edited.exdates = series.exdates.iter().copied().filter(|d| *d >= edited.start.date()).collect();
            edited.parent_id = None;
        }
        Scope::All => unreachable!(),
    }
    changes.push(db.upsert(old)?.1);
    edited.id.clear();
    let (saved, c) = db.upsert(edited)?;
    changes.push(c);
    Ok((saved, changes))
}

/// Delete an event, one occurrence, or this-and-following.
pub fn remove(db: &mut Db, id: &str, occ_start: Option<NaiveDateTime>, scope: Scope) -> DbResult<Vec<Change>> {
    let series = load(db, id)?;
    let occ = occ_start.unwrap_or(series.start);
    let whole = series.recurrence.is_none()
        || scope == Scope::All
        || (scope == Scope::Following && occ.date() <= series.start.date());
    if whole {
        return Ok(db.delete(id)?.into_iter().collect());
    }
    let mut next = series.clone();
    match scope {
        Scope::This => next.exdates.push(occ.date()),
        Scope::Following => {
            let rec = next.recurrence.as_mut().unwrap();
            if rec.count.is_some() {
                rec.count = Some(count_before(&series, occ));
            } else {
                let split = occ.date() - Duration::days(1);
                rec.until = Some(rec.until.map_or(split, |u| u.min(split)));
            }
        }
        Scope::All => unreachable!(),
    }
    Ok(vec![db.upsert(next)?.1])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    fn weekly() -> Event {
        serde_json::from_value(serde_json::json!({
            "title": "Gym",
            "start": "2026-10-05T18:00:00",
            "end": "2026-10-05T19:00:00",
            "recurrence": {"freq": "weekly"}
        }))
        .unwrap()
    }

    #[test]
    fn edit_this_occurrence_splits_out() {
        let mut db = Db::memory().unwrap();
        let (s, _) = create(&mut db, weekly()).unwrap();
        let mut e = s.clone();
        e.start = dt("2026-10-13 20:00");
        e.end = Some(dt("2026-10-13 21:00"));
        let (single, ch) = edit(&mut db, &s.id, Some(dt("2026-10-12 18:00")), Scope::This, e).unwrap();
        assert_eq!(ch.len(), 2);
        assert!(single.recurrence.is_none());
        let occ = list_occurrences(&db, dt("2026-10-12 00:00"), dt("2026-10-19 00:00")).unwrap();
        assert_eq!(occ.len(), 1);
        assert_eq!(occ[0].start, dt("2026-10-13 20:00"));
    }

    #[test]
    fn move_all_shifts_series() {
        let mut db = Db::memory().unwrap();
        let (s, _) = create(&mut db, weekly()).unwrap();
        let mut e = s.clone();
        e.start = dt("2026-10-12 19:00"); // second occurrence, one hour later
        e.end = Some(dt("2026-10-12 20:00"));
        let (saved, _) = edit(&mut db, &s.id, Some(dt("2026-10-12 18:00")), Scope::All, e).unwrap();
        assert_eq!(saved.start, dt("2026-10-05 19:00"));
    }

    #[test]
    fn delete_following() {
        let mut db = Db::memory().unwrap();
        let (s, _) = create(&mut db, weekly()).unwrap();
        remove(&mut db, &s.id, Some(dt("2026-10-19 18:00")), Scope::Following).unwrap();
        let occ = list_occurrences(&db, dt("2026-10-01 00:00"), dt("2027-01-01 00:00")).unwrap();
        assert_eq!(occ.len(), 2);
    }
}
