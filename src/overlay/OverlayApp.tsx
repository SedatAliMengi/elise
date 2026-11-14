import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import CommandPanel from "../components/CommandPanel";
import Eye from "../components/Eye";
import SummonCircle, { type RitualPhase } from "../components/SummonCircle";
import { api, on } from "../lib/api";
import { fmtTime, fmtUntil, fromNaive, spokenTime } from "../lib/dates";
import { speak } from "../lib/speech";
import type { EyeState, OverlayMode, ReminderPayload, YearPrompt } from "../lib/types";
import { useSettings, voiceOpts } from "../lib/useSettings";
import Oracle from "./Oracle";
import ReminderCard from "./ReminderCard";
import YearPromptCard from "./YearPromptCard";
import "./overlay.css";

interface Session {
  key: number;
  greet: boolean;
  voice: boolean;
  direct: boolean;
}

const VANISH_MS = 560;
const REMINDER_TIMEOUT_MS = 30_000;
const YEAR_PROMPT_TIMEOUT_MS = 60_000;

export default function OverlayApp() {
  const settings = useSettings();
  const [mode, setMode] = useState<OverlayMode>("hidden");
  const [eye, setEye] = useState<EyeState>("closed");
  const [session, setSession] = useState<Session | null>(null);
  const [queue, setQueue] = useState<ReminderPayload[]>([]);
  const [yearPrompt, setYearPrompt] = useState<YearPrompt | null>(null);
  const [oracleKey, setOracleKey] = useState(0);
  const yearPromptRef = useRef(yearPrompt);
  yearPromptRef.current = yearPrompt;
  const [level, setLevel] = useState(0);
  const [ritual, setRitual] = useState<RitualPhase>("off");
  const [ritualKey, setRitualKey] = useState(0);
  const ritualTimer = useRef<number | undefined>(undefined);
  const eyeRef = useRef(eye);
  eyeRef.current = eye;
  const vanishing = useRef(false);
  const keyRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const startSession = useCallback((greet: boolean, voice = false, direct = false) => {
    vanishing.current = false;
    keyRef.current += 1;
    setSession({ key: keyRef.current, greet, voice, direct });
  }, []);

  const pullReminders = useCallback(async () => {
    const r = await api.takeReminders();
    if (r.length) {
      queueRef.current = [...queueRef.current, ...r];
      setQueue(queueRef.current);
    }
  }, []);

  const pullYearPrompt = useCallback(async () => {
    const p = await api.takeYearPrompt();
    if (p) setYearPrompt(p);
  }, []);

  useEffect(() => {
    api.overlayMode().then((m) => {
      setMode(m);
      if (m === "compact") setEye("idle");
    });
    pullReminders();
    pullYearPrompt();
    const offs = [
      on<OverlayMode>("overlay-mode", (m) => {
        setMode(m);
        if (m === "compact" && !vanishing.current) setEye("idle");
        if (m === "hidden") {
          setSession(null);
          setEye("closed");
        }
      }),
      on<string>("summon", (source) => {
        setEye(modeRef.current === "expanded" ? "listening" : "appearing");
        const direct = source === "voice-direct";
        startSession(!direct, source.startsWith("voice"), direct);
      }),
      on("reminder", () => pullReminders()),
      on("year-prompt", () => pullYearPrompt()),
      on("oracle", () => {
        vanishing.current = false;
        setEye("appearing");
        setOracleKey((k) => k + 1);
      }),
    ];
    return () => {
      offs.forEach((f) => f());
    };
  }, [pullReminders, pullYearPrompt, startSession]);

  /** Play a ritual phase for `ms`, then settle back (faint ring while thinking). */
  const playRitual = useCallback((p: RitualPhase, ms: number) => {
    clearTimeout(ritualTimer.current);
    if (p === "summon") setRitualKey((k) => k + 1);
    setRitual(p);
    ritualTimer.current = window.setTimeout(() => setRitual(eyeRef.current === "thinking" ? "think" : "off"), ms);
  }, []);

  // The summoning circle follows the eye.
  useEffect(() => {
    if (eye === "appearing") playRitual("summon", 2800);
    else if (eye === "vanishing") playRitual("dismiss", 450);
    else if (eye === "thinking") setRitual((r) => (r === "summon" ? r : "think"));
    else setRitual((r) => (r === "think" ? "off" : r));
  }, [eye, playRitual]);

  // Show the eye opening whenever the window expands from nothing.
  useEffect(() => {
    if ((mode === "expanded" || mode === "center") && eye === "closed") setEye("appearing");
  }, [mode, eye]);

  /** Everything is finished: close the eye, then hide/collapse the window. */
  const wrapUp = useCallback(() => {
    if (vanishing.current) return;
    vanishing.current = true;
    setSession(null);
    const hover = settings.hoverMode;
    setEye(hover ? "idle" : "vanishing");
    window.setTimeout(() => {
      api.overlayDone();
      vanishing.current = false;
      if (!hover) setEye("closed");
    }, hover ? 250 : VANISH_MS);
  }, [settings.hoverMode]);

  const current = !session ? queue[0] : undefined;
  const showYearPrompt = !session && !current ? yearPrompt : null;

  // End of the year: say it once, leave a Windows notification if ignored.
  useEffect(() => {
    if (!showYearPrompt) return;
    if (eye === "closed" || eye === "vanishing") setEye("appearing");
    vanishing.current = false;
    const { year, missed } = showYearPrompt;
    const name = settings.userName || "Enigma";
    speak(
      missed ? `${year} has ended, ${name}. Time to check your ${year} checklist.` : `It's the last day of ${year}, ${name}. Time to check your ${year} checklist.`,
      voiceOpts(settings),
    );
    const t = window.setTimeout(() => {
      api.reminderToast("Elise", `Time to check your ${year} checklist. It's in the calendar, next to Settings.`);
      closeYearPrompt();
    }, YEAR_PROMPT_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showYearPrompt?.year]);

  const closeYearPrompt = () => {
    setYearPrompt(null);
    if (!queueRef.current.length) wrapUp();
  };

  // Speak each reminder as it comes up; turn it into a toast if ignored.
  useEffect(() => {
    if (!current) return;
    if (eye === "closed" || eye === "vanishing") setEye("appearing");
    vanishing.current = false;
    const d = fromNaive(current.start);
    speak(`Reminder: ${current.title}, ${current.allDay ? "" : "at " + spokenTime(d) + ", "}${fmtUntil(d, current.allDay).replace(/ h/, " hours").replace(/ min/, " minutes")}.`, voiceOpts(settings));
    const t = window.setTimeout(() => {
      api.reminderToast("Elise reminder", reminderLine(current, settings.time24h));
      resolveReminder("dismiss");
    }, REMINDER_TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.reminderId, current?.occKey]);

  const resolveReminder = (action: "dismiss" | "snooze", minutes?: number) => {
    const [head, ...rest] = queueRef.current;
    if (head) api.reminderAction(head, action, minutes).catch(() => {});
    queueRef.current = rest;
    setQueue(rest);
    if (!rest.length && !yearPromptRef.current) wrapUp();
  };

  const onPanelFinish = useCallback(() => {
    setSession(null);
    // Pending reminders get their turn before the eye leaves.
    if (!queueRef.current.length && !yearPromptRef.current) wrapUp();
  }, [wrapUp]);

  // ----- compact (hover) eye: click vs drag -----
  const down = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const onEyeMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    down.current = { x: e.screenX, y: e.screenY, dragging: false };
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = down.current;
      if (!d || d.dragging) return;
      if (Math.abs(e.screenX - d.x) + Math.abs(e.screenY - d.y) > 4) {
        d.dragging = true;
        getCurrentWindow().startDragging();
      }
    };
    const up = () => {
      const d = down.current;
      down.current = null;
      if (d && !d.dragging && modeRef.current === "compact") {
        api.overlayExpand();
        playRitual("summon", 2800);
        setEye("listening");
        startSession(true);
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [startSession, playRitual]);

  const onEyeContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { id: "cal", text: "Open Calendar", action: () => api.showCalendar() },
        { id: "set", text: "Settings…", action: () => api.showCalendar(true) },
        { id: "big", text: "Big eye on screen", action: () => api.stageSet(true) },
        { item: "Separator" },
        { id: "hide", text: "Hide (turn off hover)", action: () => api.setSettings({ ...settings, hoverMode: false }) },
      ],
    });
    await menu.popup();
  };

  if (mode === "hidden") return null;

  if (mode === "center") {
    return (
      <Oracle
        key={oracleKey}
        eye={eye}
        onEye={setEye}
        settings={settings}
        onDone={() => {
          vanishing.current = true;
          setEye("vanishing");
          window.setTimeout(() => {
            api.overlayDone();
            vanishing.current = false;
            setEye(settings.hoverMode ? "idle" : "closed");
          }, VANISH_MS);
        }}
      />
    );
  }

  if (mode === "compact" && !session && !current && !showYearPrompt) {
    return (
      <div className="overlay overlay--compact">
        <Eye state={eye === "closed" ? "appearing" : eye} size={140} dim onMouseDown={onEyeMouseDown} onContextMenu={onEyeContext} title="Elise — click to command, drag to move" />
      </div>
    );
  }

  return (
    <div className="overlay overlay--expanded" onContextMenu={(e) => e.preventDefault()}>
      <div className="overlay__stack">
        <AnimatePresence mode="wait">
          {session && (
            <CommandPanel
              key={session.key}
              settings={settings}
              greet={session.greet}
              voiceSummoned={session.voice}
              direct={session.direct}
              placement="overlay"
              onEyeState={setEye}
              onLevel={setLevel}
              onFinish={onPanelFinish}
            />
          )}
          {showYearPrompt && (
            <YearPromptCard
              key={`year-${showYearPrompt.year}`}
              prompt={showYearPrompt}
              onOpen={() => {
                api.checklistOpen(showYearPrompt.year);
                closeYearPrompt();
              }}
              onLater={closeYearPrompt}
            />
          )}
          {!session && current && (
            <ReminderCard
              key={current.reminderId + current.occKey}
              reminder={current}
              time24h={settings.time24h}
              defaultTime={settings.defaultReminderTime}
              more={queue.length - 1}
              onDismiss={() => resolveReminder("dismiss")}
              onSnooze={(m) => resolveReminder("snooze", m)}
              onOpen={() => {
                api.showCalendar();
                resolveReminder("dismiss");
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <div className="overlay__eye">
        <SummonCircle key={ritualKey} phase={ritual} size={250} />
        <Eye state={eye} size={146} level={level} appearDelay={0.65} onClick={() => !session && startSession(true)} title="Elise" />
      </div>
    </div>
  );
}

export function reminderLine(r: ReminderPayload, h24: boolean) {
  const d = fromNaive(r.start);
  const when = r.allDay ? format(d, "EEEE d MMM") : `${format(d, "EEEE d MMM")} ${fmtTime(d, h24)}`;
  return `${r.title} — ${when} (${fmtUntil(d, r.allDay)})`;
}
