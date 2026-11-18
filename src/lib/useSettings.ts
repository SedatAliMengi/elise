import { useEffect, useState } from "react";
import { api, on } from "./api";
import { requestMode, storedNihil } from "./mode";
import type { Settings, VoiceStatus } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  userName: "Enigma",
  voiceResponses: true,
  voiceRate: 1,
  wakeWord: true,
  hotkey: "Ctrl+Alt+E",
  hoverMode: false,
  hoverPos: null,
  autostart: true,
  defaultReminderTime: "09:00",
  defaultEventMinutes: 60,
  weekStartsMonday: true,
  time24h: true,
  followUp: true,
  nihil: storedNihil(),
};

/** Live settings, updated whenever any window changes them. */
export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    // The saved mode is applied at once when a window first loads it; a change
    // made later (in any window) arrives with a blink.
    const load = (instant: boolean) =>
      api
        .getSettings()
        .then((v) => {
          setS(v);
          requestMode(!!v.nihil, instant);
        })
        .catch(() => {});
    load(true);
    const offs = [
      on<Settings>("settings-changed", (v) => {
        setS(v);
        requestMode(!!v.nihil);
      }),
      // A hidden calendar is suspended and can miss the event: catch up when it returns.
      on<boolean>("main-visible", (v) => v && load(true)),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  return s;
}

export const voiceOpts = (s: Settings) => ({ enabled: s.voiceResponses });

/** Whether the offline voice engine is running (and any status message). */
export function useVoiceStatus(): VoiceStatus {
  const [s, setS] = useState<VoiceStatus>({ available: false, message: "" });
  useEffect(() => {
    api.voiceStatus().then(setS).catch(() => {});
    return on<VoiceStatus>("voice-status", setS);
  }, []);
  return s;
}
