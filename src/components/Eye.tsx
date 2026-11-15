import { animate, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useId, useMemo, useRef } from "react";
import type { EyeState } from "../lib/types";
import {
  ASPECT,
  COLORS as C,
  DOTS,
  IRIS_R,
  LID_TRAVEL,
  OPENING,
  SPARKLES,
  UPPER_BEVEL_WIDTHS,
  VIEWBOX,
  compassStar,
  eyeDefs,
  irisDetail,
  irisGlints,
  irisRim,
  irisTicks,
  lidClipPath,
  lidEdgePath,
  lowerLashes,
  pupilDetail,
  pupilSocket,
  scleraRim,
  upperLidPath,
} from "./eyeArt";
import "./Eye.css";

/**
 * Elise's eye (traced from the user's reference art, detailed model in
 * eyeArt.ts): steel lashes, a shaded white, a purple starfield iris with
 * fibres, an engraved tick ring and a cut-metal compass star, and a red pupil.
 *
 * Motion: a real upper eyelid comes down to blink, close and open (the lashes
 * ride on it); the compass star turns slowly, the sparkles and the tick ring
 * drift the other way (faster while thinking), stars twinkle, the iris glances
 * around while idle, and the pupil follows the mic level.
 * Hosts unmount the eye while their window is hidden, which stops every loop.
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const BOX: React.CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };
/** `open` runs from SHUT (lids together) to 1 (open); a little above 1 is the overshoot when she wakes. */
const SHUT = 0.04;
const closedness = (open: number) => Math.max(0, Math.min(1, (1 - open) / (1 - SHUT)));
const html = (s: string) => ({ __html: s });

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
  const id = (n: string) => `${uid}${n}`;

  const open = useMotionValue(state === "appearing" || state === "closed" ? SHUT : 1);
  // The eyelid: every shape that follows the lid is derived from `open`.
  const upperD = useTransform(open, (v) => upperLidPath(closedness(v)));
  const lidClipD = useTransform(open, (v) => lidClipPath(closedness(v)));
  const edgeD = useTransform(open, (v) => lidEdgePath(closedness(v)));
  const edgeOpacity = useTransform(open, (v) => Math.min(1, closedness(v) * 8));
  const edgeShade = useTransform(edgeOpacity, (o) => o * 0.5);
  const auraOpacity = useTransform(open, (v) => 1 - closedness(v));
  const shadeTf = useTransform(open, (v) => `translate(0px, ${(LID_TRAVEL * closedness(v)).toFixed(1)}px)`);
  const wideTf = useTransform(open, (v) => `scale(${v > 1 ? 1 + (v - 1) * 1.2 : 1})`);

  const lookX = useSpring(0, { stiffness: 140, damping: 22 });
  const lookY = useSpring(0, { stiffness: 140, damping: 22 });
  const irisTf = useTransform([lookX, lookY], ([x, y]) => `translate(${x}px, ${y}px)`);
  const pupil = useSpring(1, { stiffness: 220, damping: 18 });
  const pupilTf = useTransform(pupil, (p) => `scale(${p})`);
  const stateRef = useRef(state);
  stateRef.current = state;

  // The fixed artwork, built once per eye.
  const art = useMemo(
    () => ({
      defs: html(eyeDefs(uid)),
      lower: html(lowerLashes(uid)),
      rim: html(scleraRim()),
      iris: html(irisDetail(uid)),
      glints: html(irisGlints()),
      ticks: html(irisTicks()),
      irisRim: html(irisRim(uid)),
      star: html(compassStar()),
      socket: html(pupilSocket(uid)),
      pupil: html(pupilDetail()),
    }),
    [uid],
  );

  // Open / close with the state.
  useEffect(() => {
    if (state === "appearing") {
      open.set(SHUT);
      // The lids part, go a touch too wide, and settle.
      const c = animate(open, [SHUT, 1.05, 1], { duration: 0.75, times: [0, 0.72, 1], ease: [0.22, 1, 0.36, 1], delay: 0.12 + appearDelay });
      return () => c.stop();
    }
    if (state === "vanishing") {
      const c = animate(open, SHUT, { duration: 0.32, ease: [0.55, 0, 0.8, 0.2] });
      return () => c.stop();
    }
    if (state === "closed") {
      open.set(SHUT);
      return;
    }
    if (open.get() < 0.9) {
      const c = animate(open, 1, { duration: 0.35 });
      return () => c.stop();
    }
  }, [state, open, appearDelay]);

  // Natural blinking: down fast, up a little slower.
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        const s = stateRef.current;
        if (s === "idle" || s === "listening" || s === "speaking") {
          animate(open, [1, SHUT, 1], { duration: 0.26, times: [0, 0.4, 1], ease: "easeInOut" });
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
        <defs dangerouslySetInnerHTML={art.defs} />
        <defs>
          {/* these two follow the eyelid */}
          <clipPath id={id("lid")}>
            <motion.path d={lidClipD} />
          </clipPath>
          <clipPath id={id("uc")}>
            <motion.path d={upperD} />
          </clipPath>
        </defs>

        <motion.g style={{ ...BOX, transform: wideTf }}>
          {/* soft light around and below the eye */}
          <ellipse cx="0" cy="70" rx="200" ry="110" fill={`url(#${id("ha")})`} className="eye__underglow" />
          {/* the glow behind the eyeball fades as the lid shuts, and the lid's own skin is black */}
          <motion.g style={{ opacity: auraOpacity }}>
            <path d={OPENING} fill={C.glow} filter={`url(#${id("b6")})`} opacity="0.28" transform="translate(0 8)" className="eye__aura" />
          </motion.g>
          <path d={OPENING} fill="#000" />

          {/* upper lashes and lid: steel, with a bevel inside the outline */}
          <motion.path d={upperD} fill="none" stroke={C.glow} strokeWidth="5" filter={`url(#${id("b2")})`} opacity="0.22" />
          <motion.path d={upperD} fill={`url(#${id("la")})`} stroke={`url(#${id("s2")})`} strokeWidth="2.6" strokeLinejoin="round" />
          <g clipPath={`url(#${id("uc")})`}>
            <motion.path d={upperD} fill="none" stroke="#8e8ea6" strokeWidth={UPPER_BEVEL_WIDTHS.band} opacity="0.42" />
            <motion.path d={upperD} fill="none" stroke="#ffffff" strokeWidth={UPPER_BEVEL_WIDTHS.rim} opacity="0.4" />
          </g>
          <g dangerouslySetInnerHTML={art.lower} />

          {/* the eyeball, hidden above the lid's edge */}
          <g clipPath={`url(#${id("lid")})`}>
            <path d={OPENING} fill={`url(#${id("sc")})`} />
            <g clipPath={`url(#${id("op")})`}>
              <g dangerouslySetInnerHTML={art.rim} />
              <motion.g style={{ transform: irisTf }}>
                <circle r={IRIS_R} fill={`url(#${id("ir")})`} />
                <g dangerouslySetInnerHTML={art.iris} />
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
                      style={d.tw >= 0 ? ({ animationDelay: `${(Math.round(d.tw * 12) / 12).toFixed(4)}s` } as React.CSSProperties) : undefined}
                    />
                  ))}
                </g>
                <g dangerouslySetInnerHTML={art.glints} />
                <g className="eye__ticks" style={BOX} dangerouslySetInnerHTML={art.ticks} />
                <g dangerouslySetInnerHTML={art.irisRim} />
                <g className="eye__star" style={BOX}>
                  <g dangerouslySetInnerHTML={art.star} />
                  <circle r="102" fill="none" />
                </g>
                <g className="eye__sparkles" style={BOX}>
                  {SPARKLES.map((d, i) => (
                    <path key={i} d={d} fill={`url(#${id("sv")})`} />
                  ))}
                </g>
                <g dangerouslySetInnerHTML={art.socket} />
                <motion.g style={{ ...BOX, transform: pupilTf }}>
                  <circle r="24" fill={C.pupilGlow} filter={`url(#${id("b2")})`} className="eye__pupil-glow" />
                  <circle r="21" fill={`url(#${id("pu")})`} className="eye__pupil" />
                  <g dangerouslySetInnerHTML={art.pupil} />
                </motion.g>
              </motion.g>
              {/* the lid's shadow on the eye, moving with the lid */}
              <motion.rect x="-200" y="-150" width="400" height="150" fill={`url(#${id("ls")})`} style={{ transform: shadeTf }} />
            </g>
          </g>

          {/* the lid's edge: a clean line where the lid meets the eye */}
          <g clipPath={`url(#${id("op")})`}>
            <motion.path d={edgeD} fill="none" stroke="#000" strokeWidth="9" strokeLinecap="round" style={{ opacity: edgeShade }} />
            <motion.path d={edgeD} fill="none" stroke={C.line} strokeWidth="3" strokeLinecap="round" style={{ opacity: edgeOpacity }} />
          </g>
        </motion.g>
      </svg>
    </motion.div>
  );
}
