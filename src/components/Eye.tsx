import { animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useId, useMemo, useRef } from "react";
import type { EyeState } from "../lib/types";
import "./Eye.css";

/**
 * Elise's eye: almond outline, electric-purple iris, glowing red pupil.
 * Everything animates with transforms/opacity or a single path `d`, and all
 * loops stop while the document is hidden.
 */

const VB_W = 220;
const VB_H = 140;
const LID = 54; // control-point height of a fully open lid

const almond = (k: number) => {
  const h = LID * Math.max(0.02, k);
  return `M -92 0 C -48 ${-h} 48 ${-h} 92 0 C 48 ${h} -48 ${h} -92 0 Z`;
};

const FIBERS = Array.from({ length: 44 }, (_, i) => {
  const a = (i / 44) * Math.PI * 2 + (i % 3) * 0.03;
  const r0 = 14 + (i % 4);
  const r1 = 29 + (i % 5) * 1.2;
  return { x1: Math.cos(a) * r0, y1: Math.sin(a) * r0, x2: Math.cos(a) * r1, y2: Math.sin(a) * r1, o: 0.1 + (i % 5) * 0.045 };
});

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Props {
  state: EyeState;
  /** Rendered width in px. */
  size?: number;
  /** Microphone level 0..1 while listening. */
  level?: number;
  /** Softer look for the always-on hover eye. */
  dim?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
}

export default function Eye({ state, size = 120, level = 0, dim, onClick, onMouseDown, onContextMenu, title, className }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `${n}-${uid}`;

  const open = useMotionValue(state === "appearing" || state === "closed" ? 0.02 : 1);
  const d = useTransform(open, almond);
  const lookX = useSpring(0, { stiffness: 60, damping: 14 });
  const lookY = useSpring(0, { stiffness: 60, damping: 14 });
  const pupil = useSpring(1, { stiffness: 220, damping: 18 });
  const irisTransform = useTransform([lookX, lookY], ([x, y]) => `translate(${x}px, ${y}px)`);
  const pupilScale = useTransform(pupil, (p) => `scale(${p})`);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Open / close with the state.
  useEffect(() => {
    if (state === "appearing") {
      open.set(0.02);
      const c = animate(open, 1, { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.05 });
      return () => c.stop();
    }
    if (state === "vanishing") {
      const c = animate(open, 0.02, { duration: 0.32, ease: [0.55, 0, 0.8, 0.2] });
      return () => c.stop();
    }
    if (state === "closed") {
      open.set(0.02);
      return;
    }
    if (open.get() < 0.9) {
      const c = animate(open, 1, { duration: 0.35 });
      return () => c.stop();
    }
  }, [state, open]);

  // Natural blinking.
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        const s = stateRef.current;
        if (!document.hidden && (s === "idle" || s === "listening" || s === "speaking")) {
          animate(open, [1, 0.05, 1], { duration: 0.2, times: [0, 0.45, 1], ease: "easeInOut" });
        }
        loop();
      }, rand(4500, 9000));
    };
    loop();
    return () => clearTimeout(t);
  }, [open]);

  // Looking around while idle; centered focus otherwise.
  useEffect(() => {
    if (state !== "idle") {
      lookX.set(0);
      lookY.set(state === "thinking" ? -3 : 0);
      return;
    }
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        if (!document.hidden) {
          const center = Math.random() < 0.35;
          lookX.set(center ? 0 : rand(-12, 12));
          lookY.set(center ? 0 : rand(-5, 5));
        }
        loop();
      }, rand(2200, 4200));
    };
    loop();
    return () => clearTimeout(t);
  }, [state, lookX, lookY]);

  // Pupil size follows the state and the mic level.
  useEffect(() => {
    if (state === "listening") pupil.set(1 + Math.min(1, level) * 0.38);
    else if (state === "thinking") pupil.set(0.82);
    else if (state === "speaking") pupil.set(1.08);
    else pupil.set(1);
  }, [state, level, pupil]);

  const width = size;
  const height = (size * VB_H) / VB_W;
  const fibers = useMemo(
    () =>
      FIBERS.map((f, i) => (
        <line key={i} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} stroke="#f0d9ff" strokeOpacity={f.o} strokeWidth={0.9} strokeLinecap="round" />
      )),
    [],
  );

  return (
    <motion.div
      className={`eye eye--${state} ${dim ? "eye--dim" : ""} ${onClick ? "eye--clickable" : ""} ${className ?? ""}`}
      style={{ width, height }}
      initial={false}
      animate={{ opacity: state === "vanishing" || state === "closed" ? 0 : 1, scale: state === "vanishing" ? 0.92 : 1 }}
      transition={{ duration: state === "vanishing" ? 0.3 : 0.35, delay: state === "vanishing" ? 0.18 : 0 }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      title={title}
      role={onClick ? "button" : undefined}
      aria-label={title ?? "Elise"}
    >
      <svg viewBox={`${-VB_W / 2} ${-VB_H / 2} ${VB_W} ${VB_H}`} width={width} height={height} overflow="visible">
        <defs>
          <radialGradient id={id("sclera")} cx="0" cy="0" r="92" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#2a1c44" />
            <stop offset="0.6" stopColor="#150e24" />
            <stop offset="1" stopColor="#0a0612" />
          </radialGradient>
          <radialGradient id={id("iris")} cx="0" cy="0" r="34" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f0c8ff" />
            <stop offset="0.36" stopColor="#c35cff" />
            <stop offset="0.66" stopColor="#8b00ff" />
            <stop offset="0.9" stopColor="#4a0094" />
            <stop offset="1" stopColor="#22003f" />
          </radialGradient>
          <radialGradient id={id("pupil")} cx="-3" cy="-3" r="15" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ff7a7a" />
            <stop offset="0.35" stopColor="#ff1f1f" />
            <stop offset="0.8" stopColor="#d70000" />
            <stop offset="1" stopColor="#6a0000" />
          </radialGradient>
          <linearGradient id={id("lidShade")} x1="0" y1="-60" x2="0" y2="10" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#05030a" stopOpacity="0.85" />
            <stop offset="1" stopColor="#05030a" stopOpacity="0" />
          </linearGradient>
          <filter id={id("blur6")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id={id("blur3")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <clipPath id={id("clip")}>
            <motion.path d={d} />
          </clipPath>
        </defs>

        {/* outer aura */}
        <motion.path d={d} className="eye__aura" fill="none" stroke="#b44cff" strokeWidth={9} filter={`url(#${id("blur6")})`} />

        <g clipPath={`url(#${id("clip")})`}>
          <rect x={-100} y={-70} width={200} height={140} fill={`url(#${id("sclera")})`} />
          <motion.g style={{ transform: irisTransform }}>
            <circle r={40} className="eye__iris-glow" fill="#8b00ff" filter={`url(#${id("blur6")})`} />
            <circle r={34} fill={`url(#${id("iris")})`} />
            <g className="eye__fibers">{fibers}</g>
            <circle r={34} fill="none" stroke="#1b0033" strokeWidth={2.2} strokeOpacity={0.9} />
            <g className="eye__ring">
              <circle r={39} fill="none" stroke="#e6b8ff" strokeWidth={1.4} strokeDasharray="6 10 2 10" strokeLinecap="round" />
            </g>
            <motion.g style={{ transform: pupilScale }}>
              <circle r={15} className="eye__pupil-glow" fill="#ff2a2a" filter={`url(#${id("blur3")})`} />
              <circle r={12} fill={`url(#${id("pupil")})`} className="eye__pupil" />
            </motion.g>
            <ellipse cx={-11} cy={-12} rx={5} ry={3.6} fill="#fff" opacity={0.85} transform="rotate(-25 -11 -12)" />
            <circle cx={9} cy={9} r={1.8} fill="#fff" opacity={0.45} />
          </motion.g>
          <rect x={-100} y={-70} width={200} height={70} fill={`url(#${id("lidShade")})`} opacity={0.55} />
        </g>

        {/* lid outline */}
        <motion.path d={d} fill="none" stroke="#dcc6ff" strokeWidth={2.4} strokeLinejoin="round" className="eye__outline" />
      </svg>
    </motion.div>
  );
}
