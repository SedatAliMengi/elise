/** Mirrors the Rust types (serde camelCase). Date-times are local "YYYY-MM-DDTHH:mm:ss". */

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** 0 = Monday … 6 = Sunday */
  byWeekday?: number[] | null;
  until?: string | null;
  count?: number | null;
}

export interface Reminder {
  id: string;
  offsetMin?: number | null;
  atTime?: string | null;
  at?: string | null;
  createdAt?: string | null;
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
  color?: string | null;
  recurrence?: Recurrence | null;
  exdates: string[];
  parentId?: string | null;
  reminders: Reminder[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface Occurrence {
  event: CalEvent;
  start: string;
  end: string;
}

export type Scope = "this" | "following" | "all";

export interface Settings {
  userName: string;
  voiceResponses: boolean;
  voiceRate: number;
  wakeWord: boolean;
  hotkey: string;
  hoverMode: boolean;
  hoverPos: [number, number] | null;
  autostart: boolean;
  defaultReminderTime: string;
  defaultEventMinutes: number;
  weekStartsMonday: boolean;
  time24h: boolean;
  followUp: boolean;
}

export interface CommandResult {
  kind: "done" | "answer" | "clarify" | "error";
  message: string;
  summary: string[];
  historyId: string | null;
}

export interface ReminderPayload {
  reminderId: string;
  occKey: string;
  eventId: string;
  title: string;
  start: string;
  allDay: boolean;
  location: string | null;
  missed: boolean;
}

export type OverlayMode = "hidden" | "compact" | "expanded" | "center";

export interface ChecklistItem {
  id: string;
  year: number;
  text: string;
  done: boolean;
  doneAt: string | null;
}

export interface ChecklistView {
  year: number;
  currentYear: number;
  items: ChecklistItem[];
  /** Add/remove: only the current year. */
  canEdit: boolean;
  /** Tick off: current and past years. */
  canTick: boolean;
}

/** Last day of the year: "Time to check your checklist". */
export interface YearPrompt {
  year: number;
  /** The PC was off on Dec 31; shown in early January instead. */
  missed: boolean;
}

export type EyeState = "appearing" | "idle" | "listening" | "thinking" | "speaking" | "error" | "vanishing" | "closed";

export interface VoiceStatus {
  available: boolean;
  message: string;
}

export interface VoiceEvent {
  evt: "listening" | "level" | "transcribing" | "final" | "error";
  v?: number;
  text?: string;
  msg?: string;
}

/** One line of a project's (or Elise's own) task list. */
export interface ProjectTask {
  id: string;
  projectId: string;
  text: string;
  done: boolean;
}

export type ProjectStatus = "for_now" | "done";

export interface Project {
  id: string;
  name: string;
  color: string;
  /** A tag set and cleared at will: finished for now, fully finished, or none. */
  status: ProjectStatus | null;
  tasks: ProjectTask[];
}

/** The Projects view: Elise's own list in the middle, the projects around her. */
export interface ProjectsBoard {
  elise: ProjectTask[];
  projects: Project[];
}
