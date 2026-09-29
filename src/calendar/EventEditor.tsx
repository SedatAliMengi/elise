import { addMinutes, differenceInMinutes, format, parse } from "date-fns";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fromNaive, toNaive } from "../lib/dates";
import type { CalEvent, Freq, Recurrence, Reminder } from "../lib/types";
import { EVENT_COLORS } from "./util";

export interface EditorTarget {
  event: CalEvent;
  /** Original start of the edited occurrence (recurring events). */
  occStart: string | null;
  isNew: boolean;
}

interface Props {
  target: EditorTarget;
  defaultReminderTime: string;
  onSave: (ev: CalEvent) => void;
  onDelete: () => void;
  onClose: () => void;
}

type Unit = "minutes" | "hours" | "days" | "weeks";
const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

interface RemRow {
  key: string;
  id: string;
  amount: number;
  unit: Unit;
  atTime: string;
  /** Absolute reminders are shown read-only. */
  at: string | null;
}

function toRows(rs: Reminder[], defTime: string): RemRow[] {
  return rs.map((r, i) => {
    const key = `${r.id || "n"}-${i}`;
    if (r.at) return { key, id: r.id, amount: 0, unit: "minutes", atTime: "", at: r.at };
    const m = r.offsetMin ?? 0;
    const unit: Unit = m && m % 10080 === 0 ? "weeks" : m && m % 1440 === 0 ? "days" : m && m % 60 === 0 ? "hours" : r.atTime ? "days" : "minutes";
    return { key, id: r.id, amount: Math.round(m / UNIT_MIN[unit]), unit, atTime: r.atTime ?? defTime, at: null };
  });
}

function fromRows(rows: RemRow[]): Reminder[] {
  return rows.map((r) => {
    if (r.at) return { id: r.id, at: r.at, offsetMin: null, atTime: null };
    const dayBased = r.unit === "days" || r.unit === "weeks";
    return { id: r.id, offsetMin: Math.max(0, r.amount) * UNIT_MIN[r.unit], atTime: dayBased ? r.atTime || null : null, at: null };
  });
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function EventEditor({ target, defaultReminderTime, onSave, onDelete, onClose }: Props) {
  const ev = target.event;
  const s0 = fromNaive(ev.start);
  const e0 = ev.end ? fromNaive(ev.end) : addMinutes(s0, 60);

  const [title, setTitle] = useState(ev.title);
  const [allDay, setAllDay] = useState(ev.allDay);
  const [date, setDate] = useState(format(s0, "yyyy-MM-dd"));
  const [start, setStart] = useState(format(s0, "HH:mm"));
  const [endDate, setEndDate] = useState(format(e0, "yyyy-MM-dd"));
  const [end, setEnd] = useState(format(e0, "HH:mm"));
  const [location, setLocation] = useState(ev.location ?? "");
  const [notes, setNotes] = useState(ev.notes ?? "");
  const [color, setColor] = useState(ev.color ?? EVENT_COLORS[0]);
  const [freq, setFreq] = useState<Freq | "none">(ev.recurrence?.freq ?? "none");
  const [interval, setIntervalN] = useState(ev.recurrence?.interval ?? 1);
  const [byWeekday, setByWeekday] = useState<number[]>(ev.recurrence?.byWeekday ?? [(s0.getDay() + 6) % 7]);
  const [endMode, setEndMode] = useState<"never" | "until" | "count">(ev.recurrence?.until ? "until" : ev.recurrence?.count ? "count" : "never");
  const [until, setUntil] = useState(ev.recurrence?.until ?? format(addMinutes(s0, 60 * 24 * 90), "yyyy-MM-dd"));
  const [count, setCount] = useState(ev.recurrence?.count ?? 10);
  const [rows, setRows] = useState<RemRow[]>(() => toRows(ev.reminders, defaultReminderTime));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (target.isNew) titleRef.current?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [target.isNew, onClose]);

  // Keep the end after the start when the start moves.
  const lenRef = useRef(Math.max(15, differenceInMinutes(e0, s0)));
  const setStartKeepLen = (d: string, t: string) => {
    const s = parse(`${d} ${t}`, "yyyy-MM-dd HH:mm", new Date());
    if (isNaN(s.getTime())) return;
    const e = addMinutes(s, lenRef.current);
    setEndDate(format(e, "yyyy-MM-dd"));
    setEnd(format(e, "HH:mm"));
  };

  const startDate = useMemo(() => parse(`${date} ${allDay ? "00:00" : start}`, "yyyy-MM-dd HH:mm", new Date()), [date, start, allDay]);
  const endDateObj = useMemo(() => parse(`${endDate} ${end}`, "yyyy-MM-dd HH:mm", new Date()), [endDate, end]);
  const invalid = !title.trim() || isNaN(startDate.getTime()) || (!allDay && (isNaN(endDateObj.getTime()) || endDateObj < startDate));

  const save = () => {
    if (invalid) return;
    let recurrence: Recurrence | null = null;
    if (freq !== "none") {
      recurrence = {
        freq,
        interval: Math.max(1, interval || 1),
        byWeekday: freq === "weekly" ? (byWeekday.length ? byWeekday : null) : null,
        until: endMode === "until" ? until : null,
        count: endMode === "count" ? Math.max(1, count) : null,
      };
    }
    onSave({
      ...ev,
      title: title.trim(),
      allDay,
      start: toNaive(startDate),
      end: allDay ? null : toNaive(endDateObj),
      location: location.trim() || null,
      notes: notes.trim() || null,
      color,
      recurrence,
      reminders: fromRows(rows),
    });
  };

  const addReminder = () =>
    setRows((r) => [
      ...r,
      allDay
        ? { key: `n${Date.now()}`, id: "", amount: 1, unit: "days", atTime: defaultReminderTime, at: null }
        : { key: `n${Date.now()}`, id: "", amount: 30, unit: "minutes", atTime: defaultReminderTime, at: null },
    ]);

  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.section
        className="editor"
        initial={{ x: "100%", opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0.6, transition: { duration: 0.22, ease: [0.55, 0, 0.8, 0.2] } }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || (e.target as HTMLElement).tagName === "INPUT")) {
            e.preventDefault();
            save();
          }
        }}
      >
        <div className="editor__head">
          <span className="editor__kicker">{target.isNew ? "New event" : "Edit event"}</span>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <div className="editor__body">
          <input ref={titleRef} className="editor__title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />

          <div className="editor__colors">
            {EVENT_COLORS.map((c) => (
              <button key={c} className={`swatch ${color === c ? "active" : ""}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>

          <div className="field-row">
            <label className="toggle-row">
              <span>All day</span>
              <button className={`switch ${allDay ? "on" : ""}`} onClick={() => setAllDay((a) => !a)} />
            </label>
          </div>

          <div className="field-grid">
            <div>
              <span className="label">{allDay ? "Date" : "Starts"}</span>
              <div className="dt">
                <input
                  type="date"
                  className="input"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setStartKeepLen(e.target.value, start);
                  }}
                />
                {!allDay && (
                  <input
                    type="time"
                    className="input"
                    value={start}
                    onChange={(e) => {
                      setStart(e.target.value);
                      setStartKeepLen(date, e.target.value);
                    }}
                  />
                )}
              </div>
            </div>
            {!allDay && (
              <div>
                <span className="label">Ends</span>
                <div className="dt">
                  <input
                    type="date"
                    className="input"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      lenRef.current = Math.max(0, differenceInMinutes(parse(`${e.target.value} ${end}`, "yyyy-MM-dd HH:mm", new Date()), startDate));
                    }}
                  />
                  <input
                    type="time"
                    className="input"
                    value={end}
                    onChange={(e) => {
                      setEnd(e.target.value);
                      lenRef.current = Math.max(0, differenceInMinutes(parse(`${endDate} ${e.target.value}`, "yyyy-MM-dd HH:mm", new Date()), startDate));
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <span className="label">Repeat</span>
            <div className="dt">
              <select className="input" value={freq} onChange={(e) => setFreq(e.target.value as Freq | "none")}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              {freq !== "none" && (
                <div className="every">
                  every
                  <input type="number" min={1} className="input" value={interval} onChange={(e) => setIntervalN(parseInt(e.target.value, 10) || 1)} />
                  {{ daily: "day", weekly: "week", monthly: "month", yearly: "year" }[freq]}
                  {interval > 1 ? "s" : ""}
                </div>
              )}
            </div>
            {freq === "weekly" && (
              <div className="weekdays">
                {WEEKDAYS.map((w, i) => (
                  <button
                    key={w}
                    className={`chip ${byWeekday.includes(i) ? "chip--on" : ""}`}
                    onClick={() => setByWeekday((b) => (b.includes(i) ? b.filter((x) => x !== i) : [...b, i].sort()))}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
            {freq !== "none" && (
              <div className="dt ends">
                <select className="input" value={endMode} onChange={(e) => setEndMode(e.target.value as typeof endMode)}>
                  <option value="never">Forever</option>
                  <option value="until">Until</option>
                  <option value="count">For a number of times</option>
                </select>
                {endMode === "until" && <input type="date" className="input" value={until} onChange={(e) => setUntil(e.target.value)} />}
                {endMode === "count" && (
                  <input type="number" min={1} className="input" value={count} onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)} />
                )}
              </div>
            )}
          </div>

          <div>
            <span className="label">Reminders</span>
            <div className="rems">
              {rows.map((r, i) => (
                <div key={r.key} className="rem-row">
                  {r.at ? (
                    <span className="rem-row__abs">On {format(fromNaive(r.at), "EEE d MMM yyyy, HH:mm")}</span>
                  ) : (
                    <>
                      <input
                        type="number"
                        min={0}
                        className="input rem-row__n"
                        value={r.amount}
                        onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: parseInt(e.target.value, 10) || 0 } : x)))}
                      />
                      <select
                        className="input rem-row__unit"
                        value={r.unit}
                        onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, unit: e.target.value as Unit } : x)))}
                      >
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                        <option value="weeks">weeks</option>
                      </select>
                      <span className="rem-row__before">before</span>
                      {(r.unit === "days" || r.unit === "weeks") && (
                        <input
                          type="time"
                          className="input rem-row__at"
                          value={r.atTime}
                          title="At this time of day"
                          onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, atTime: e.target.value } : x)))}
                        />
                      )}
                    </>
                  )}
                  <button className="btn ghost icon rem-row__x" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} title="Remove">
                    ✕
                  </button>
                </div>
              ))}
              <button className="btn ghost rems__add" onClick={addReminder}>
                + Add reminder
              </button>
            </div>
          </div>

          <div>
            <span className="label">Location</span>
            <input className="input" placeholder="Optional" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <span className="label">Notes</span>
            <textarea className="input" rows={3} placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="editor__foot">
          {!target.isNew &&
            (confirmDelete ? (
              <div className="confirm">
                <span>Delete this event?</span>
                <button className="btn danger" onClick={onDelete}>
                  Delete
                </button>
                <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            ))}
          <div className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={invalid}>
            Save
          </button>
        </div>
      </motion.section>
    </>
  );
}
