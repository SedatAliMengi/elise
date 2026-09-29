import { addDays, addMinutes, differenceInMinutes, startOfDay } from "date-fns";
import { fromNaive, toNaive } from "../lib/dates";
import type { CalEvent, Occurrence } from "../lib/types";

export type View = "year" | "month" | "week" | "day";

export const EVENT_COLORS = ["#8b00ff", "#b44cff", "#d70000", "#ff4f8b", "#5b6cff", "#22b8cf", "#f2a93b", "#7c8a9e"];

export const colorOf = (e: CalEvent) => e.color || EVENT_COLORS[0];

export interface Occ extends Occurrence {
  s: Date;
  e: Date;
}

export const hydrate = (o: Occurrence): Occ => ({ ...o, s: fromNaive(o.start), e: fromNaive(o.end) });

/** Does the occurrence show on `day`? */
export function occursOn(o: Occ, day: Date): boolean {
  const ds = startOfDay(day);
  const de = addDays(ds, 1);
  if (o.e <= o.s) return o.s >= ds && o.s < de;
  return o.s < de && o.e > ds;
}

export function occKey(o: Occurrence) {
  return `${o.event.id}@${o.start}`;
}

/** The event re-timed to start at `newStart` (keeping its length). */
export function movedTo(o: Occ, newStart: Date): CalEvent {
  const len = differenceInMinutes(o.e, o.s);
  return {
    ...o.event,
    start: toNaive(newStart),
    end: o.event.end && !o.event.allDay ? toNaive(addMinutes(newStart, len)) : o.event.allDay ? null : o.event.end,
  };
}

export function blankEvent(start: Date, minutes: number, allDay = false): CalEvent {
  return {
    id: "",
    title: "",
    start: toNaive(start),
    end: allDay ? null : toNaive(addMinutes(start, minutes)),
    allDay,
    location: null,
    notes: null,
    color: null,
    recurrence: null,
    exdates: [],
    parentId: null,
    reminders: [],
  };
}

export interface DragData {
  key: string;
}

/** Occurrences being dragged, looked up by key (dataTransfer only carries strings). */
export const dragRegistry = new Map<string, Occ>();
