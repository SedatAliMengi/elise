import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import Eye from "../components/Eye";
import SummonCircle, { type RitualPhase } from "../components/SummonCircle";
import { speak } from "../lib/speech";
import type { EyeState, Settings } from "../lib/types";
import { voiceOpts } from "../lib/useSettings";

const LINES = ["Even a godlike being cannot touch the thread of time…", "One must await patiently to see what is to come."];
const MIN_SHOW_MS = 9000;
const HOLD_AFTER_SPEECH_MS = 2500;

interface Props {
  eye: EyeState;
  onEye: (s: EyeState) => void;
  settings: Settings;
  onDone: () => void;
}

/** Elise in the middle of the screen (not full screen) when a future year's checklist is asked for. */
export default function Oracle({ eye, onEye, settings, onDone }: Props) {
  const [ritual, setRitual] = useState<RitualPhase>("summon");
  const done = useRef(false);
  const close = () => {
    if (done.current) return;
    done.current = true;
    setRitual("dismiss");
    onDone();
  };

  useEffect(() => {
    const started = Date.now();
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setRitual("off"), 2800));
    timers.push(
      window.setTimeout(() => {
        onEye("speaking");
        speak(LINES.join(" "), voiceOpts(settings)).then(() => {
          onEye("idle");
          const wait = Math.max(HOLD_AFTER_SPEECH_MS, MIN_SHOW_MS - (Date.now() - started));
          timers.push(window.setTimeout(close, wait));
        });
      }, 900),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="oracle" onClick={close} onContextMenu={(e) => e.preventDefault()} title="Click to close">
      <div className="oracle__veil" />
      <div className="oracle__eye">
        <SummonCircle phase={ritual} size={340} />
        <Eye state={eye} size={200} appearDelay={0.65} />
      </div>
      <div className="oracle__words">
        {LINES.map((l, i) => (
          <motion.p
            key={i}
            className="oracle__line"
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.4, delay: 1.2 + i * 2.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {l}
          </motion.p>
        ))}
      </div>
    </div>
  );
}
