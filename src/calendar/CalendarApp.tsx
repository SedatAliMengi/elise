import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfWeek,
  format,
  isSameMonth,
  set,
  startOfDay,
  startOfYear,
} from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, on } from "../lib/api";
import { fromNaive, monthGrid, toNaive, weekDays, weekStartsOn } from "../lib/dates";
import type { CalEvent, Scope } from "../lib/types";
import { useSettings } from "../lib/useSettings";
import DayAgenda from "./DayAgenda";
import EventEditor, { type EditorTarget } from "./EventEditor";
import MonthView from "./MonthView";
import ScopeDialog from "./ScopeDialog";
import SettingsPanel from "./SettingsPanel";
import TitleBar from "./TitleBar";
import Toolbar from "./Toolbar";
import { blankEvent, hydrate, movedTo, type Occ, type View } from "./util";
import WeekView from "./WeekView";
import YearView from "./YearView";
import "./calendar.css";

interface ScopeReq {
  action: "edit" | "delete" | "move";
  resolve: (s: Scope | null) => void;
}

export default function CalendarApp() {
  const settings = useSettings();
  const monday = settings.weekStartsMonday;
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [dir, setDir] = useState(0);
  const [occs, setOccs] = useState<Occ[]>([]);
  const [dayOccs, setDayOccs] = useState<Occ[]>([]);
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scopeReq, setScopeReq] = useState<ScopeReq | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ----- visible range -----
  const { from, to, days } = useMemo(() => {
    if (view === "year") {
      const f = startOfYear(cursor);
      return { from: f, to: addYears(f, 1), days: [] as Date[] };
    }
    if (view === "month") {
      const g = monthGrid(cursor, monday);
      return { from: g[0], to: addDays(g[41], 1), days: g };
    }
    if (view === "week") {
      const w = weekDays(cursor, monday);
      return { from: w[0], to: addDays(w[6], 1), days: w };
    }
    const d = startOfDay(cursor);
    return { from: d, to: addDays(d, 1), days: [d] };
  }, [view, cursor, monday]);

  useEffect(() => {
    let live = true;
    api
      .listOccurrences(toNaive(from), toNaive(to))
      .then((r) => live && setOccs(r.map(hydrate)))
      .catch((e) => setToast(String(e)));
    return () => {
      live = false;
    };
  }, [from, to, version]);

  useEffect(() => {
    let live = true;
    api
      .listOccurrences(toNaive(selected), toNaive(addDays(selected, 1)))
      .then((r) => live && setDayOccs(r.map(hydrate)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [selected, version]);

  useEffect(() => {
    const offs = [on("events-changed", () => setVersion((v) => v + 1)), on("open-settings", () => setSettingsOpen(true))];
    const onVis = () => document.documentElement.classList.toggle("hidden-doc", document.hidden);
    document.addEventListener("visibilitychange", onVis);
    // Refresh "today" markers when the window comes back after midnight.
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      offs.forEach((f) => f());
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ----- navigation -----
  const nav = useCallback(
    (d: -1 | 1) => {
      setDir(d);
      setCursor((c) => {
        const n = view === "year" ? addYears(c, d) : view === "month" ? addMonths(c, d) : view === "week" ? addWeeks(c, d) : addDays(c, d);
        if (view === "day") setSelected(startOfDay(n));
        return n;
      });
    },
    [view],
  );

  const goTo = useCallback((d: Date, v?: View) => {
    setCursor((c) => {
      setDir(d < c ? -1 : d > c ? 1 : 0);
      return d;
    });
    setSelected(startOfDay(d));
    if (v) setView(v);
  }, []);

  const switchView = (v: View) => {
    setDir(0);
    if (v === "day" || v === "week") setCursor(selected);
    else if (!isSameMonth(cursor, selected) && v === "month") setCursor(selected);
    setView(v);
  };

  const title = useMemo(() => {
    if (view === "year") return format(cursor, "yyyy");
    if (view === "month") return format(cursor, "MMMM yyyy");
    if (view === "week") {
      const s = days[0];
      const e = endOfWeek(cursor, { weekStartsOn: weekStartsOn(monday) });
      return s.getMonth() === e.getMonth() ? `${format(s, "d")} – ${format(e, "d MMM yyyy")}` : `${format(s, "d MMM")} – ${format(e, "d MMM yyyy")}`;
    }
    return format(cursor, "EEEE, d MMMM yyyy");
  }, [view, cursor, days, monday]);

  // ----- editing -----
  const askScope = (action: ScopeReq["action"]) => new Promise<Scope | null>((resolve) => setScopeReq({ action, resolve }));

  const run = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      setToast(String(e));
    }
  };

  const openOcc = (o: Occ) =>
    setEditor({
      event: { ...o.event, start: o.start, end: o.event.allDay ? null : o.end },
      occStart: o.event.recurrence ? o.start : null,
      isNew: false,
    });

  const openEvent = (ev: CalEvent) => {
    goTo(fromNaive(ev.start));
    setEditor({ event: ev, occStart: null, isNew: false });
  };

  const create = (start?: Date, allDay = false) => {
    let s = start;
    if (!s) {
      const now = new Date();
      s = set(selected, { hours: now.getHours() + 1, minutes: 0, seconds: 0, milliseconds: 0 });
    }
    setEditor({ event: blankEvent(s, settings.defaultEventMinutes, allDay), occStart: null, isNew: true });
  };

  const createOnDay = (day: Date) => create(set(day, { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }));

  const onSave = async (ev: CalEvent) => {
    const t = editor!;
    if (t.isNew) {
      setEditor(null);
      return run(api.createEvent(ev));
    }
    let scope: Scope = "all";
    if (t.event.recurrence) {
      const s = await askScope("edit");
      if (!s) return;
      scope = s;
    }
    setEditor(null);
    run(api.updateEvent(ev.id, ev, t.occStart, scope));
  };

  const onDelete = async () => {
    const t = editor!;
    let scope: Scope = "all";
    if (t.event.recurrence) {
      const s = await askScope("delete");
      if (!s) return;
      scope = s;
    }
    setEditor(null);
    run(api.deleteEvent(t.event.id, t.occStart, scope));
  };

  const onMove = async (o: Occ, start: Date) => {
    let scope: Scope = "all";
    if (o.event.recurrence) {
      const s = await askScope("move");
      if (!s) return;
      scope = s;
    }
    run(api.updateEvent(o.event.id, movedTo(o, start), o.start, scope));
  };

  // ----- keyboard -----
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || editor || settingsOpen || scopeReq) return;
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.key) {
        case "ArrowLeft":
          nav(-1);
          break;
        case "ArrowRight":
          nav(1);
          break;
        case "t":
          goTo(new Date());
          break;
        case "n":
          create();
          break;
        case "y":
          switchView("year");
          break;
        case "m":
          switchView("month");
          break;
        case "w":
          switchView("week");
          break;
        case "d":
          switchView("day");
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const viewKey = `${view}-${toNaive(from)}`;
  const showAgenda = view === "month" || view === "year";

  return (
    <div className="app">
      <TitleBar settings={settings} />
      <Toolbar
        view={view}
        cursor={cursor}
        title={title}
        onView={switchView}
        onNav={nav}
        onToday={() => goTo(new Date())}
        onJump={(d) => goTo(d, view === "year" ? "month" : view === "day" || view === "week" ? view : undefined)}
        onNew={() => create()}
        onSettings={() => setSettingsOpen(true)}
        onOpenEvent={openEvent}
        searchRef={searchRef}
      />
      <main className="main">
        <div className="viewport">
          <AnimatePresence initial={false} custom={dir}>
            <motion.div
              key={viewKey}
              className="view"
              custom={dir}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 48, scale: d === 0 ? 0.985 : 1 }),
                center: { opacity: 1, x: 0, scale: 1 },
                exit: (d: number) => ({ opacity: 0, x: d * -48, scale: d === 0 ? 0.985 : 1 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              {view === "month" && (
                <MonthView
                  days={days}
                  month={cursor}
                  occs={occs}
                  selected={selected}
                  monday={monday}
                  h24={settings.time24h}
                  onSelect={setSelected}
                  onOpen={openOcc}
                  onCreate={createOnDay}
                  onMove={onMove}
                />
              )}
              {(view === "week" || view === "day") && (
                <WeekView
                  days={days}
                  occs={occs}
                  h24={settings.time24h}
                  onOpen={openOcc}
                  onCreate={(s, allDay) => create(s, allDay)}
                  onMove={onMove}
                  onSelectDay={(d) => {
                    setSelected(d);
                    if (view === "week") goTo(d, "day");
                  }}
                />
              )}
              {view === "year" && (
                <YearView
                  year={cursor.getFullYear()}
                  occs={occs}
                  selected={selected}
                  monday={monday}
                  onSelect={setSelected}
                  onOpenMonth={(d) => goTo(d, "month")}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <AnimatePresence initial={false}>
          {showAgenda && (
            <motion.div
              className="agenda-wrap"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <DayAgenda day={selected} occs={dayOccs} h24={settings.time24h} onOpen={openOcc} onCreate={() => createOnDay(selected)} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {editor && (
          <EventEditor
            key={editor.event.id + editor.occStart + editor.event.start}
            target={editor}
            defaultReminderTime={settings.defaultReminderTime}
            onSave={onSave}
            onDelete={onDelete}
            onClose={() => setEditor(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>{settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} />}</AnimatePresence>
      <AnimatePresence>
        {scopeReq && (
          <ScopeDialog
            action={scopeReq.action}
            onPick={(s) => {
              scopeReq.resolve(s);
              setScopeReq(null);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
