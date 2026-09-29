import { addDays, differenceInMinutes, format, set } from "date-fns";
import { motion } from "motion/react";
import { useState } from "react";
import { fmtTime, fmtUntil, fromNaive } from "../lib/dates";
import type { ReminderPayload } from "../lib/types";

interface Props {
  reminder: ReminderPayload;
  time24h: boolean;
  defaultTime: string;
  more: number;
  onDismiss: () => void;
  onSnooze: (minutes: number) => void;
  onOpen: () => void;
}

export default function ReminderCard({ reminder: r, time24h, defaultTime, more, onDismiss, onSnooze, onOpen }: Props) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const d = fromNaive(r.start);
  const when = r.allDay ? format(d, "EEEE d MMM") : `${format(d, "EEEE d MMM")} · ${fmtTime(d, time24h)}`;

  const tomorrowMinutes = () => {
    const [h, m] = defaultTime.split(":").map(Number);
    const t = set(addDays(new Date(), 1), { hours: h || 9, minutes: m || 0, seconds: 0 });
    return Math.max(1, differenceInMinutes(t, new Date()));
  };

  return (
    <motion.div
      className="rem"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
    >
      <div className="rem__head">
        <span className="rem__dot" />
        Reminder
        {r.missed && <span className="rem__missed">missed</span>}
        {more > 0 && <span className="rem__more">+{more} more</span>}
      </div>
      <button className="rem__title" onClick={onOpen} title="Open in calendar">
        {r.title}
      </button>
      <div className="rem__when">
        {when} <span className="rem__rel">· {fmtUntil(d, r.allDay)}</span>
      </div>
      {r.location && <div className="rem__loc">⌖ {r.location}</div>}
      <div className="rem__actions">
        {snoozeOpen ? (
          <>
            <button className="btn" onClick={() => onSnooze(10)}>10 min</button>
            <button className="btn" onClick={() => onSnooze(60)}>1 hour</button>
            <button className="btn" onClick={() => onSnooze(tomorrowMinutes())}>Tomorrow</button>
          </>
        ) : (
          <>
            <button className="btn ghost" onClick={() => setSnoozeOpen(true)}>Snooze</button>
            <button className="btn primary" onClick={onDismiss}>Dismiss</button>
          </>
        )}
      </div>
    </motion.div>
  );
}
