import { addMinutes, differenceInMinutes, format, set, startOfDay } from "date-fns";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { dateKey, fmtTime, isSameDay } from "../lib/dates";
import { colorOf, dragRegistry, occKey, occursOn, type Occ } from "./util";

interface Props {
  days: Date[];
  occs: Occ[];
  h24: boolean;
  onOpen: (o: Occ) => void;
  onCreate: (start: Date, allDay?: boolean) => void;
  onMove: (o: Occ, start: Date) => void;
  onSelectDay: (d: Date) => void;
}

const HOUR = 52; // px per hour
const SNAP = 15; // minutes
let grabMinutes = 0;

interface Placed {
  o: Occ;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** Lay out a day's timed events side by side where they overlap. */
function layoutDay(list: Occ[], day: Date): Placed[] {
  const ds = startOfDay(day);
  const items = list
    .map((o) => {
      const s = o.s < ds ? ds : o.s;
      const endCap = addMinutes(ds, 24 * 60);
      const e = o.e > endCap ? endCap : o.e;
      const startMin = differenceInMinutes(s, ds);
      const dur = Math.max(differenceInMinutes(e, s), 22);
      return { o, startMin, endMin: startMin + dur };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: Placed[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    const cols = cluster.map((it) => {
      let c = colEnds.findIndex((end) => end <= it.startMin);
      if (c === -1) {
        c = colEnds.length;
        colEnds.push(it.endMin);
      } else colEnds[c] = it.endMin;
      return c;
    });
    cluster.forEach((it, i) =>
      out.push({ o: it.o, top: (it.startMin / 60) * HOUR, height: ((it.endMin - it.startMin) / 60) * HOUR, col: cols[i], cols: colEnds.length }),
    );
    cluster = [];
    clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}

export default function WeekView({ days, occs, h24, onOpen, onCreate, onMove, onSelectDay }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const [ghost, setGhost] = useState<{ day: string; top: number } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Start scrolled to ~7:00 (or just above the current time on today).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const hasToday = days.some((d) => isSameDay(d, new Date()));
    const h = hasToday ? Math.max(0, new Date().getHours() - 2) : 7;
    el.scrollTop = h * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey(days[0]), days.length]);

  const allDay = useMemo(() => days.map((d) => occs.filter((o) => o.event.allDay && occursOn(o, d))), [days, occs]);
  const timed = useMemo(() => days.map((d) => layoutDay(occs.filter((o) => !o.event.allDay && occursOn(o, d)), d)), [days, occs]);

  const minutesAt = (e: React.MouseEvent | React.DragEvent, col: HTMLElement) => {
    const y = e.clientY - col.getBoundingClientRect().top;
    return Math.max(0, Math.min(24 * 60 - SNAP, Math.round(((y / HOUR) * 60) / SNAP) * SNAP));
  };

  return (
    <div className={`week ${days.length === 1 ? "week--day" : ""}`}>
      <div className="week__head">
        <div className="week__gutter" />
        {days.map((d) => (
          <button key={dateKey(d)} className={`week__dayhead ${isSameDay(d, now) ? "today" : ""}`} onClick={() => onSelectDay(d)}>
            <span className="week__dow">{format(d, "EEE")}</span>
            <span className="week__dnum">{format(d, "d")}</span>
          </button>
        ))}
      </div>
      <div className="week__allday">
        <div className="week__gutter week__gutter--label">all-day</div>
        {days.map((d, i) => (
          <div key={dateKey(d)} className="week__allday-cell" onDoubleClick={() => onCreate(startOfDay(d), true)}>
            {allDay[i].map((o) => (
              <div key={occKey(o)} className="pill pill--allday" style={{ "--c": colorOf(o.event) } as React.CSSProperties} onClick={() => onOpen(o)}>
                <span className="pill__title">{o.event.title}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="week__scroll" ref={scroller}>
        <div className="week__body" style={{ height: 24 * HOUR }}>
          <div className="week__gutter week__hours">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="week__hour" style={{ top: h * HOUR }}>
                {h === 0 ? "" : h24 ? `${String(h).padStart(2, "0")}:00` : format(set(new Date(), { hours: h, minutes: 0 }), "h a")}
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const k = dateKey(d);
            const isToday = isSameDay(d, now);
            return (
              <div
                key={k}
                className={`week__col ${isToday ? "today" : ""}`}
                onDoubleClick={(e) => {
                  const m = Math.floor(minutesAt(e, e.currentTarget) / 30) * 30;
                  onCreate(addMinutes(startOfDay(d), m));
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("text/elise")) return;
                  e.preventDefault();
                  const m = Math.max(0, minutesAt(e, e.currentTarget) - grabMinutes);
                  setGhost({ day: k, top: (m / 60) * HOUR });
                }}
                onDragLeave={() => setGhost(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setGhost(null);
                  const o = dragRegistry.get(e.dataTransfer.getData("text/elise"));
                  if (!o) return;
                  const m = Math.max(0, minutesAt(e, e.currentTarget) - grabMinutes);
                  const start = addMinutes(startOfDay(d), Math.round(m / SNAP) * SNAP);
                  if (start.getTime() !== o.s.getTime()) onMove(o, start);
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="week__line" style={{ top: h * HOUR }} />
                ))}
                {ghost?.day === k && <div className="week__ghost" style={{ top: ghost.top }} />}
                {timed[i].map((p) => (
                  <div
                    key={occKey(p.o)}
                    className="wevent"
                    style={
                      {
                        top: p.top,
                        height: Math.max(p.height - 2, 18),
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                        "--c": colorOf(p.o.event),
                      } as React.CSSProperties
                    }
                    draggable
                    onDragStart={(e) => {
                      dragRegistry.set(occKey(p.o), p.o);
                      e.dataTransfer.setData("text/elise", occKey(p.o));
                      e.dataTransfer.effectAllowed = "move";
                      const r = e.currentTarget.getBoundingClientRect();
                      grabMinutes = Math.floor((((e.clientY - r.top) / HOUR) * 60) / SNAP) * SNAP;
                    }}
                    onClick={() => onOpen(p.o)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title={p.o.event.title}
                  >
                    <div className="wevent__title">
                      {p.o.event.title}
                      {p.o.event.recurrence && <span className="pill__icon"> ↻</span>}
                    </div>
                    {p.height > 34 && (
                      <div className="wevent__time">
                        {fmtTime(p.o.s, h24)} – {fmtTime(p.o.e, h24)}
                        {p.o.event.location ? ` · ${p.o.event.location}` : ""}
                      </div>
                    )}
                  </div>
                ))}
                {isToday && (
                  <div className="week__now" style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR }}>
                    <span />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
