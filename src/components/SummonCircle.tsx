import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import "./SummonCircle.css";

/**
 * The summoning circle drawn behind Elise's eye when she appears: the outer
 * ring traces itself, rays flare, rune rings fade in and counter-rotate, the
 * core flares, then the circle fades as the eye opens. "think" keeps a faint
 * rune ring turning behind the eye; "dismiss" is a quick flash-and-collapse.
 *
 * Performance: Elise draws without the GPU, and the big eye makes this circle
 * about 1000 px wide with blur filters. So every moving part is its own layer
 * (a separate <svg> in its own div) and moves only by transform/opacity on
 * that div: the blurred drawing is rasterised once and then just moved, not
 * redrawn every frame. Nothing animates inside an <svg> except the two
 * one-shot effects (the ring tracing itself, the core flare), each in a small
 * layer of its own.
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
const OUTER_C = 2 * Math.PI * 112;

interface Props {
  phase: RitualPhase;
  /** Diameter in px. */
  size?: number;
}

/** One layer: a full-size <svg> with its own copy of the filters it uses. */
function Layer({ id, size, children }: { id: (n: string) => string; size: number; children: ReactNode }) {
  return (
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
      {children}
    </svg>
  );
}

export default function SummonCircle({ phase, size = 250 }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (phase === "off") return null;

  const summon = phase === "summon";
  // Every layer has its own ids, so each <svg> resolves its own filters.
  const ids = (layer: string) => (n: string) => `${n}-${layer}-${uid}`;
  const L = (layer: string, draw: (id: (n: string) => string) => ReactNode, className = "", motionProps: object = {}) => {
    const id = ids(layer);
    return (
      <motion.div key={layer} className={`ritual__layer ${className}`} {...motionProps}>
        <Layer id={id} size={size}>
          {draw(id)}
        </Layer>
      </motion.div>
    );
  };

  return (
    <motion.div
      className={`ritual ritual--${phase}`}
      style={{ width: size, height: size }}
      aria-hidden
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
    >
      {/* static: red haze and the fixed rings */}
      {L(
        "base",
        (id) => (
          <>
            <circle r="110" fill="#ff0000" opacity="0.12" filter={`url(#${id("haze")})`} />
            <g filter={`url(#${id("glow")})`}>
              <circle r="104" fill="none" stroke="#ff2020" strokeWidth="1" opacity="0.8" />
              <circle r="81" fill="none" stroke="#ff2020" strokeWidth="2" />
              <circle r="76" fill="none" stroke="#ff2020" strokeWidth="0.8" opacity="0.7" strokeDasharray="2 4" />
              <circle r="47" fill="none" stroke="#ff2020" strokeWidth="0.8" opacity="0.7" />
            </g>
          </>
        ),
      )}

      {/* rays: fade in, then flicker (opacity on the layer) */}
      {L(
        "rays",
        (id) => (
          <g filter={`url(#${id("glow")})`}>
            {RAYS.map((d, i) => (
              <path key={i} d={d} fill={`url(#${id("ray")})`} />
            ))}
          </g>
        ),
        "ritual__fade",
        {
          initial: summon ? { opacity: 0 } : false,
          animate: { opacity: phase === "think" ? 0 : 1 },
          transition: { delay: summon ? 0.35 : 0, duration: 0.4 },
        },
      )}

      {/* outer ring traces itself (a one-shot redraw of a thin ring) */}
      {L(
        "trace",
        (id) => (
          <g filter={`url(#${id("glow")})`}>
            <motion.circle
              r="112"
              fill="none"
              stroke="#ff2020"
              strokeWidth="3"
              strokeDasharray={OUTER_C}
              initial={summon ? { strokeDashoffset: OUTER_C } : false}
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              transform="rotate(-90)"
            />
          </g>
        ),
      )}

      {/* outer rune ring */}
      {L(
        "runes1",
        (id) => (
          <text className="ritual__runes" fontSize="15" fill="#ff4545" filter={`url(#${id("soft")})`}>
            <textPath href={`#${id("p1")}`} textLength={2 * Math.PI * 87 - 6} lengthAdjust="spacing">
              {runeLine(22, 0)}
            </textPath>
          </text>
        ),
        "ritual__spin ritual__spin--cw",
        {
          initial: summon ? { opacity: 0 } : false,
          animate: { opacity: 1 },
          transition: { delay: summon ? 0.2 : 0, duration: 0.45 },
        },
      )}

      {/* inner rune ring (counter-rotates) */}
      {L(
        "runes2",
        (id) => (
          <text className="ritual__runes" fontSize="11" fill="#ff5555" filter={`url(#${id("soft")})`}>
            <textPath href={`#${id("p2")}`} textLength={2 * Math.PI * 58 - 6} lengthAdjust="spacing">
              {runeLine(17, 5)}
            </textPath>
          </text>
        ),
        "ritual__spin ritual__spin--ccw",
        {
          initial: summon ? { opacity: 0 } : false,
          animate: { opacity: 1 },
          transition: { delay: summon ? 0.35 : 0, duration: 0.45 },
        },
      )}

      {/* core flares: brightness and a slight swell on the layer */}
      {L(
        "core",
        (id) => (
          <circle filter={`url(#${id("glow")})`} r="52" fill="none" stroke="#ff3030" strokeWidth="3.5" />
        ),
        "",
        {
          initial: summon ? { opacity: 0, scale: 1 } : false,
          animate: summon ? { opacity: [0, 1, 0.7], scale: [1, 1.035, 1] } : { opacity: 0.8 },
          transition: { delay: summon ? 0.55 : 0, duration: 0.6 },
        },
      )}
    </motion.div>
  );
}
