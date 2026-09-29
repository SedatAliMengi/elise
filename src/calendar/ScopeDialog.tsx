import { motion } from "motion/react";
import { useEffect } from "react";
import type { Scope } from "../lib/types";

interface Props {
  action: "edit" | "delete" | "move";
  onPick: (s: Scope | null) => void;
}

/** "This occurrence / this and following / all" for repeating events. */
export default function ScopeDialog({ action, onPick }: Props) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onPick(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onPick]);

  const verb = action === "delete" ? "Delete" : action === "move" ? "Move" : "Change";
  return (
    <motion.div className="modal-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => onPick(null)}>
      <motion.div
        className="modal scope"
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{verb} a repeating event</h3>
        <p>Which occurrences should this apply to?</p>
        <div className="scope__options">
          <button className="btn" onClick={() => onPick("this")}>
            Only this one
          </button>
          <button className="btn" onClick={() => onPick("following")}>
            This and following
          </button>
          <button className={`btn ${action === "delete" ? "danger" : "primary"}`} onClick={() => onPick("all")}>
            All of them
          </button>
        </div>
        <button className="btn ghost scope__cancel" onClick={() => onPick(null)}>
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
}
