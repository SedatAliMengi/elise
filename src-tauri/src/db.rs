//! SQLite storage. Events keep recurrence/exdates as JSON columns; reminders
//! live in their own table. The whole API works on full `Event` values.

use std::path::Path;

use chrono::{Local, NaiveDateTime};
use rusqlite::{params, Connection, OptionalExtension};

use crate::model::{Change, Event, Reminder};

pub type DbResult<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

pub fn now() -> NaiveDateTime {
    // Second precision keeps stored values tidy.
    let n = Local::now().naive_local();
    n - chrono::Duration::nanoseconds(n.and_utc().timestamp_subsec_nanos() as i64)
}

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> DbResult<Self> {
        let conn = Connection::open(path).map_err(e)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn memory() -> DbResult<Self> {
        Self::init(Connection::open_in_memory().map_err(e)?)
    }

    fn init(conn: Connection) -> DbResult<Self> {
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                start TEXT NOT NULL,
                end TEXT,
                all_day INTEGER NOT NULL DEFAULT 0,
                location TEXT,
                notes TEXT,
                color TEXT,
                recurrence TEXT,
                exdates TEXT NOT NULL DEFAULT '[]',
                parent_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_start ON events(start);
            CREATE TABLE IF NOT EXISTS reminders (
                id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
                offset_min INTEGER,
                at_time TEXT,
                at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS reminders_event ON reminders(event_id);
            CREATE TABLE IF NOT EXISTS reminder_log (
                reminder_id TEXT NOT NULL,
                occ_key TEXT NOT NULL,
                status TEXT NOT NULL,
                snooze_until TEXT,
                PRIMARY KEY (reminder_id, occ_key)
            );
            CREATE TABLE IF NOT EXISTS command_history (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                changes TEXT NOT NULL,
                undone INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .map_err(e)?;
        Ok(Self { conn })
    }

    fn row_to_event(row: &rusqlite::Row) -> rusqlite::Result<Event> {
        let rec: Option<String> = row.get("recurrence")?;
        let ex: String = row.get("exdates")?;
        Ok(Event {
            id: row.get("id")?,
            title: row.get("title")?,
            start: row.get("start")?,
            end: row.get("end")?,
            all_day: row.get::<_, i64>("all_day")? != 0,
            location: row.get("location")?,
            notes: row.get("notes")?,
            color: row.get("color")?,
            recurrence: rec.and_then(|s| serde_json::from_str(&s).ok()),
            exdates: serde_json::from_str(&ex).unwrap_or_default(),
            parent_id: row.get("parent_id")?,
            reminders: vec![],
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    fn attach_reminders(&self, events: &mut [Event]) -> DbResult<()> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT id, offset_min, at_time, at, created_at FROM reminders WHERE event_id = ?1 ORDER BY offset_min DESC, at")
            .map_err(e)?;
        for ev in events.iter_mut() {
            ev.reminders = stmt
                .query_map([&ev.id], |r| {
                    Ok(Reminder {
                        id: r.get(0)?,
                        offset_min: r.get(1)?,
                        at_time: r.get(2)?,
                        at: r.get(3)?,
                        created_at: r.get(4)?,
                    })
                })
                .map_err(e)?
                .collect::<Result<_, _>>()
                .map_err(e)?;
        }
        Ok(())
    }

    fn query_events(&self, sql: &str, p: impl rusqlite::Params) -> DbResult<Vec<Event>> {
        let mut stmt = self.conn.prepare_cached(sql).map_err(e)?;
        let mut v: Vec<Event> = stmt
            .query_map(p, Self::row_to_event)
            .map_err(e)?
            .collect::<Result<_, _>>()
            .map_err(e)?;
        self.attach_reminders(&mut v)?;
        Ok(v)
    }

    pub fn get_event(&self, id: &str) -> DbResult<Option<Event>> {
        Ok(self.query_events("SELECT * FROM events WHERE id = ?1", [id])?.pop())
    }

    /// Events that may have an occurrence overlapping `[from, to)`.
    pub fn events_in_range(&self, from: NaiveDateTime, to: NaiveDateTime) -> DbResult<Vec<Event>> {
        // Non-recurring: overlap check with a 1-day slack for all-day events.
        let slack = from - chrono::Duration::days(1);
        self.query_events(
            "SELECT * FROM events WHERE recurrence IS NOT NULL
               OR (start < ?2 AND COALESCE(end, start) >= ?1)
             ORDER BY start",
            params![slack, to],
        )
    }

    pub fn events_with_reminders(&self) -> DbResult<Vec<Event>> {
        self.query_events(
            "SELECT * FROM events WHERE id IN (SELECT DISTINCT event_id FROM reminders)",
            [],
        )
    }

    pub fn search(&self, q: &str, limit: i64) -> DbResult<Vec<Event>> {
        let like = format!("%{}%", q.trim().replace('%', "").replace('_', ""));
        self.query_events(
            "SELECT * FROM events WHERE title LIKE ?1 OR notes LIKE ?1 OR location LIKE ?1
             ORDER BY start DESC LIMIT ?2",
            params![like, limit],
        )
    }

    /// Insert or replace an event (and its reminders). Returns the stored event
    /// plus a before/after change record.
    pub fn upsert(&mut self, mut ev: Event) -> DbResult<(Event, Change)> {
        let before = if ev.id.is_empty() { None } else { self.get_event(&ev.id)? };
        let n = now();
        if ev.id.is_empty() {
            ev.id = uuid::Uuid::new_v4().to_string();
        }
        ev.title = ev.title.trim().to_string();
        if ev.title.is_empty() {
            ev.title = "Untitled".into();
        }
        if let Some(end) = ev.end {
            if end < ev.start {
                ev.end = None;
            }
        }
        ev.created_at = before.as_ref().and_then(|b| b.created_at).or(ev.created_at).or(Some(n));
        ev.updated_at = Some(n);
        for r in ev.reminders.iter_mut() {
            if r.id.is_empty() {
                r.id = uuid::Uuid::new_v4().to_string();
            }
            // Keep the original creation time of unchanged reminders so the
            // scheduler doesn't treat an edit as a brand-new reminder.
            let same = before.as_ref().and_then(|b| {
                b.reminders.iter().find(|o| {
                    o.id == r.id && o.offset_min == r.offset_min && o.at_time == r.at_time && o.at == r.at
                })
            });
            r.created_at = same.and_then(|o| o.created_at).or(Some(n));
        }

        let tx = self.conn.transaction().map_err(e)?;
        tx.execute(
            "INSERT OR REPLACE INTO events
              (id, title, start, end, all_day, location, notes, color, recurrence, exdates, parent_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                ev.id,
                ev.title,
                ev.start,
                ev.end,
                ev.all_day as i64,
                ev.location,
                ev.notes,
                ev.color,
                ev.recurrence.as_ref().map(|r| serde_json::to_string(r).unwrap()),
                serde_json::to_string(&ev.exdates).unwrap(),
                ev.parent_id,
                ev.created_at,
                ev.updated_at,
            ],
        )
        .map_err(e)?;
        // INSERT OR REPLACE deletes the old row, cascading its reminders.
        tx.execute("DELETE FROM reminders WHERE event_id = ?1", [&ev.id]).map_err(e)?;
        for r in &ev.reminders {
            tx.execute(
                "INSERT INTO reminders (id, event_id, offset_min, at_time, at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![r.id, ev.id, r.offset_min, r.at_time, r.at, r.created_at],
            )
            .map_err(e)?;
        }
        tx.commit().map_err(e)?;
        let change = Change { before, after: Some(ev.clone()) };
        Ok((ev, change))
    }

    pub fn delete(&mut self, id: &str) -> DbResult<Option<Change>> {
        let Some(before) = self.get_event(id)? else { return Ok(None) };
        self.conn.execute("DELETE FROM events WHERE id = ?1", [id]).map_err(e)?;
        Ok(Some(Change { before: Some(before), after: None }))
    }

    /// Revert a list of changes (newest first).
    pub fn revert(&mut self, changes: &[Change]) -> DbResult<()> {
        for c in changes.iter().rev() {
            match (&c.before, &c.after) {
                (None, Some(after)) => {
                    self.delete(&after.id)?;
                }
                (Some(before), _) => {
                    self.upsert(before.clone())?;
                }
                (None, None) => {}
            }
        }
        Ok(())
    }

    // ----- reminder log -----

    pub fn log_status(&self, reminder_id: &str, occ_key: &str) -> DbResult<Option<(String, Option<NaiveDateTime>)>> {
        self.conn
            .query_row(
                "SELECT status, snooze_until FROM reminder_log WHERE reminder_id = ?1 AND occ_key = ?2",
                [reminder_id, occ_key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(e)
    }

    pub fn set_log(&self, reminder_id: &str, occ_key: &str, status: &str, snooze_until: Option<NaiveDateTime>) -> DbResult<()> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO reminder_log (reminder_id, occ_key, status, snooze_until) VALUES (?1, ?2, ?3, ?4)",
                params![reminder_id, occ_key, status, snooze_until],
            )
            .map(|_| ())
            .map_err(e)
    }

    pub fn snoozed(&self) -> DbResult<Vec<(String, String, NaiveDateTime)>> {
        let mut stmt = self
            .conn
            .prepare_cached("SELECT reminder_id, occ_key, snooze_until FROM reminder_log WHERE status = 'snoozed' AND snooze_until IS NOT NULL")
            .map_err(e)?;
        let v = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(e)?
            .collect::<Result<_, _>>()
            .map_err(e)?;
        Ok(v)
    }

    // ----- command history -----

    pub fn record_command(&self, text: &str, changes: &[Change]) -> DbResult<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.conn
            .execute(
                "INSERT INTO command_history (id, text, created_at, changes) VALUES (?1, ?2, ?3, ?4)",
                params![id, text, now(), serde_json::to_string(changes).map_err(e)?],
            )
            .map_err(e)?;
        Ok(id)
    }

    pub fn last_undoable_command(&self) -> DbResult<Option<(String, String)>> {
        self.conn
            .query_row(
                "SELECT id, text FROM command_history WHERE undone = 0 ORDER BY created_at DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(e)
    }

    pub fn undo_command(&mut self, id: &str) -> DbResult<()> {
        let (changes, undone): (String, i64) = self
            .conn
            .query_row("SELECT changes, undone FROM command_history WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(e)?;
        if undone != 0 {
            return Err("That command was already undone.".into());
        }
        let changes: Vec<Change> = serde_json::from_str(&changes).map_err(e)?;
        self.revert(&changes)?;
        self.conn.execute("UPDATE command_history SET undone = 1 WHERE id = ?1", [id]).map_err(e)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Event {
        serde_json::from_value(serde_json::json!({
            "title": "Doctor",
            "start": "2027-07-05T22:00:00",
            "reminders": [{"offsetMin": 2880, "atTime": "09:00"}, {"offsetMin": 1440, "atTime": "09:00"}]
        }))
        .unwrap()
    }

    #[test]
    fn crud_and_undo() {
        let mut db = Db::memory().unwrap();
        let (ev, c1) = db.upsert(sample()).unwrap();
        assert!(!ev.id.is_empty());
        assert_eq!(db.get_event(&ev.id).unwrap().unwrap().reminders.len(), 2);

        let mut moved = ev.clone();
        moved.start = moved.start + chrono::Duration::days(1);
        let (_, c2) = db.upsert(moved).unwrap();
        let cid = db.record_command("move it", &[c1, c2]).unwrap();
        db.undo_command(&cid).unwrap();
        assert!(db.get_event(&ev.id).unwrap().is_none());
        assert!(db.undo_command(&cid).is_err());
    }

    #[test]
    fn range_and_search() {
        let mut db = Db::memory().unwrap();
        db.upsert(sample()).unwrap();
        let from = NaiveDateTime::parse_from_str("2027-07-01 00:00", "%Y-%m-%d %H:%M").unwrap();
        let to = NaiveDateTime::parse_from_str("2027-08-01 00:00", "%Y-%m-%d %H:%M").unwrap();
        assert_eq!(db.events_in_range(from, to).unwrap().len(), 1);
        assert_eq!(db.search("doc", 10).unwrap().len(), 1);
        assert_eq!(db.events_with_reminders().unwrap().len(), 1);
    }
}
