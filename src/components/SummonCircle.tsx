import { motion } from "motion/react";
import { useId } from "react";
import "./SummonCircle.css";

/**
 * The summoning circle drawn behind Elise's eye when she appears: the outer
 * ring traces itself, rays flare, rune rings fade in and counter-rotate, the
 * core flares, then the circle fades as the eye opens. "think" keeps a faint
 * rune ring turning behind the eye; "dismiss" is a quick flash-and-collapse.
 */

export type RitualPhase = "summon" | "think" | "dismiss" | "off";

// Elder Futhark (+ a few Anglo-Saxon runes), rendered with Segoe UI Historic.
const RUNES = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
const runeLine = (n: number, offset: number) =>
  Array.from({ length: n }, (_, i) => RUNES[(i * 7 + offset) % RUNES.length]).join(" ");

const RAYS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + (i % 2 ? 0.08 : 0);
  const long = i % 2 === 0;
  const r0 = 96;
  const r1 = long ? 146 : 124;
  const w = long ? 5 : 3.5;
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const p = (r: number, s: number) => `${(ux * r + vx * s).toFixed(1)},${(uy * r + vy * s).toFixed(1)}`;
  return `M${p(r0, -w)} L${p(r1, 0)} L${p(r0, w)} Z`;
});

const circlePath = (r: number) => `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r}`;

interface Props {
  phase: RitualPhase;
  /** Diameter in px. */
  size?: number;
}

export default function SummonCircle({ phase, size = 250 }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `${n}-${uid}`;
  if (phase === "off") return null;

  const outerC = 2 * Math.PI * 112;
  const summon = phase === "summon";

  return (
    <div className={`ritual ritual--${phase}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="-150 -150 300 300" width={size} height={size}>
        <defs>
          <filter id={id("glow")} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={id("soft")} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={id("haze")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <radialGradient id={id("ray")} cx="0" cy="0" r="146" gradientUnits="userSpaceOnUse">
            <stop offset="0.6" stopColor="#ff2a2a" stopOpacity="0.9" />
            <stop offset="1" stopColor="#ff2a2a" stopOpacity="0" />
          </radialGradient>
          <path id={id("p1")} d={circlePath(87)} />
          <path id={id("p2")} d={circlePath(58)} />
        </defs>

        <motion.g
          initial={summon ? { opacity: 0, scale: 0.8 } : false}
          animate={
            phase === "dismiss"
              ? { opacity: [0.9, 0], scale: [1, 0.5] }
              : phase === "think"
                ? { opacity: 0.32, scale: 1 }
                : { opacity: [0, 1, 1, 0], scale: [0.8, 1, 1.02, 1.12] }
          }
          transition={
            phase === "dismiss"
              ? { duration: 0.45, ease: [0.55, 0, 0.8, 0.2] }
              : phase === "think"
                ? { duration: 0.5 }
                : { duration: 2.8, times: [0, 0.14, 0.78, 1], ease: "easeInOut" }
          }
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        >
          {/* red haze */}
          <circle r="110" fill="#ff0000" opacity="0.12" filter={`url(#${id("haze")})`} />

          {/* rays */}
          <motion.g
            filter={`url(#${id("glow")})`}
            initial={summon ? { opacity: 0 } : false}
            animate={{ opacity: phase === "think" ? 0 : 1 }}
            transition={{ delay: summon ? 0.35 : 0, duration: 0.4 }}
          >
            <g className="ritual__rays">
              {RAYS.map((d, i) => (
                <path key={i} d={d} fill={`url(#${id("ray")})`} />
              ))}
            </g>
          </motion.g>

          {/* outer ring traces itself */}
          <g filter={`url(#${id("glow")})`}>
          <motion.circle
            r="112"
            fill="none"
            stroke="#ff2020"
            strokeWidth="3"
            strokeDasharray={outerC}
            initial={summon ? { strokeDashoffset: outerC } : false}
            animate={{ strokeDashoffset: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            transform="rotate(-90)"
          />
          <circle r="104" fill="none" stroke="#ff2020" strokeWidth="1" opacity="0.8" />
          <circle r="81" fill="none" stroke="#ff2020" strokeWidth="2" />
          <circle r="76" fill="none" stroke="#ff2020" strokeWidth="0.8" opacity="0.7" strokeDasharray="2 4" />
          <circle r="47" fill="none" stroke="#ff2020" strokeWidth="0.8" opacity="0.7" />
          </g>

          {/* outer rune ring */}
          <motion.g
            className="ritual__spin ritual__spin--cw"
            initial={summon ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: summon ? 0.2 : 0, duration: 0.45 }}
          >
            <text className="ritual__runes" fontSize="15" fill="#ff4545" filter={`url(#${id("soft")})`}>
              <textPath href={`#${id("p1")}`} textLength={2 * Math.PI * 87 - 6} lengthAdjust="spacing">
                {runeLine(22, 0)}
              </textPath>
            </text>
          </motion.g>

          {/* inner rune ring (counter-rotates) */}
          <motion.g
            className="ritual__spin ritual__spin--ccw"
            initial={summon ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: summon ? 0.35 : 0, duration: 0.45 }}
          >
            <text className="ritual__runes" fontSize="11" fill="#ff5555" filter={`url(#${id("soft")})`}>
              <textPath href={`#${id("p2")}`} textLength={2 * Math.PI * 58 - 6} lengthAdjust="spacing">
                {runeLine(17, 5)}
              </textPath>
            </text>
          </motion.g>

          {/* core flares */}
          <motion.circle
            filter={`url(#${id("glow")})`}
            r="52"
            fill="none"
            stroke="#ff3030"
            strokeWidth="2.5"
            initial={summon ? { opacity: 0 } : false}
            animate={summon ? { opacity: [0, 1, 0.7], strokeWidth: [2.5, 6, 2.5] } : { opacity: 0.8 }}
            transition={{ delay: summon ? 0.55 : 0, duration: 0.6 }}
          />
        </motion.g>
      </svg>
    </div>
  );
}
