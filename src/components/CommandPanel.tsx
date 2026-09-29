import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, newSessionId, on } from "../lib/api";
import { speak, stopSpeaking } from "../lib/speech";
import type { CommandResult, EyeState, Settings, VoiceEvent } from "../lib/types";
import { useVoiceStatus, voiceOpts } from "../lib/useSettings";
import "./CommandPanel.css";

type Phase = "input" | "thinking" | "done" | "answer" | "clarify" | "error" | "undone";
type Mic = "off" | "listening" | "transcribing";

interface Props {
  settings: Settings;
  /** Say the greeting (spoken + bubble). */
  greet?: boolean;
  placement: "overlay" | "calendar";
  onEyeState: (s: EyeState) => void;
  /** Microphone level 0..1 while listening (drives the pupil). */
  onLevel?: (v: number) => void;
  /** Elise is finished; the host should close/vanish. */
  onFinish: () => void;
  /** Summoned by voice: start listening right after the greeting. */
  autoListen?: boolean;
}

const INACTIVITY_MS = 20_000;

export default function CommandPanel({ settings, greet = true, placement, onEyeState, onLevel, onFinish, autoListen }: Props) {
  const greeting = `Hello ${settings.userName || "Enigma"}, what is your command?`;
  const voice = useVoiceStatus();
  const [phase, setPhase] = useState<Phase>("input");
  const [bubble, setBubble] = useState(greet ? greeting : "What is your command?");
  const [summary, setSummary] = useState<string[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mic, setMic] = useState<Mic>("off");
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useRef(newSessionId());
  const hovered = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const idleTimer = useRef<number | undefined>(undefined);
  const finished = useRef(false);
  const micRef = useRef<Mic>("off");
  micRef.current = mic;
  /** The conversation is being held by voice: keep listening after questions. */
  const voiceMode = useRef(!!autoListen);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const stopMic = useCallback(() => {
    if (micRef.current !== "off") api.voiceCancel().catch(() => {});
    micRef.current = "off";
    setMic("off");
    onLevel?.(0);
  }, [onLevel]);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    clearTimeout(closeTimer.current);
    clearTimeout(idleTimer.current);
    stopSpeaking();
    stopMic();
    api.cancelSession(session.current).catch(() => {});
    onFinish();
  }, [onFinish, stopMic]);

  /** Close after `ms`, but not while the mouse rests on the panel. */
  const closeAfter = useCallback(
    (ms: number) => {
      clearTimeout(closeTimer.current);
      const tick = () => {
        if (hovered.current) closeTimer.current = window.setTimeout(tick, 800);
        else finish();
      };
      closeTimer.current = window.setTimeout(tick, ms);
    },
    [finish],
  );

  const bumpIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (!hovered.current && micRef.current === "off") finish();
      else bumpIdle();
    }, INACTIVITY_MS);
  }, [finish]);

  const startMic = useCallback(() => {
    if (finished.current) return;
    stopSpeaking();
    clearTimeout(closeTimer.current);
    micRef.current = "listening";
    setMic("listening");
    onEyeState("listening");
    api.voiceListen().catch(() => {
      micRef.current = "off";
      setMic("off");
    });
    bumpIdle();
  }, [onEyeState, bumpIdle]);

  // Greeting (and, when summoned by voice, listen right after it).
  useEffect(() => {
    onEyeState(greet ? "appearing" : "idle");
    const t = window.setTimeout(() => onEyeState("listening"), greet ? 550 : 0);
    const spoken = greet ? speak(greeting, voiceOpts(settingsRef.current)) : Promise.resolve();
    if (autoListen) spoken.then(() => startMic());
    else inputRef.current?.focus();
    bumpIdle();
    return () => {
      clearTimeout(t);
      clearTimeout(closeTimer.current);
      clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voice engine events for this panel.
  useEffect(
    () =>
      on<VoiceEvent>("voice", (e) => {
        if (micRef.current === "off" || finished.current) return;
        switch (e.evt) {
          case "level":
            onLevel?.(e.v ?? 0);
            break;
          case "transcribing":
            micRef.current = "transcribing";
            setMic("transcribing");
            onLevel?.(0);
            onEyeState("thinking");
            break;
          case "final": {
            micRef.current = "off";
            setMic("off");
            onLevel?.(0);
            const heard = (e.text ?? "").trim();
            if (heard) submit(heard);
            else {
              setBubble("I didn't hear anything. Say it again, or type it.");
              onEyeState("listening");
              inputRef.current?.focus();
            }
            break;
          }
          case "error":
            micRef.current = "off";
            setMic("off");
            onLevel?.(0);
            setPhase("error");
            setBubble(e.msg === "no_mic" ? "I can't hear you. Check your microphone." : "My ears failed me. Please type it.");
            onEyeState("error");
            inputRef.current?.focus();
            break;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleResult = async (r: CommandResult) => {
    setSummary(r.summary);
    setHistoryId(r.historyId);
    setBubble(r.message);
    const vo = voiceOpts(settingsRef.current);
    switch (r.kind) {
      case "done":
        setPhase("done");
        onEyeState("speaking");
        await speak(r.message, vo);
        onEyeState("idle");
        closeAfter(2600 + r.summary.length * 600);
        break;
      case "answer":
        setPhase("answer");
        onEyeState("speaking");
        await speak(r.message, vo);
        onEyeState("idle");
        closeAfter(3500 + r.message.length * 45);
        break;
      case "clarify":
        setPhase("clarify");
        onEyeState("speaking");
        await speak(r.message, vo);
        onEyeState("listening");
        if (voiceMode.current && voice.available) startMic();
        else inputRef.current?.focus();
        bumpIdle();
        break;
      case "error":
        setPhase("error");
        onEyeState("error");
        await speak(r.message, vo);
        window.setTimeout(() => onEyeState("listening"), 700);
        inputRef.current?.focus();
        bumpIdle();
        break;
    }
  };

  async function submit(raw?: string) {
    const t = (raw ?? text).trim();
    if (!t || phase === "thinking") return;
    if (raw === undefined) {
      voiceMode.current = false; // typed: don't auto-listen afterwards
      stopMic();
    }
    clearTimeout(closeTimer.current);
    clearTimeout(idleTimer.current);
    stopSpeaking();
    setText("");
    setPhase("thinking");
    setSummary([]);
    setBubble(t);
    onEyeState("thinking");
    try {
      const r = await api.runCommand(session.current, t);
      if (finished.current) return;
      await handleResult(r);
    } catch (e) {
      await handleResult({ kind: "error", message: String(e), summary: [], historyId: null });
    }
  }

  const undo = async () => {
    if (!historyId) return;
    clearTimeout(closeTimer.current);
    try {
      await api.undoCommand(historyId);
      setPhase("undone");
      setBubble("Undone.");
      setSummary([]);
      setHistoryId(null);
      speak("Undone.", voiceOpts(settingsRef.current));
      closeAfter(1600);
    } catch (e) {
      setBubble(String(e));
    }
  };

  const toggleMic = () => {
    if (mic === "off") {
      voiceMode.current = true;
      startMic();
    } else {
      voiceMode.current = false;
      stopMic();
      onEyeState("listening");
      inputRef.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const showInput = phase !== "done" && phase !== "undone" && phase !== "answer";
  const echo = phase === "thinking";
  const placeholder =
    mic === "listening" ? "Listening…" : mic === "transcribing" ? "Understanding what you said…" : phase === "clarify" ? "Your answer…" : "Type a command…";

  return (
    <motion.div
      className={`cmd cmd--${placement} cmd--${phase} ${showInput ? "cmd--has-input" : ""}`}
      initial={{ opacity: 0, y: placement === "overlay" ? 14 : -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === "overlay" ? 10 : -8, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: placement === "overlay" ? 0.25 : 0 }}
      onMouseEnter={() => (hovered.current = true)}
      onMouseLeave={() => (hovered.current = false)}
      onKeyDown={onKey}
    >
      <div className="cmd__bubble">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={bubble + phase}
            className={`cmd__text ${echo ? "cmd__text--echo" : ""}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {echo ? <>“{bubble}”</> : bubble}
            {echo && (
              <span className="cmd__dots">
                <i />
                <i />
                <i />
              </span>
            )}
          </motion.div>
        </AnimatePresence>
        {summary.length > 0 && (
          <motion.ul className="cmd__summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </motion.ul>
        )}
        {phase === "done" && historyId && (
          <div className="cmd__actions">
            <button className="btn ghost cmd__undo" onClick={undo}>
              ↶ Undo
            </button>
          </div>
        )}
      </div>

      {showInput && (
        <div className={`cmd__input ${mic !== "off" ? "cmd__input--mic" : ""}`}>
          <input
            ref={inputRef}
            className="input"
            placeholder={placeholder}
            value={text}
            disabled={phase === "thinking"}
            onChange={(e) => {
              setText(e.target.value);
              if (micRef.current !== "off") {
                voiceMode.current = false;
                stopMic();
              }
              bumpIdle();
            }}
            spellCheck={false}
          />
          {voice.available && (
            <button
              className={`btn icon cmd__mic ${mic !== "off" ? "on" : ""}`}
              onClick={toggleMic}
              disabled={phase === "thinking" || mic === "transcribing"}
              title={mic === "off" ? "Speak" : "Stop listening"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
          <button className="btn primary icon" onClick={() => submit()} disabled={!text.trim() || phase === "thinking"} title="Send (Enter)">
            ➤
          </button>
        </div>
      )}
    </motion.div>
  );
}
