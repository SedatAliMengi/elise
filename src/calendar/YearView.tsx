import { format, isSameMonth } from "date-fns";
import { useMemo } from "react";
import { dateKey, isSameDay, monthGrid, weekdayLabels } from "../lib/dates";
import { occursOn, type Occ } from "./util";

interface Props {
  year: number;
  occs: Occ[];
  selected: Date;
  monday: boolean;
  onSelect: (d: Date) => void;
  onOpenMonth: (d: Date) => void;
}

export default function YearView({ year, occs, selected, monday, onSelect, onOpenMonth }: Props) {
  const today = new Date();
  const labels = weekdayLabels(monday, "narrow");

  // Event count per day for the heat dots.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of occs) {
      const d = new Date(o.s);
      d.setHours(0, 0, 0, 0);
      // Multi-day events mark each day they touch (capped to keep it cheap).
      for (let i = 0; i < 62; i++) {
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
        if (i > 0 && !occursOn(o, day)) break;
        const k = dateKey(day);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return m;
  }, [occs]);

  return (
    <div className="year">
      {Array.from({ length: 12 }, (_, mi) => {
        const month = new Date(year, mi, 1);
        const isNowMonth = isSameMonth(month, today);
        return (
          <div key={mi} className={`ymonth ${isNowMonth ? "ymonth--now" : ""}`}>
            <button className="ymonth__title" onClick={() => onOpenMonth(month)}>
              {format(month, "MMMM")}
            </button>
            <div className="ymonth__grid">
              {labels.map((l, i) => (
                <div key={i} className="ymonth__dow">
                  {l}
                </div>
              ))}
              {monthGrid(month, monday).map((d) => {
                const k = dateKey(d);
                const inMonth = isSameMonth(d, month);
                const n = inMonth ? counts.get(k) ?? 0 : 0;
                return (
                  <button
                    key={k}
                    className={`yday ${inMonth ? "" : "yday--out"} ${isSameDay(d, today) && inMonth ? "yday--today" : ""} ${
                      isSameDay(d, selected) && inMonth ? "yday--sel" : ""
                    } ${n ? "yday--has" : ""}`}
                    style={n ? ({ "--heat": Math.min(1, 0.35 + n * 0.2) } as React.CSSProperties) : undefined}
                    onClick={() => inMonth && onSelect(d)}
                    onDoubleClick={() => inMonth && onOpenMonth(d)}
                    tabIndex={inMonth ? 0 : -1}
                  >
                    {format(d, "d")}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
