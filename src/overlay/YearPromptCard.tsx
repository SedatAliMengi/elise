import { motion } from "motion/react";
import type { YearPrompt } from "../lib/types";

interface Props {
  prompt: YearPrompt;
  onOpen: () => void;
  onLater: () => void;
}

/** The last day of the year: Elise asks to go through the year's checklist. */
export default function YearPromptCard({ prompt: { year, missed }, onOpen, onLater }: Props) {
  return (
    <motion.div
      className="rem rem--year"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.2 } }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
    >
      <div className="rem__head">
        <span className="rem__dot" />
        {missed ? `${year} has ended` : `Last day of ${year}`}
      </div>
      <div className="rem__year-line">Time to check your {year} checklist.</div>
      <div className="rem__actions">
        <button className="btn ghost" onClick={onLater}>
          Later
        </button>
        <button className="btn primary" onClick={onOpen}>
          Open my {year} checklist
        </button>
      </div>
    </motion.div>
  );
}
