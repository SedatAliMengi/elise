import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import CommandPanel from "../components/CommandPanel";
import { api } from "../lib/api";
import Eye from "../components/Eye";
import type { EyeState, Settings } from "../lib/types";

interface Props {
  settings: Settings;
}

/** Custom title bar with Elise's eye overseeing the calendar from the top middle. */
export default function TitleBar({ settings }: Props) {
  const win = getCurrentWindow();
  const [cmdKey, setCmdKey] = useState<number | null>(null);
  const [eye, setEye] = useState<EyeState>("appearing");
  const [level, setLevel] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setEye("idle"), 700);
    win.isMaximized().then(setMaximized);
    const un = win.onResized(() => win.isMaximized().then(setMaximized));
    return () => {
      clearTimeout(t);
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click outside closes the panel.
  useEffect(() => {
    if (cmdKey === null) return;
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".titlebar__eye")) {
        setCmdKey(null);
        setEye("idle");
      }
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [cmdKey]);

  const toggle = () => {
    if (cmdKey !== null) {
      setCmdKey(null);
      setEye("idle");
    } else setCmdKey(Date.now());
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <span className="titlebar__name">Elise</span>
      </div>

      <div className="titlebar__center">
        <div className="titlebar__eye">
          <Eye state={eye} size={112} level={level} onClick={toggle} title="Command Elise" />
        </div>
        <AnimatePresence>
          {cmdKey !== null && (
            <div className="titlebar__panel" ref={panelRef}>
              <CommandPanel
                key={cmdKey}
                settings={settings}
                placement="calendar"
                onEyeState={(s) => setEye(s === "appearing" ? "listening" : s)}
                onLevel={setLevel}
                onFinish={() => {
                  setCmdKey(null);
                  setEye("idle");
                }}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      <div className="titlebar__controls">
        <button className="wc" onClick={() => win.minimize()} title="Minimize">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="wc" onClick={() => win.toggleMaximize()} title={maximized ? "Restore" : "Maximize"}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1"><rect x="1" y="3" width="6" height="6" /><path d="M3 3V1h6v6H7" /></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1"><rect x="1" y="1" width="8" height="8" /></svg>
          )}
        </button>
        <button className="wc wc--close" onClick={() => api.hideCalendar()} title="Close to tray">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
      <motion.div className="titlebar__line" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
    </header>
  );
}
