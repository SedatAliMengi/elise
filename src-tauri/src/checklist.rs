//! Yearly checklist: one list per year.
//!  - this year: add, remove and tick things off
//!  - past years: read and tick (for the end-of-year review), but not add/remove
//!  - future years: locked until they arrive
//! On the last day of the year Elise appears and asks to go through the list.

use chrono::{Datelike, NaiveDateTime, NaiveTime};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now, Db};
use crate::AppState;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub year: i32,
    pub text: String,
    pub done: bool,
    pub done_at: Option<NaiveDateTime>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistView {
    pub year: i32,
    pub current_year: i32,
    pub items: Vec<ChecklistItem>,
    /// Add and remove items (only the current year).
    pub can_edit: bool,
    /// Tick items off (current and past years).
    pub can_tick: bool,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct YearPrompt {
    pub year: i32,
    /// The PC was off on the last day: shown in the first week of January instead.
    pub missed: bool,
}

/// Error text the UI recognises: the year hasn't come yet.
pub const FUTURE: &str = "future";
const MAX_TEXT: usize = 300;

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Access {
    pub view: bool,
    pub tick: bool,
    pub edit: bool,
}

pub fn access(year: i32, current: i32) -> Access {
    Access { view: year <= current, tick: year <= current, edit: year == current }
}

pub fn view(db: &Db, year: i32, current: i32) -> Result<ChecklistView, String> {
    let a = access(year, current);
    if !a.view {
        return Err(FUTURE.into());
    }
    Ok(ChecklistView { year, current_year: current, items: db.checklist(year)?, can_edit: a.edit, can_tick: a.tick })
}

pub fn add(db: &Db, year: i32, text: &str, current: i32) -> Result<ChecklistItem, String> {
    let a = access(year, current);
    if !a.view {
        return Err(FUTURE.into());
    }
    if !a.edit {
        return Err(format!("{year} is over: its list can be ticked, but not changed."));
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("Write something to add.".into());
    }
    let text: String = text.chars().take(MAX_TEXT).collect();
    db.checklist_add(year, &text)
}

pub fn set_done(db: &Db, id: &str, done: bool, current: i32) -> Result<(), String> {
    let item = db.checklist_item(id)?.ok_or("That item no longer exists.")?;
    if !access(item.year, current).tick {
        return Err(FUTURE.into());
    }
    db.checklist_set_done(id, done)
}

pub fn remove(db: &Db, id: &str, current: i32) -> Result<(), String> {
    let Some(item) = db.checklist_item(id)? else { return Ok(()) };
    if !access(item.year, current).edit {
        return Err(format!("{} is over: its list can be ticked, but not changed.", item.year));
    }
    db.checklist_remove(id)
}

fn prompted_key(year: i32) -> String {
    format!("checklist_prompted_{year}")
}

/// Which year-end prompt (if any) is due at `now`. The last day of the year, from
/// the default reminder time on; if the PC was off all that day, the first week of
/// January catches up (only when the list has something on it).
pub fn due_prompt(now: NaiveDateTime, at: NaiveTime, prompted: impl Fn(i32) -> bool, has_items: impl Fn(i32) -> bool) -> Option<YearPrompt> {
    let y = now.year();
    if now.month() == 12 && now.day() == 31 && now.time() >= at && !prompted(y) {
        return Some(YearPrompt { year: y, missed: false });
    }
    if now.month() == 1 && now.day() <= 7 && !prompted(y - 1) && has_items(y - 1) {
        return Some(YearPrompt { year: y - 1, missed: true });
    }
    None
}

/// Called from the scheduler loop (at least once a minute).
pub fn check_year_end(app: &AppHandle, at: NaiveTime) -> Result<(), String> {
    let state = app.state::<AppState>();
    let n = now();
    let prompt = {
        let db = state.db.lock().unwrap();
        let p = due_prompt(
            n,
            at,
            |y| db.meta_get(&prompted_key(y)).ok().flatten().is_some(),
            |y| db.checklist(y).map(|v| !v.is_empty()).unwrap_or(false),
        );
        if let Some(p) = p {
            db.meta_set(&prompted_key(p.year), &n.to_string())?;
        }
        p
    };
    if let Some(p) = prompt {
        *state.pending_year_prompt.lock().unwrap() = Some(p);
        crate::overlay::show_year_prompt(app);
    }
    Ok(())
}

/// Open the calendar on a year's checklist.
pub fn open(app: &AppHandle, year: i32) {
    crate::show_main(app, false);
    let _ = app.emit_to("main", "open-checklist", year);
}

pub fn current_year() -> i32 {
    now().year()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }
    const NINE: NaiveTime = NaiveTime::from_hms_opt(9, 0, 0).unwrap();

    #[test]
    fn year_rules() {
        assert_eq!(access(2026, 2026), Access { view: true, tick: true, edit: true });
        assert_eq!(access(2025, 2026), Access { view: true, tick: true, edit: false });
        assert_eq!(access(2027, 2026), Access { view: false, tick: false, edit: false });

        let db = Db::memory().unwrap();
        let item = add(&db, 2026, "  Learn to swim  ", 2026).unwrap();
        assert_eq!(item.text, "Learn to swim");
        assert_eq!(add(&db, 2027, "Too early", 2026).unwrap_err(), FUTURE);
        assert_eq!(view(&db, 2027, 2026).unwrap_err(), FUTURE);
        assert!(add(&db, 2026, "   ", 2026).is_err());

        // A year later: 2026 can still be ticked but not changed.
        set_done(&db, &item.id, true, 2027).unwrap();
        let v = view(&db, 2026, 2027).unwrap();
        assert!(v.items[0].done && v.items[0].done_at.is_some());
        assert!(!v.can_edit && v.can_tick);
        assert!(add(&db, 2026, "Late idea", 2027).is_err());
        assert!(remove(&db, &item.id, 2027).is_err());
        remove(&db, &item.id, 2026).unwrap();
        assert!(view(&db, 2026, 2026).unwrap().items.is_empty());
    }

    #[test]
    fn order_is_kept() {
        let db = Db::memory().unwrap();
        for t in ["one", "two", "three"] {
            add(&db, 2026, t, 2026).unwrap();
        }
        let texts: Vec<_> = db.checklist(2026).unwrap().into_iter().map(|i| i.text).collect();
        assert_eq!(texts, ["one", "two", "three"]);
        assert_eq!(db.checklist_years().unwrap(), [2026]);
    }

    #[test]
    fn year_end_prompt_timing() {
        let never = |_: i32| false;
        let has = |_: i32| true;
        let empty = |_: i32| false;
        // Last day, before and after the reminder time.
        assert_eq!(due_prompt(dt("2026-12-31 08:59"), NINE, never, has), None);
        assert_eq!(due_prompt(dt("2026-12-31 09:00"), NINE, never, has), Some(YearPrompt { year: 2026, missed: false }));
        // Shown even with an empty list on the day itself, but only once.
        assert!(due_prompt(dt("2026-12-31 22:00"), NINE, never, empty).is_some());
        assert_eq!(due_prompt(dt("2026-12-31 22:00"), NINE, |y| y == 2026, has), None);
        // Other days: nothing.
        assert_eq!(due_prompt(dt("2026-12-30 23:59"), NINE, never, has), None);
        // PC off on Dec 31: caught up in the first week of January, if the list has items.
        assert_eq!(due_prompt(dt("2027-01-02 10:00"), NINE, never, has), Some(YearPrompt { year: 2026, missed: true }));
        assert_eq!(due_prompt(dt("2027-01-02 10:00"), NINE, never, empty), None);
        assert_eq!(due_prompt(dt("2027-01-08 10:00"), NINE, never, has), None);
        assert_eq!(due_prompt(dt("2027-01-02 10:00"), NINE, |y| y == 2026, has), None);
    }

    #[test]
    fn prompt_is_remembered() {
        let db = Db::memory().unwrap();
        assert!(db.meta_get(&prompted_key(2026)).unwrap().is_none());
        db.meta_set(&prompted_key(2026), "x").unwrap();
        db.meta_set(&prompted_key(2026), "y").unwrap();
        assert_eq!(db.meta_get(&prompted_key(2026)).unwrap().as_deref(), Some("y"));
    }
}
