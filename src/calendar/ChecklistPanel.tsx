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
        <div className="checklist__head">
          <div className="checklist__years">
            <button className="btn ghost icon" onClick={() => goYear(year - 1)} title={`${year - 1}'s checklist`}>
              ‹
            </button>
            <h2 className="checklist__year">{year}</h2>
            <button className="btn ghost icon" onClick={() => goYear(year + 1)} title={`${year + 1}'s checklist`}>
              ›
            </button>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="checklist__sub">
          {items.length ? (
            <>
              <span>
                {done} of {items.length} done
              </span>
              <div className="checklist__bar">
                <motion.div className="checklist__fill" animate={{ width: `${(done / items.length) * 100}%` }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </>
          ) : (
            <span>{isPast ? `Nothing was on your ${year} list.` : `What do you want to do in ${year}?`}</span>
          )}
        </div>
        {isPast && <div className="checklist__note">{year} is over. You can still tick things off, but the list can't change.</div>}

        <ul className="checklist__items">
          <AnimatePresence initial={false}>
            {items.map((i) => (
              <motion.li
                key={i.id}
                layout
                className={`checklist__item ${i.done ? "done" : ""}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
              >
                <button
                  className={`checklist__check ${i.done ? "on" : ""}`}
                  onClick={() => toggle(i.id, !i.done)}
                  disabled={!view?.canTick}
                  aria-pressed={i.done}
                  title={i.done ? "Mark as not done" : "Mark as done"}
                >
                  {i.done && "✓"}
                </button>
                <span className="checklist__text" onClick={() => toggle(i.id, !i.done)}>
                  {i.text}
                </span>
                {view?.canEdit && (
                  <button className="checklist__remove" onClick={() => remove(i.id)} title="Remove">
                    ✕
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        {view?.canEdit && (
          <div className="checklist__add">
            <input
              ref={inputRef}
              className="input"
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
