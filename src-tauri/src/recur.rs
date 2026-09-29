//! Recurrence expansion and reminder fire-time computation.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime};

use crate::model::{Event, Freq, Reminder};

const MAX_ITER: usize = 200_000;

/// Length of one occurrence.
pub fn duration(ev: &Event) -> Duration {
    match ev.end {
        Some(end) if end > ev.start => end - ev.start,
        _ if ev.all_day => Duration::days(1),
        _ => Duration::zero(),
    }
}

/// Start times of every occurrence overlapping `[from, to)`.
pub fn occurrence_starts(ev: &Event, from: NaiveDateTime, to: NaiveDateTime) -> Vec<NaiveDateTime> {
    let dur = duration(ev);
    let overlaps = |s: NaiveDateTime| {
        let e = s + dur;
        s < to && (e > from || (dur.is_zero() && s >= from))
    };
    let Some(rec) = &ev.recurrence else {
        return if overlaps(ev.start) { vec![ev.start] } else { vec![] };
    };

    let time = ev.start.time();
    let first = ev.start.date();
    let interval = rec.interval.max(1) as i64;
    let mut out = Vec::new();
    let mut produced: u32 = 0;
    // Without a count we may skip ahead to just before the window.
    let skip_ok = rec.count.is_none();
    let window_start = (from - dur).date() - Duration::days(1);

    let mut emit = |d: NaiveDate, out: &mut Vec<NaiveDateTime>| -> bool {
        // returns false when expansion must stop
        if let Some(until) = rec.until {
            if d > until {
                return false;
            }
        }
        if let Some(c) = rec.count {
            if produced >= c {
                return false;
            }
        }
        produced += 1;
        let s = d.and_time(time);
        if s >= to {
            return false;
        }
        if !ev.exdates.contains(&d) && overlaps(s) {
            out.push(s);
        }
        true
    };

    match rec.freq {
        Freq::Daily => {
            let mut k: i64 = 0;
            if skip_ok && window_start > first {
                k = (window_start - first).num_days() / interval;
            }
            for _ in 0..MAX_ITER {
                let d = first + Duration::days(k * interval);
                if !emit(d, &mut out) {
                    break;
                }
                k += 1;
            }
        }
        Freq::Weekly => {
            let mut days: Vec<u8> = rec
                .by_weekday
                .clone()
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| vec![first.weekday().num_days_from_monday() as u8]);
            days.sort_unstable();
            days.dedup();
            let week0 = first - Duration::days(first.weekday().num_days_from_monday() as i64);
            let mut w: i64 = 0;
            if skip_ok && window_start > week0 {
                w = (window_start - week0).num_days() / 7 / interval;
            }
            'outer: for _ in 0..MAX_ITER {
                let ws = week0 + Duration::days(w * 7 * interval);
                for &wd in &days {
                    let d = ws + Duration::days(wd as i64);
                    if d < first {
                        continue;
                    }
                    if !emit(d, &mut out) {
                        break 'outer;
                    }
                }
                w += 1;
            }
        }
        Freq::Monthly | Freq::Yearly => {
            let step_months = if rec.freq == Freq::Monthly { interval } else { interval * 12 };
            let base = first.year() as i64 * 12 + first.month0() as i64;
            let mut k: i64 = 0;
            if skip_ok && window_start > first {
                let wm = window_start.year() as i64 * 12 + window_start.month0() as i64;
                k = ((wm - base) / step_months - 1).max(0);
            }
            for _ in 0..MAX_ITER {
                let m = base + k * step_months;
                let (y, mo) = ((m / 12) as i32, (m % 12) as u32 + 1);
                k += 1;
                // Months without that day (e.g. the 31st, Feb 29) are skipped.
                let Some(d) = NaiveDate::from_ymd_opt(y, mo, first.day()) else {
                    if y > to.year() + 1 {
                        break;
                    }
                    continue;
                };
                if !emit(d, &mut out) {
                    break;
                }
            }
        }
    }
    out
}

pub fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()
}

/// When a relative reminder fires for an occurrence starting at `occ_start`.
pub fn fire_time(
    rem: &Reminder,
    all_day: bool,
    occ_start: NaiveDateTime,
    default_time: NaiveTime,
) -> Option<NaiveDateTime> {
    if let Some(at) = rem.at {
        return Some(at);
    }
    let offset = rem.offset_min.unwrap_or(0).max(0);
    let at_time = rem.at_time.as_deref().and_then(parse_hhmm);
    if at_time.is_some() || all_day {
        let days = (offset + 1439) / 1440;
        let date = occ_start.date() - Duration::days(days);
        Some(date.and_time(at_time.unwrap_or(default_time)))
    } else {
        Some(occ_start - Duration::minutes(offset))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Recurrence;

    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }
    fn ev(start: &str, rec: Option<Recurrence>) -> Event {
        Event {
            id: "x".into(),
            title: "t".into(),
            start: dt(start),
            end: Some(dt(start) + Duration::hours(1)),
            all_day: false,
            location: None,
            notes: None,
            color: None,
            recurrence: rec,
            exdates: vec![],
            parent_id: None,
            reminders: vec![],
            created_at: None,
            updated_at: None,
        }
    }
    fn rec(freq: Freq) -> Recurrence {
        Recurrence { freq, interval: 1, by_weekday: None, until: None, count: None }
    }

    #[test]
    fn single_event_in_and_out_of_range() {
        let e = ev("2026-07-05 22:00", None);
        assert_eq!(occurrence_starts(&e, dt("2026-07-01 00:00"), dt("2026-08-01 00:00")).len(), 1);
        assert!(occurrence_starts(&e, dt("2026-08-01 00:00"), dt("2026-09-01 00:00")).is_empty());
    }

    #[test]
    fn weekly_mondays_far_in_future() {
        let mut r = rec(Freq::Weekly);
        r.by_weekday = Some(vec![0]);
        let e = ev("2026-09-28 08:00", Some(r)); // a Monday
        let occ = occurrence_starts(&e, dt("2040-01-01 00:00"), dt("2040-02-01 00:00"));
        assert_eq!(occ.len(), 5); // Jan 2040 has 5 Mondays
        assert!(occ.iter().all(|d| d.weekday() == chrono::Weekday::Mon));
    }

    #[test]
    fn yearly_birthday_and_exdate() {
        let mut e = ev("2027-03-03 00:00", Some(rec(Freq::Yearly)));
        e.all_day = true;
        e.end = None;
        e.exdates = vec![NaiveDate::from_ymd_opt(2029, 3, 3).unwrap()];
        let occ = occurrence_starts(&e, dt("2027-01-01 00:00"), dt("2031-01-01 00:00"));
        assert_eq!(occ.len(), 3);
    }

    #[test]
    fn monthly_31st_skips_short_months() {
        let e = ev("2026-01-31 10:00", Some(rec(Freq::Monthly)));
        let occ = occurrence_starts(&e, dt("2026-01-01 00:00"), dt("2027-01-01 00:00"));
        assert_eq!(occ.len(), 7);
    }

    #[test]
    fn count_and_until() {
        let mut r = rec(Freq::Daily);
        r.count = Some(3);
        let e = ev("2026-01-01 10:00", Some(r));
        assert_eq!(occurrence_starts(&e, dt("2025-01-01 00:00"), dt("2027-01-01 00:00")).len(), 3);
        let mut r = rec(Freq::Daily);
        r.until = NaiveDate::from_ymd_opt(2026, 1, 10);
        let e = ev("2026-01-01 10:00", Some(r));
        assert_eq!(occurrence_starts(&e, dt("2025-01-01 00:00"), dt("2027-01-01 00:00")).len(), 10);
    }

    #[test]
    fn doctor_example_reminders() {
        // "remind me 2 days before, each of those two days" -> 2d and 1d before at 09:00
        let nine = NaiveTime::from_hms_opt(9, 0, 0).unwrap();
        let occ = dt("2027-07-05 22:00");
        let r2 = Reminder { id: "a".into(), offset_min: Some(2 * 1440), at_time: Some("09:00".into()), at: None, created_at: None };
        let r1 = Reminder { id: "b".into(), offset_min: Some(1440), at_time: Some("09:00".into()), at: None, created_at: None };
        assert_eq!(fire_time(&r2, false, occ, nine), Some(dt("2027-07-03 09:00")));
        assert_eq!(fire_time(&r1, false, occ, nine), Some(dt("2027-07-04 09:00")));
        let r30 = Reminder { id: "c".into(), offset_min: Some(30), at_time: None, at: None, created_at: None };
        assert_eq!(fire_time(&r30, false, occ, nine), Some(dt("2027-07-05 21:30")));
    }
}
