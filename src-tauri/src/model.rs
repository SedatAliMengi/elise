//! Core calendar types. All date-times are *local naive* ("wall clock") times:
//! a 09:00 event stays at 09:00 across DST changes, which is what a personal
//! calendar should do.

use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub freq: Freq,
    #[serde(default = "one")]
    pub interval: u32,
    /// Weekly only: 0 = Monday … 6 = Sunday. Empty/None = the start's weekday.
    #[serde(default)]
    pub by_weekday: Option<Vec<u8>>,
    /// Inclusive last date.
    #[serde(default)]
    pub until: Option<NaiveDate>,
    #[serde(default)]
    pub count: Option<u32>,
}

fn one() -> u32 {
    1
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    #[serde(default)]
    pub id: String,
    /// Relative: minutes before the occurrence start.
    #[serde(default)]
    pub offset_min: Option<i64>,
    /// Relative, day-based: fire at this time of day ("HH:MM") on the day
    /// `ceil(offset_min / 1440)` days before.
    #[serde(default)]
    pub at_time: Option<String>,
    /// Absolute: fire at exactly this local time (one-off).
    #[serde(default)]
    pub at: Option<NaiveDateTime>,
    #[serde(default)]
    pub created_at: Option<NaiveDateTime>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(default)]
    pub id: String,
    pub title: String,
    pub start: NaiveDateTime,
    #[serde(default)]
    pub end: Option<NaiveDateTime>,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub recurrence: Option<Recurrence>,
    #[serde(default)]
    pub exdates: Vec<NaiveDate>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub reminders: Vec<Reminder>,
    #[serde(default)]
    pub created_at: Option<NaiveDateTime>,
    #[serde(default)]
    pub updated_at: Option<NaiveDateTime>,
}

/// One concrete occurrence of an event inside a queried range.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub event: Event,
    pub start: NaiveDateTime,
    pub end: NaiveDateTime,
}

/// A before/after snapshot of one event, used for undo.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Change {
    pub before: Option<Event>,
    pub after: Option<Event>,
}
