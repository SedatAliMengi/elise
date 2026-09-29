import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import CommandPanel from "../components/CommandPanel";
import Eye from "../components/Eye";
import { ASPECT } from "../components/eyeArt";
import SummonCircle, { type RitualPhase } from "../components/SummonCircle";
import { api, on } from "../lib/api";
import type { EyeState } from "../lib/types";
import { useSettings } from "../lib/useSettings";
import "./stage.css";

interface Session {
  key: number;
  voice: boolean;
}

/** "Big eye on screen": Elise fills the main monitor. Vector art, so it stays sharp at any size. */
export default function StageApp() {
  const settings = useSettings();
  const [shown, setShown] = useState(false);
  const [eye, setEye] = useState<EyeState>("closed");
  const [level, setLevel] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [ritual, setRitual] = useState<RitualPhase>("off");
  const [ritualKey, setRitualKey] = useState(0);
  const [hint, setHint] = useState(true);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const ritualTimer = useRef<number | undefined>(undefined);
  const keyRef = useRef(0);

  const playRitual = useCallback((p: RitualPhase, ms: number) => {
    clearTimeout(ritualTimer.current);
    if (p === "summon") setRitualKey((k) => k + 1);
    setRitual(p);
    ritualTimer.current = window.setTimeout(() => setRitual("off"), ms);
  }, []);

  const startSession = useCallback((voice: boolean) => {
    keyRef.current += 1;
    setSession({ key: keyRef.current, voice });
  }, []);

  useEffect(() => {
    api.stageIsOn().then((v) => {
      setShown(v);
      if (v) setEye("appearing");
    });
    const offs = [
      on<boolean>("stage-visible", (v) => {
        setShown(v);
        if (v) {
          setEye("appearing");
          setHint(true);
        } else {
          setSession(null);
          setEye("closed");
        }
      }),
      on<string>("summon", (source) => startSession(source === "voice")),
    ];
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      offs.forEach((f) => f());
      window.removeEventListener("resize", onResize);
    };
  }, [startSession]);

  // Summoning circle on entrance, faint ring while thinking.
  useEffect(() => {
    if (eye === "appearing") playRitual("summon", 2800);
    else if (eye === "thinking") setRitual((r) => (r === "summon" ? r : "think"));
    else setRitual((r) => (r === "think" ? "off" : r));
    if (eye === "appearing") {
      const t = window.setTimeout(() => setEye("idle"), 1600);
      return () => clearTimeout(t);
    }
  }, [eye, playRitual]);

  useEffect(() => {
    if (!hint || !shown) return;
    const t = window.setTimeout(() => setHint(false), 8000);
    return () => clearTimeout(t);
  }, [hint, shown]);

  // Esc closes the big eye (the command panel handles its own Esc first).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !session) api.stageSet(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [session]);

  if (!shown) return <div className="stage" />;

  // Eye takes ~60% of the screen, leaving room for the command panel below.
  const eyeW = Math.min(vp.w * 0.6, (vp.h * 0.58) / ASPECT);
  const circle = eyeW * 1.72;

  return (
    <div
      className="stage"
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => {
        // Double-click on the empty background closes; the eye and panel don't count.
        if (!(e.target as HTMLElement).closest(".eye, .cmd, .stage__close")) api.stageSet(false);
      }}
    >
      <div className="stage__glow" />
      <div className="stage__center" style={{ width: circle, height: circle }}>
        <SummonCircle key={ritualKey} phase={ritual} size={circle} />
        <Eye
          state={eye}
          size={eyeW}
          level={level}
          appearDelay={0.65}
          onClick={() => !session && startSession(false)}
          title="Command Elise"
        />
      </div>
      <div className="stage__panel">
        <AnimatePresence>
          {session && (
            <CommandPanel
              key={session.key}
              settings={settings}
              placement="calendar"
              voiceSummoned={session.voice}
              onEyeState={(s) => setEye(s === "appearing" ? "listening" : s)}
              onLevel={setLevel}
              onFinish={() => {
                setSession(null);
                setEye("idle");
              }}
            />
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {hint && (
          <motion.div className="stage__hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
            Click the eye to command · Esc or double-click to close
          </motion.div>
        )}
      </AnimatePresence>
      <button className="stage__close" onClick={() => api.stageSet(false)} title="Close (Esc)">
        ✕ Close
      </button>
    </div>
  );
}
