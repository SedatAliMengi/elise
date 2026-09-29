/**
 * Geometry of Elise's eye, shared by the animated <Eye> component and the
 * icon generator (scripts/make-icons.mjs). Pure functions, no DOM.
 * Coordinates: origin at the iris centre; the art spans ~570 x 450 units.
 */
import { LOWER, OPENING, UPPER } from "./eyePaths.ts";

export { LOWER, OPENING, UPPER };

export const IRIS_R = 109;
export const VIEWBOX = "-290 -240 580 452";
export const ASPECT = 452 / 580;

export const COLORS = {
  line: "#f0f0f0",
  glow: "#ffffff",
  sclera0: "#f3fffc",
  sclera1: "#bccbcd",
  iris0: "#3a1275",
  iris1: "#06000d",
  dots: "#f3e9ff",
  pupilGlow: "#ff1a1a",
};

/** One arm of the centre star: concave sides from `from` out to a sharp tip. */
export function starArm(deg: number, from: number, to: number, half: number): string {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const p = (r: number, s: number) => `${(ux * r + vx * s).toFixed(2)},${(uy * r + vy * s).toFixed(2)}`;
  const mid = from + (to - from) * 0.45;
  return `M${p(from, half)} Q${p(mid, half * 0.22)} ${p(to, 0)} Q${p(mid, -half * 0.22)} ${p(from, -half)} Z`;
}

export const STAR_ARMS = [
  starArm(-90, 30, 102, 8),
  starArm(90, 30, 102, 8),
  starArm(0, 30, 99, 8),
  starArm(180, 30, 99, 8),
];

/** Sparkle whose long arms curve along the iris (radius rs), crossed by short radial arms. */
export function arcSparkle(deg: number, rs = 86, span = 0.46, w0 = 2.8, rad = 12, rw = 2.6): string {
  const th0 = (deg * Math.PI) / 180;
  const N = 20;
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = -1 + (2 * i) / N;
    const th = th0 + t * span;
    const w = w0 * Math.pow(1 - Math.abs(t), 1.6);
    outer.push([Math.cos(th) * (rs + w), Math.sin(th) * (rs + w)]);
    inner.push([Math.cos(th) * (rs - w), Math.sin(th) * (rs - w)]);
  }
  const f = (p: [number, number]) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const arc = `M${outer.map(f).join(" L")} L${inner.reverse().map(f).join(" L")} Z`;
  const cx = Math.cos(th0) * rs, cy = Math.sin(th0) * rs, ux = Math.cos(th0), uy = Math.sin(th0);
  const q = (a: number, b: number) => `${(cx + ux * a - uy * b).toFixed(2)},${(cy + uy * a + ux * b).toFixed(2)}`;
  const cross = `M${q(rad, 0)} Q${q(1, 0.8)} ${q(0, rw)} Q${q(-1, 0.8)} ${q(-rad, 0)} Q${q(-1, -0.8)} ${q(0, -rw)} Q${q(1, -0.8)} ${q(rad, 0)} Z`;
  return `${arc} ${cross}`;
}

export const SPARKLES = [45, 135, 225, 315].map((d) => arcSparkle(d));

export interface Dot {
  x: number;
  y: number;
  r: number;
  o: number;
  /** Twinkle delay in seconds, or -1 for a steady star. */
  tw: number;
}

/** Deterministic starfield inside the iris. */
export const DOTS: Dot[] = (() => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 110 }, (_, i) => {
    const r = Math.sqrt(rnd()) * (IRIS_R - 4);
    const a = rnd() * Math.PI * 2;
    const s = rnd();
    return {
      x: +(Math.cos(a) * r).toFixed(1),
      y: +(Math.sin(a) * r).toFixed(1),
      r: +(0.4 + s * s * 1.6).toFixed(2),
      o: +(0.3 + rnd() * 0.7).toFixed(2),
      tw: i % 5 === 0 ? +(rnd() * 4).toFixed(2) : -1,
    };
  });
})();

/** Static SVG markup of the whole eye (used for icons). */
export function staticEyeSvg(id = "e"): string {
  const c = COLORS;
  const dots = DOTS.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${c.dots}" opacity="${d.o}"/>`).join("");
  return `
  <defs>
    <radialGradient id="${id}sc" cx="0" cy="-10" r="200" gradientUnits="userSpaceOnUse"><stop offset="0.3" stop-color="${c.sclera0}"/><stop offset="1" stop-color="${c.sclera1}"/></radialGradient>
    <linearGradient id="${id}ls" x1="0" y1="-120" x2="0" y2="-40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <radialGradient id="${id}ir" cx="0" cy="0" r="${IRIS_R}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c.iris0}"/><stop offset="1" stop-color="${c.iris1}"/></radialGradient>
    <linearGradient id="${id}sv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#bdbdc8"/><stop offset="1" stop-color="#7c7c8a"/></linearGradient>
    <linearGradient id="${id}rg" x1="-40" y1="-40" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#b8b8c4"/><stop offset="1" stop-color="#6f6f7c"/></linearGradient>
    <radialGradient id="${id}pu" cx="0" cy="0" r="21" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a0000"/><stop offset="0.55" stop-color="#b00000"/><stop offset="1" stop-color="#ff3030"/></radialGradient>
    <filter id="${id}b6" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="${id}b2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
    <clipPath id="${id}op"><path d="${OPENING}"/></clipPath>
  </defs>
  <path d="${OPENING}" fill="${c.glow}" filter="url(#${id}b6)" opacity="0.28" transform="translate(0 8)"/>
  <path d="${UPPER}" fill="none" stroke="${c.glow}" stroke-width="5" filter="url(#${id}b2)" opacity="0.22"/>
  <path d="${UPPER}" fill="#000" stroke="${c.line}" stroke-width="2.6" stroke-linejoin="round"/>
  ${LOWER.map((d) => `<path d="${d}" fill="#000" stroke="${c.line}" stroke-width="2.6" stroke-linejoin="round"/>`).join("")}
  <path d="${OPENING}" fill="url(#${id}sc)"/>
  <g clip-path="url(#${id}op)">
    <rect x="-200" y="-150" width="400" height="150" fill="url(#${id}ls)"/>
    <circle r="${IRIS_R}" fill="url(#${id}ir)"/>
    ${dots}
    ${STAR_ARMS.map((d) => `<path d="${d}" fill="url(#${id}sv)"/>`).join("")}
    ${SPARKLES.map((d) => `<path d="${d}" fill="url(#${id}sv)"/>`).join("")}
    <circle r="35" fill="#000"/>
    <circle r="38.5" fill="none" stroke="url(#${id}rg)" stroke-width="6.5"/>
    <circle r="24" fill="${c.pupilGlow}" filter="url(#${id}b2)" opacity="0.85"/>
    <circle r="21" fill="url(#${id}pu)"/>
  </g>`;
}

