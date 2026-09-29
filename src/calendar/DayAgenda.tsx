import { format } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { fmtRelativeDay, fmtTime, isSameDay } from "../lib/dates";
import { colorOf, occKey, type Occ } from "./util";

interface Props {
  day: Date;
  occs: Occ[];
  h24: boolean;
  onOpen: (o: Occ) => void;
  onCreate: () => void;
}

export default function DayAgenda({ day, occs, h24, onOpen, onCreate }: Props) {
  const rel = fmtRelativeDay(day);
  return (
    <aside className="agenda">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={day.toDateString()}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="agenda__inner"
        >
          <div className="agenda__head">
            <div className="agenda__dow">{format(day, "EEEE")}</div>
            <div className="agenda__date">
              {format(day, "d MMMM yyyy")}
              {isSameDay(day, new Date()) ? <span className="agenda__today">today</span> : <span className="agenda__rel">{rel}</span>}
            </div>
          </div>
          <div className="agenda__list">
            {occs.length === 0 && <div className="agenda__empty">Nothing planned.</div>}
            {occs.map((o, i) => (
              <motion.button
                key={occKey(o)}
                className="aitem"
                style={{ "--c": colorOf(o.event) } as React.CSSProperties}
                onClick={() => onOpen(o)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.2 }}
              >
                <span className="aitem__bar" />
                <span className="aitem__time">{o.event.allDay ? "All day" : fmtTime(o.s, h24)}</span>
                <span className="aitem__body">
                  <span className="aitem__title">{o.event.title}</span>
                  {(o.event.location || !o.event.allDay) && (
                    <span className="aitem__meta">
                      {!o.event.allDay && `${fmtTime(o.s, h24)} – ${fmtTime(o.e, h24)}`}
                      {o.event.location ? ` · ${o.event.location}` : ""}
                    </span>
                  )}
                </span>
                <span className="aitem__icons">
                  {o.event.recurrence && <span title="Repeats">↻</span>}
                  {o.event.reminders.length > 0 && <span title={`${o.event.reminders.length} reminder(s)`}>🔔</span>}
                </span>
              </motion.button>
            ))}
          </div>
          <button className="btn agenda__add" onClick={onCreate}>
            + Add event
          </button>
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
