import { animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useId, useRef } from "react";
import type { EyeState } from "../lib/types";
import { ASPECT, COLORS as C, DOTS, IRIS_R, LOWER, OPENING, SPARKLES, STAR_ARMS, UPPER, VIEWBOX } from "./eyeArt";
import "./Eye.css";

/**
 * Elise's eye (traced from the user's reference art): spiked lashes, white
 * sclera, purple starfield iris with a silver compass star and a red pupil.
 *
 * Motion: the compass star turns slowly and the sparkles counter-rotate
 * (faster while thinking), stars twinkle, the iris glances around while idle,
 * the eyeball squashes shut to blink, and the pupil follows the mic level.
 * Hosts unmount the eye while their window is hidden, which stops every loop.
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const BOX: React.CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

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
  /** Seconds to wait before opening on "appearing" (e.g. after a summoning circle). */
  appearDelay?: number;
}

export default function Eye({ state, size = 140, level = 0, dim, onClick, onMouseDown, onContextMenu, title, className, appearDelay = 0 }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `${n}-${uid}`;

  const open = useMotionValue(state === "appearing" || state === "closed" ? 0.04 : 1);
  const lidTf = useTransform(open, (k) => `scale(1, ${Math.max(0.04, k)})`);
  const lashScale = useTransform(open, [0.04, 1], [0.94, 1]);
  const lashTf = useTransform(lashScale, (s) => `scale(${s})`);
  const lookX = useSpring(0, { stiffness: 50, damping: 14 });
  const lookY = useSpring(0, { stiffness: 50, damping: 14 });
  const irisTf = useTransform([lookX, lookY], ([x, y]) => `translate(${x}px, ${y}px)`);
  const pupil = useSpring(1, { stiffness: 220, damping: 18 });
  const pupilTf = useTransform(pupil, (p) => `scale(${p})`);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Open / close with the state.
  useEffect(() => {
    if (state === "appearing") {
      open.set(0.04);
      const c = animate(open, 1, { duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.12 + appearDelay });
      return () => c.stop();
    }
    if (state === "vanishing") {
      const c = animate(open, 0.04, { duration: 0.3, ease: [0.55, 0, 0.8, 0.2] });
      return () => c.stop();
    }
    if (state === "closed") {
      open.set(0.04);
      return;
    }
    if (open.get() < 0.9) {
      const c = animate(open, 1, { duration: 0.35 });
      return () => c.stop();
    }
  }, [state, open, appearDelay]);

  // Natural blinking.
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        const s = stateRef.current;
        if (s === "idle" || s === "listening" || s === "speaking") {
          animate(open, [1, 0.06, 1], { duration: 0.22, times: [0, 0.45, 1], ease: "easeInOut" });
        }
        loop();
      }, rand(4500, 9000));
    };
    loop();
    return () => clearTimeout(t);
  }, [open]);

  // Glancing around while idle; steady focus otherwise.
  useEffect(() => {
    if (state !== "idle") {
      lookX.set(0);
      lookY.set(0);
      return;
    }
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        const center = Math.random() < 0.35;
        lookX.set(center ? 0 : rand(-14, 14));
        lookY.set(center ? 0 : rand(-6, 6));
        loop();
      }, rand(2200, 4200));
    };
    loop();
    return () => clearTimeout(t);
  }, [state, lookX, lookY]);

  // Pupil follows the state and the mic level.
  useEffect(() => {
    if (state === "listening") pupil.set(1 + Math.min(1, level) * 0.4);
    else if (state === "thinking") pupil.set(0.85);
    else if (state === "speaking") pupil.set(1.1);
    else pupil.set(1);
  }, [state, level, pupil]);

  return (
    <motion.div
      className={`eye eye--${state} ${dim ? "eye--dim" : ""} ${onClick ? "eye--clickable" : ""} ${className ?? ""}`}
      style={{ width: size, height: size * ASPECT }}
      initial={false}
      animate={{ opacity: state === "vanishing" || state === "closed" ? 0 : 1, scale: state === "vanishing" ? 0.92 : state === "appearing" ? [0.9, 1] : 1 }}
      transition={{ duration: state === "vanishing" ? 0.3 : 0.45, delay: state === "vanishing" ? 0.18 : state === "appearing" ? appearDelay : 0, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      title={title}
      role={onClick ? "button" : undefined}
      aria-label={title ?? "Elise"}
    >
      <svg viewBox={VIEWBOX} width={size} height={size * ASPECT} overflow="visible">
        <defs>
          <radialGradient id={id("sc")} cx="0" cy="-10" r="200" gradientUnits="userSpaceOnUse">
            <stop offset="0.3" stopColor={C.sclera0} />
            <stop offset="1" stopColor={C.sclera1} />
          </radialGradient>
          <linearGradient id={id("ls")} x1="0" y1="-120" x2="0" y2="-40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#000" stopOpacity="0.45" />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={id("ir")} cx="0" cy="0" r={IRIS_R} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={C.iris0} />
            <stop offset="1" stopColor={C.iris1} />
          </radialGradient>
          <linearGradient id={id("sv")} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.55" stopColor="#bdbdc8" />
            <stop offset="1" stopColor="#7c7c8a" />
          </linearGradient>
          <linearGradient id={id("rg")} x1="-40" y1="-40" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.6" stopColor="#b8b8c4" />
            <stop offset="1" stopColor="#6f6f7c" />
          </linearGradient>
          <radialGradient id={id("pu")} cx="0" cy="0" r="21" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1a0000" />
            <stop offset="0.55" stopColor="#b00000" />
            <stop offset="1" stopColor="#ff3030" />
          </radialGradient>
          <radialGradient id={id("ug")} cx="0" cy="0" r="1" gradientTransform="translate(0 70) scale(200 110)" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <filter id={id("b6")} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id={id("b2")} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
          <clipPath id={id("op")}>
            <path d={OPENING} />
          </clipPath>
        </defs>

        {/* soft light around and below the eye */}
        <ellipse cx="0" cy="70" rx="200" ry="110" fill={`url(#${id("ug")})`} className="eye__underglow" />
        <path d={OPENING} fill={C.glow} filter={`url(#${id("b6")})`} opacity="0.28" transform="translate(0 8)" className="eye__aura" />

        {/* lashes and lids */}
        <motion.g style={{ ...BOX, transform: lashTf }}>
          <path d={UPPER} fill="none" stroke={C.glow} strokeWidth="5" filter={`url(#${id("b2")})`} opacity="0.22" />
          <path d={UPPER} fill="#000" stroke={C.line} strokeWidth="2.6" strokeLinejoin="round" />
          {LOWER.map((d, i) => (
            <path key={i} d={d} fill="#000" stroke={C.line} strokeWidth="2.6" strokeLinejoin="round" className="eye__lower" />
          ))}
        </motion.g>

        {/* the eyeball squashes shut to blink */}
        <motion.g style={{ ...BOX, transform: lidTf }}>
          <path d={OPENING} fill={`url(#${id("sc")})`} />
          <g clipPath={`url(#${id("op")})`}>
            <rect x="-200" y="-150" width="400" height="150" fill={`url(#${id("ls")})`} />
            <motion.g style={{ transform: irisTf }}>
              <circle r={IRIS_R} fill={`url(#${id("ir")})`} />
              <g>
                {DOTS.map((d, i) => (
                  <circle
                    key={i}
                    cx={d.x}
                    cy={d.y}
                    r={d.r}
                    fill={C.dots}
                    opacity={d.o}
                    className={d.tw >= 0 ? "eye__tw" : undefined}
                    style={d.tw >= 0 ? ({ animationDelay: `${d.tw}s` } as React.CSSProperties) : undefined}
                  />
                ))}
              </g>
              <g className="eye__star" style={BOX}>
                {STAR_ARMS.map((d, i) => (
                  <path key={i} d={d} fill={`url(#${id("sv")})`} />
                ))}
                <circle r="102" fill="none" />
              </g>
              <g className="eye__sparkles" style={BOX}>
                {SPARKLES.map((d, i) => (
                  <path key={i} d={d} fill={`url(#${id("sv")})`} />
                ))}
              </g>
              <circle r="35" fill="#000" />
              <circle r="38.5" fill="none" stroke={`url(#${id("rg")})`} strokeWidth="6.5" />
              <motion.g style={{ ...BOX, transform: pupilTf }}>
                <circle r="24" fill={C.pupilGlow} filter={`url(#${id("b2")})`} className="eye__pupil-glow" />
                <circle r="21" fill={`url(#${id("pu")})`} className="eye__pupil" />
              </motion.g>
            </motion.g>
          </g>
        </motion.g>
      </svg>
    </motion.div>
  );
}
