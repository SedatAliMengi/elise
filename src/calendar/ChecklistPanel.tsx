import { isNihil } from "../lib/mode";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, on } from "../lib/api";
import type { ChecklistView } from "../lib/types";

interface Props {
  year: number;
  onYear: (y: number) => void;
  onClose: () => void;
}

/**
 * One checklist per year. This year: add, remove, tick. Past years: tick only.
 * Future years are locked: asking for one summons Elise in the middle of the
 * screen instead (see overlay "oracle").
 */
export default function ChecklistPanel({ year, onYear, onClose }: Props) {
  const [view, setView] = useState<ChecklistView | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.checklistGet(year));
      setErr(null);
    } catch (e) {
      // Shouldn't happen (future years never get here), but don't show a blank panel.
      setErr(String(e) === "future" ? "That year hasn't come yet." : String(e));
    }
  }, [year]);

  useEffect(() => {
    load();
    return on("checklist-changed", () => load());
  }, [load]);

  useEffect(() => {
    if (view?.canEdit) inputRef.current?.focus();
  }, [view?.year, view?.canEdit]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const goYear = (y: number) => {
    const current = view?.currentYear ?? new Date().getFullYear();
    if (y > current) {
      api.oracleShow(); // "Even a godlike being cannot touch the thread of time…"
      return;
    }
    onYear(y);
  };

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await api.checklistAdd(year, t);
      setText("");
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const toggle = async (id: string, done: boolean) => {
    if (!view?.canTick) return;
    // Instant feedback; the reload confirms it.
    setView((v) => v && { ...v, items: v.items.map((i) => (i.id === id ? { ...i, done } : i)) });
    try {
      await api.checklistSetDone(id, done);
    } catch (e) {
      setErr(String(e));
    }
    load();
  };

  const remove = async (id: string) => {
    try {
      await api.checklistRemove(id);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const items = view?.items ?? [];
  const done = items.filter((i) => i.done).length;
  const isPast = !!view && view.year < view.currentYear;
  const allDone = items.length > 0 && done === items.length;

  return (
    <motion.div className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="modal checklist"
        initial={{ scale: 0.97, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 12 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <Sigil />
        <button className="btn ghost icon checklist__close" onClick={onClose} title="Close (Esc)">
          ✕
        </button>

        <header className="checklist__head">
          <div className="checklist__kicker">Yearly checklist</div>
          <div className="checklist__years">
            <button className="checklist__arrow" onClick={() => goYear(year - 1)} title={`${year - 1}'s checklist`}>
              ‹
            </button>
            <span className="checklist__rule" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={year}
                className="checklist__year"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                {year}
              </motion.h2>
            </AnimatePresence>
            <span className="checklist__rule checklist__rule--r" />
            <button className="checklist__arrow" onClick={() => goYear(year + 1)} title={`${year + 1}'s checklist`}>
              ›
            </button>
          </div>
        </header>
        {items.length > 0 && <Ring done={done} total={items.length} />}

        {isPast && <div className="checklist__note">{year} is over. You can still tick things off, but the list can't change.</div>}

        {items.length === 0 && view && <p className="checklist__empty">{isPast ? `Nothing was written for ${year}.` : `What will ${year} hold?`}</p>}

        <ol className="checklist__items">
          <AnimatePresence initial={false}>
            {items.map((i, n) => (
              <motion.li
                key={i.id}
                className={`checklist__item ${i.done ? "done" : ""}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="checklist__num">{roman(n + 1)}</span>
                <button
                  className={`checklist__check ${i.done ? "on" : ""}`}
                  onClick={() => toggle(i.id, !i.done)}
                  disabled={!view?.canTick}
                  aria-pressed={i.done}
                  title={i.done ? "Mark as not done" : "Mark as done"}
                >
                  <span className="checklist__dot" />
                </button>
                <span className="checklist__text" onClick={() => toggle(i.id, !i.done)}>
                  <span className="checklist__label">{i.text}</span>
                </span>
                {view?.canEdit && (
                  <button className="checklist__remove" onClick={() => remove(i.id)} title="Remove">
                    ✕
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>

        <AnimatePresence>
          {allDone && (
            <motion.p className="checklist__fulfilled" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              Every promise of {year}, kept.
            </motion.p>
          )}
        </AnimatePresence>

        {view?.canEdit && (
          <div className="checklist__add">
            <span className="checklist__plus">+</span>
            <input
              ref={inputRef}
              className="checklist__input"
              placeholder={`Add something for ${year}…`}
              value={text}
              maxLength={300}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button className="btn primary" onClick={add} disabled={!text.trim()}>
              Add
            </button>
          </div>
        )}
        {err && <div className="set-msg bad checklist__err">{err}</div>}
      </motion.div>
    </motion.div>
  );
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function roman(n: number): string {
  let out = "";
  for (const [v, s] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

/** Progress as a ring in the eye's colours: iris purple into pupil red. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="checklist__ring" title={`${done} of ${total} done`}>
      <svg width="46" height="46" viewBox="0 0 46 46">
        <defs>
          <linearGradient id="ck-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={isNihil() ? "#7a0000" : "#b44cff"} />
            <stop offset="1" stopColor="#ff2a2a" />
          </linearGradient>
        </defs>
        <circle cx="23" cy="23" r={r} fill="none" stroke={isNihil() ? "#2a0606" : "#271a40"} strokeWidth="3" />
        <motion.circle
          cx="23"
          cy="23"
          r={r}
          fill="none"
          stroke="url(#ck-ring)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - done / total) }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          transform="rotate(-90 23 23)"
        />
      </svg>
      <span>
        {done}
        <small>/{total}</small>
      </span>
    </div>
  );
}

/** A faint, still rune ring behind the year (static, so it costs nothing per frame). */
function Sigil() {
  const ticks = Array.from({ length: 48 }, (_, i) => i * 7.5);
  return (
    <svg className="checklist__sigil" viewBox="-100 -100 200 200" aria-hidden>
      <circle r="92" fill="none" stroke="currentColor" strokeWidth="0.8" />
      <circle r="80" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 4" />
      <circle r="58" fill="none" stroke="currentColor" strokeWidth="0.6" />
      {ticks.map((a) => (
        <line
          key={a}
          x1="0"
          y1={a % 30 === 0 ? -92 : -88}
          x2="0"
          y2="-84"
          stroke="currentColor"
          strokeWidth={a % 30 === 0 ? 1.2 : 0.5}
          transform={`rotate(${a})`}
        />
      ))}
      <polygon points="0,-58 50,29 -50,29" fill="none" stroke="currentColor" strokeWidth="0.5" />
      <polygon points="0,58 50,-29 -50,-29" fill="none" stroke="currentColor" strokeWidth="0.5" />
    </svg>
  );
}
