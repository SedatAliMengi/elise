import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import CommandPanel from "../components/CommandPanel";
import Eye from "../components/Eye";
import { api, on } from "../lib/api";
import { fmtTime, fmtUntil, fromNaive } from "../lib/dates";
import { speak } from "../lib/speech";
import type { EyeState, OverlayMode, ReminderPayload } from "../lib/types";
import { useSettings, voiceOpts } from "../lib/useSettings";
import ReminderCard from "./ReminderCard";
import "./overlay.css";

interface Session {
  key: number;
  greet: boolean;
}

const VANISH_MS = 560;
const REMINDER_TIMEOUT_MS = 30_000;

export default function OverlayApp() {
  const settings = useSettings();
  const [mode, setMode] = useState<OverlayMode>("hidden");
  const [eye, setEye] = useState<EyeState>("closed");
  const [session, setSession] = useState<Session | null>(null);
  const [queue, setQueue] = useState<ReminderPayload[]>([]);
  const vanishing = useRef(false);
  const keyRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const startSession = useCallback((greet: boolean) => {
    vanishing.current = false;
    keyRef.current += 1;
    setSession({ key: keyRef.current, greet });
  }, []);

  const pullReminders = useCallback(async () => {
    const r = await api.takeReminders();
    if (r.length) {
      queueRef.current = [...queueRef.current, ...r];
      setQueue(queueRef.current);
    }
  }, []);

  useEffect(() => {
    api.overlayMode().then((m) => {
      setMode(m);
      if (m === "compact") setEye("idle");
    });
    pullReminders();
    const offs = [
      on<OverlayMode>("overlay-mode", (m) => {
        setMode(m);
        if (m === "compact" && !vanishing.current) setEye("idle");
        if (m === "hidden") {
          setSession(null);
          setEye("closed");
        }
      }),
      on<string>("summon", () => {
        setEye(modeRef.current === "expanded" ? "listening" : "appearing");
        startSession(true);
      }),
      on("reminder", () => pullReminders()),
    ];
    const onVis = () => document.documentElement.classList.toggle("hidden-doc", document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      offs.forEach((f) => f());
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pullReminders, startSession]);

  // Show the eye opening whenever the window expands from nothing.
  useEffect(() => {
    if (mode === "expanded" && eye === "closed") setEye("appearing");
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

  // Speak each reminder as it comes up; turn it into a toast if ignored.
  useEffect(() => {
    if (!current) return;
    if (eye === "closed" || eye === "vanishing") setEye("appearing");
    vanishing.current = false;
    const d = fromNaive(current.start);
    speak(`Reminder: ${current.title}, ${current.allDay ? "" : "at " + fmtTime(d, true) + ", "}${fmtUntil(d, current.allDay)}.`, voiceOpts(settings));
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
    if (!rest.length) wrapUp();
  };

  const onPanelFinish = useCallback(() => {
    setSession(null);
    // Pending reminders get their turn before the eye leaves.
    if (!queueRef.current.length) wrapUp();
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
  }, [startSession]);

  const onEyeContext = async (e: React.MouseEvent) => {
    e.preventDefault();
    const menu = await Menu.new({
      items: [
        { id: "cal", text: "Open Calendar", action: () => api.showCalendar() },
        { id: "set", text: "Settings…", action: () => api.showCalendar(true) },
        { item: "Separator" },
        { id: "hide", text: "Hide (turn off hover)", action: () => api.setSettings({ ...settings, hoverMode: false }) },
      ],
    });
    await menu.popup();
  };

  if (mode === "hidden") return null;

  if (mode === "compact" && !session && !current) {
    return (
      <div className="overlay overlay--compact">
        <Eye state={eye === "closed" ? "appearing" : eye} size={92} dim onMouseDown={onEyeMouseDown} onContextMenu={onEyeContext} title="Elise — click to command, drag to move" />
      </div>
    );
  }

  return (
    <div className="overlay overlay--expanded" onContextMenu={(e) => e.preventDefault()}>
      <div className="overlay__stack">
        <AnimatePresence mode="wait">
          {session && (
            <CommandPanel key={session.key} settings={settings} greet={session.greet} placement="overlay" onEyeState={setEye} onFinish={onPanelFinish} />
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
        <Eye state={eye} size={96} onClick={() => !session && startSession(true)} title="Elise" />
      </div>
    </div>
  );
}

export function reminderLine(r: ReminderPayload, h24: boolean) {
  const d = fromNaive(r.start);
  const when = r.allDay ? format(d, "EEEE d MMM") : `${format(d, "EEEE d MMM")} ${fmtTime(d, h24)}`;
  return `${r.title} — ${when} (${fmtUntil(d, r.allDay)})`;
}
