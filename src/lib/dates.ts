import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

/** Local Date -> "YYYY-MM-DDTHH:mm:ss" (what the backend expects). */
export const toNaive = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm:ss");
/** "YYYY-MM-DDTHH:mm:ss" (no zone) parses as local time. */
export const fromNaive = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : s);
export const dateKey = (d: Date) => format(d, "yyyy-MM-dd");

export const weekStartsOn = (monday: boolean) => (monday ? 1 : 0) as 0 | 1;

export function monthGrid(month: Date, monday: boolean): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: weekStartsOn(monday) });
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(d: Date, monday: boolean): Date[] {
  const start = startOfWeek(d, { weekStartsOn: weekStartsOn(monday) });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekdayLabels(monday: boolean, style: "short" | "narrow" = "short"): string[] {
  const base = weekDays(new Date(2026, 0, 5), monday); // any week
  return base.map((d) => format(d, style === "short" ? "EEE" : "EEEEE"));
}

export function fmtTime(d: Date, h24: boolean) {
  return format(d, h24 ? "HH:mm" : "h:mm a");
}

export function fmtRelativeDay(d: Date, now = new Date()) {
  const diff = differenceInCalendarDays(d, now);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  const abs = Math.abs(diff);
  const span =
    abs >= 365
      ? `${Math.round(abs / 365.25)} year${Math.round(abs / 365.25) > 1 ? "s" : ""}`
      : abs >= 60
        ? `${Math.round(abs / 30.44)} months`
        : `${abs} days`;
  return diff < 0 ? `${span} ago` : `in ${span}`;
}

/** "in 30 min", "in 2 h 15 min", "started 5 min ago", else the day-level wording. */
export function fmtUntil(d: Date, allDay: boolean, now = new Date()) {
  if (allDay || !isSameDay(d, now)) return fmtRelativeDay(d, now);
  const mins = Math.round((d.getTime() - now.getTime()) / 60000);
  const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  if (mins > 0) return `in ${span(mins)}`;
  if (mins === 0) return "now";
  return `started ${span(-mins)} ago`;
}

export { isSameDay };
