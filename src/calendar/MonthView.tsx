import { format, isSameMonth, set } from "date-fns";
import { useState } from "react";
import { dateKey, fmtTime, isSameDay, weekdayLabels } from "../lib/dates";
import { colorOf, dragRegistry, occKey, occursOn, type Occ } from "./util";

interface Props {
  days: Date[];
  month: Date;
  occs: Occ[];
  selected: Date;
  monday: boolean;
  h24: boolean;
  onSelect: (d: Date) => void;
  onOpen: (o: Occ) => void;
  onCreate: (d: Date) => void;
  onMove: (o: Occ, start: Date) => void;
}

const MAX_PILLS = 3;

export default function MonthView({ days, month, occs, selected, monday, h24, onSelect, onOpen, onCreate, onMove }: Props) {
  const [over, setOver] = useState<string | null>(null);
  const today = new Date();

  return (
    <div className="month">
      <div className="month__head">
        {weekdayLabels(monday).map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      <div className="month__grid">
        {days.map((day) => {
          const k = dateKey(day);
          const list = occs.filter((o) => occursOn(o, day));
          const inMonth = isSameMonth(day, month);
          const isToday = isSameDay(day, today);
          const isSel = isSameDay(day, selected);
          return (
            <div
              key={k}
              className={`mcell ${inMonth ? "" : "mcell--out"} ${isSel ? "mcell--sel" : ""} ${over === k ? "mcell--over" : ""}`}
              onClick={() => onSelect(day)}
              onDoubleClick={() => onCreate(day)}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("text/elise")) {
                  e.preventDefault();
                  setOver(k);
                }
              }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const o = dragRegistry.get(e.dataTransfer.getData("text/elise"));
                if (!o || isSameDay(o.s, day)) return;
                onMove(o, set(day, { hours: o.s.getHours(), minutes: o.s.getMinutes(), seconds: 0 }));
              }}
            >
              <div className="mcell__top">
                <span className={`mcell__num ${isToday ? "mcell__num--today" : ""}`}>{format(day, "d")}</span>
              </div>
              <div className="mcell__pills">
                {list.slice(0, MAX_PILLS).map((o) => (
                  <div
                    key={occKey(o)}
                    className={`pill ${o.event.allDay ? "pill--allday" : ""}`}
                    style={{ "--c": colorOf(o.event) } as React.CSSProperties}
                    draggable
                    onDragStart={(e) => {
                      dragRegistry.set(occKey(o), o);
                      e.dataTransfer.setData("text/elise", occKey(o));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(o);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title={o.event.title}
                  >
                    {!o.event.allDay && <span className="pill__time">{fmtTime(o.s, h24)}</span>}
                    <span className="pill__title">{o.event.title}</span>
                    {o.event.recurrence && <span className="pill__icon">↻</span>}
                  </div>
                ))}
                {list.length > MAX_PILLS && <div className="mcell__more">+{list.length - MAX_PILLS} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
