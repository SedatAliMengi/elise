import { format, getYear, setMonth, setYear } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { fromNaive } from "../lib/dates";
import type { CalEvent } from "../lib/types";
import { colorOf, type View } from "./util";

interface Props {
  view: View;
  cursor: Date;
  title: string;
  onView: (v: View) => void;
  onNav: (dir: -1 | 1) => void;
  onToday: () => void;
  onJump: (d: Date) => void;
  onNew: () => void;
  onSettings: () => void;
  onOpenEvent: (e: CalEvent) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

const VIEWS: View[] = ["year", "month", "week", "day"];

export default function Toolbar(p: Props) {
  const [jumpOpen, setJumpOpen] = useState(false);

  return (
    <div className="toolbar">
      <div className="toolbar__left">
        <button className="btn" onClick={p.onToday} title="Today (T)">
          Today
        </button>
        <div className="toolbar__arrows">
          <button className="btn ghost icon" onClick={() => p.onNav(-1)} title="Previous (←)">
            ‹
          </button>
          <button className="btn ghost icon" onClick={() => p.onNav(1)} title="Next (→)">
            ›
          </button>
        </div>
        <div className="toolbar__title-wrap">
          <button className="toolbar__title" onClick={() => setJumpOpen((o) => !o)} title="Jump to a date">
            {p.title}
            <span className="toolbar__caret">▾</span>
          </button>
          <AnimatePresence>
            {jumpOpen && (
              <JumpPicker
                cursor={p.cursor}
                onPick={(d) => {
                  p.onJump(d);
                  setJumpOpen(false);
                }}
                onClose={() => setJumpOpen(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="toolbar__right">
        <Search onOpen={p.onOpenEvent} inputRef={p.searchRef} />
        <div className="segmented">
          {VIEWS.map((v) => (
            <button key={v} className={p.view === v ? "active" : ""} onClick={() => p.onView(v)} title={`${v[0].toUpperCase()}${v.slice(1)} (${v[0].toUpperCase()})`}>
              {p.view === v && <motion.span layoutId="seg" className="seg-indicator" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn icon ghost" onClick={p.onSettings} title="Settings">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
        <button className="btn primary" onClick={p.onNew} title="New event (N)">
          + New
        </button>
      </div>
    </div>
  );
}

function JumpPicker({ cursor, onPick, onClose }: { cursor: Date; onPick: (d: Date) => void; onClose: () => void }) {
  const [year, setYearState] = useState(getYear(cursor));
  const [yearText, setYearText] = useState(String(getYear(cursor)));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".toolbar__title")) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [onClose]);

  const commitYear = (y: number) => {
    if (!Number.isFinite(y) || y < 1 || y > 9999) return;
    setYearState(y);
    setYearText(String(y));
  };

  return (
    <motion.div
      ref={ref}
      className="jump"
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="jump__year">
        <button className="btn ghost icon" onClick={() => commitYear(year - 1)}>‹</button>
        <input
          className="input jump__year-input"
          value={yearText}
          inputMode="numeric"
          onChange={(e) => {
            setYearText(e.target.value.replace(/\D/g, "").slice(0, 4));
            const y = parseInt(e.target.value, 10);
            if (y >= 1 && y <= 9999 && e.target.value.length === 4) setYearState(y);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onPick(setMonth(setYear(cursor, parseInt(yearText, 10) || year), 0));
          }}
          onBlur={() => commitYear(parseInt(yearText, 10))}
          title="Type any year and press Enter"
        />
        <button className="btn ghost icon" onClick={() => commitYear(year + 1)}>›</button>
      </div>
      <div className="jump__months">
        {Array.from({ length: 12 }, (_, m) => {
          const d = new Date(year, m, 1);
          const active = getYear(cursor) === year && cursor.getMonth() === m;
          const now = new Date();
          const isNow = now.getFullYear() === year && now.getMonth() === m;
          return (
            <button key={m} className={`jump__month ${active ? "active" : ""} ${isNow ? "now" : ""}`} onClick={() => onPick(d)}>
              {format(d, "MMM")}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function Search({ onOpen, inputRef }: { onOpen: (e: CalEvent) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CalEvent[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => api.searchEvents(q).then(setResults).catch(() => setResults([])), 180);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="search">
      <svg className="search__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        className="input search__input"
        placeholder="Search events"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQ("");
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" && results[0]) {
            onOpen(results[0]);
            setOpen(false);
          }
        }}
      />
      <AnimatePresence>
        {open && q.trim() && (
          <motion.div className="search__results" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            {results.length === 0 && <div className="search__empty">No events found</div>}
            {results.map((ev) => (
              <button
                key={ev.id}
                className="search__item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onOpen(ev);
                  setOpen(false);
                }}
              >
                <span className="dot" style={{ background: colorOf(ev) }} />
                <span className="search__title">{ev.title}</span>
                <span className="search__date">
                  {format(fromNaive(ev.start), "d MMM yyyy")}
                  {ev.recurrence ? " ↻" : ""}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
