import { useEffect, useState } from "react";
import { api, on } from "./api";
import type { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  userName: "Enigma",
  voiceResponses: true,
  voiceName: null,
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
};

/** Live settings, updated whenever any window changes them. */
export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    api.getSettings().then(setS).catch(() => {});
    return on<Settings>("settings-changed", setS);
  }, []);
  return s;
}

export const voiceOpts = (s: Settings) => ({ enabled: s.voiceResponses, voiceName: s.voiceName, rate: s.voiceRate });
