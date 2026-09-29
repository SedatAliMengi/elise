import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  CalEvent,
  CommandResult,
  Occurrence,
  OverlayMode,
  ReminderPayload,
  Scope,
  Settings,
  VoiceStatus,
} from "./types";

export const api = {
  listOccurrences: (from: string, to: string) => invoke<Occurrence[]>("list_occurrences", { from, to }),
  getEvent: (id: string) => invoke<CalEvent | null>("get_event", { id }),
  createEvent: (event: CalEvent) => invoke<CalEvent>("create_event", { event }),
  updateEvent: (id: string, event: CalEvent, occStart?: string | null, scope?: Scope) =>
    invoke<CalEvent>("update_event", { id, event, occStart: occStart ?? null, scope: scope ?? "all" }),
  deleteEvent: (id: string, occStart?: string | null, scope?: Scope) =>
    invoke<void>("delete_event", { id, occStart: occStart ?? null, scope: scope ?? "all" }),
  searchEvents: (query: string) => invoke<CalEvent[]>("search_events", { query }),

  runCommand: (sessionId: string, text: string) => invoke<CommandResult>("run_command", { sessionId, text }),
  cancelSession: (sessionId: string) => invoke<void>("cancel_session", { sessionId }),
  undoCommand: (id: string) => invoke<void>("undo_command", { id }),
  lastCommand: () => invoke<[string, string] | null>("last_command"),

  getSettings: () => invoke<Settings>("get_settings"),
  setSettings: (settings: Settings) => invoke<Settings>("set_settings", { settings }),
  resetHoverPos: () => invoke<void>("reset_hover_pos"),
  hasApiKey: () => invoke<boolean>("has_api_key"),
  setApiKey: (key: string) => invoke<void>("set_api_key", { key }),
  testApiKey: () => invoke<void>("test_api_key"),

  summon: (source: string) => invoke<void>("summon", { source }),
  overlayMode: () => invoke<OverlayMode>("overlay_get_mode"),
  overlayExpand: () => invoke<void>("overlay_expand"),
  overlayDone: () => invoke<void>("overlay_done"),
  takeReminders: () => invoke<ReminderPayload[]>("take_reminders"),
  reminderAction: (p: ReminderPayload, action: "dismiss" | "snooze", minutes?: number) =>
    invoke<void>("reminder_action", { reminderId: p.reminderId, occKey: p.occKey, action, minutes: minutes ?? null }),
  reminderToast: (title: string, body: string) => invoke<void>("reminder_toast", { title, body }),
  voiceListen: () => invoke<void>("voice_listen"),
  voiceCancel: () => invoke<void>("voice_cancel"),
  voiceStatus: () => invoke<VoiceStatus>("voice_status"),
  showCalendar: (settings = false) => invoke<void>("show_calendar", { settings }),
  hideCalendar: () => invoke<void>("hide_calendar"),
  isCalendarVisible: () => invoke<boolean>("is_calendar_visible"),
  quit: () => invoke<void>("quit"),
};

export function on<T>(event: string, cb: (payload: T) => void): () => void {
  let un: UnlistenFn | null = null;
  let dead = false;
  listen<T>(event, (e) => cb(e.payload)).then((u) => {
    if (dead) u();
    else un = u;
  });
  return () => {
    dead = true;
    un?.();
  };
}

export function newSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
