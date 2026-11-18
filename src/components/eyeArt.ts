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

// ---------------------------------------------------------------------------
// The detailed model (November 2026). Same outlines as the traced art, with
// richer surfaces and a real upper eyelid. Everything below is plain SVG
// markup or path data, so the animated <Eye> and the icon generator draw the
// very same eye.
//
// The eye has palettes: NORMAL (purple only in the iris, red only in the
// pupil, no reflection dot, black background) and HOLLOW, her Nihil look
// (red and black only: a black void of an eye with red line-work and a
// glowing slit pupil).
// Cost rule: Elise renders without the GPU, so no blur filters are added here
// (soft light is done with gradients); the only blurs are the two the eye
// always had (aura and pupil glow).
// ---------------------------------------------------------------------------

type Stops3 = [string, string, string];
type Stops4 = [string, string, string, string];

export interface EyePalette {
  /** White of the eye, centre to edge. */
  sclera: Stops4;
  /** The dark rim drawn on the white so it reads as a ball. */
  scleraRim: string;
  iris: Stops4;
  /** Three soft clouds inside the iris. */
  clouds: Stops3;
  /** Metal of the star and sparkles (diagonal), of outlines (top to bottom), and of the pupil's ring. */
  metal: Stops3;
  outline: Stops3;
  ring: Stops3;
  /** Lash fill, top to bottom. */
  lash: Stops3;
  bevelBand: string;
  bevelRim: string;
  pupil: Stops4;
  pupilGlow: string;
  /** Soft light around the eye. */
  glow: string;
  fibre: string;
  fibreBright: string;
  dots: string;
  glint: string;
  tick: string;
  starLight: string;
  starDark: string;
  starMinor: string;
  starRidge: string;
  socketLine: string;
  socketInner: string;
  socketNotch: string;
  socketDash: string;
  /** The line where the lid meets the eye. */
  lidEdge: string;
  /** Fine work inside the pupil (off for the slit). */
  pupilDetail: boolean;
  /** Pupil stretched into a slit: [x, y] scale. */
  slit: [number, number] | null;
}

export const NORMAL: EyePalette = {
  sclera: ["#ffffff", "#e3edf1", "#b3c1cc", "#7f8d9b"],
  scleraRim: "#0e151d",
  iris: ["#7a2fe0", "#4a169c", "#200a4d", "#05000c"],
  clouds: ["#a45cff", "#4433e0", "#c66bff"],
  metal: ["#ffffff", "#bdbdc8", "#7c7c8a"],
  outline: ["#ffffff", "#c9c9d6", "#8a8a9c"],
  ring: ["#ffffff", "#b8b8c4", "#6f6f7c"],
  lash: ["#2a2a36", "#0c0c12", "#000000"],
  bevelBand: "#8e8ea6",
  bevelRim: "#ffffff",
  pupil: ["#120000", "#a00000", "#ff2a2a", "#ff8a70"],
  pupilGlow: COLORS.pupilGlow,
  glow: COLORS.glow,
  fibre: "#b98cff",
  fibreBright: "#e7d4ff",
  dots: COLORS.dots,
  glint: "#ffffff",
  tick: "#efe6ff",
  starLight: "#f4f4fa",
  starDark: "#7e7e92",
  starMinor: "#cfcfe0",
  starRidge: "#ffffff",
  socketLine: "#ffffff",
  socketInner: "#3a3a48",
  socketNotch: "#4a4a5a",
  socketDash: "#ff2a2a",
  lidEdge: COLORS.line,
  pupilDetail: true,
  slit: null,
};

/** Nihil: the eye as a black void, red line-work, a glowing red slit. */
export const HOLLOW: EyePalette = {
  sclera: ["#000000", "#000000", "#060000", "#3a0000"],
  scleraRim: "#6a0000",
  iris: ["#1a0000", "#0a0000", "#000000", "#000000"],
  clouds: ["#500000", "#200000", "#300000"],
  metal: ["#ff3a2a", "#e01010", "#900000"],
  outline: ["#ff4a38", "#e01010", "#8a0000"],
  ring: ["#ff3a2a", "#c01010", "#700000"],
  lash: ["#000000", "#000000", "#000000"],
  bevelBand: "#000000",
  bevelRim: "#5a0000",
  pupil: ["#ff7a60", "#ff1a1a", "#c00000", "#600000"],
  pupilGlow: "#ff0000",
  glow: "#c00000",
  fibre: "#c01010",
  fibreBright: "#ff3a2a",
  dots: "#ff3a2a",
  glint: "#ff6a58",
  tick: "#ff2a1a",
  starLight: "#e01010",
  starDark: "#300000",
  starMinor: "#700000",
  starRidge: "#ff6a58",
  socketLine: "#ff3a2a",
  socketInner: "#3a0000",
  socketNotch: "#700000",
  socketDash: "#ff2a2a",
  lidEdge: "#ff3a2a",
  pupilDetail: false,
  slit: [0.34, 1.28],
};

const polar = (deg: number, r: number, s = 0): string => {
  const a = (deg * Math.PI) / 180;
  return `${(Math.cos(a) * r - Math.sin(a) * s).toFixed(2)},${(Math.sin(a) * r + Math.cos(a) * s).toFixed(2)}`;
};
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ----- the eyelid -----

/** Half-width of the opening, the height of its corners, its top, and how far the lid's middle travels to shut. */
const LID_X = 183;
const LID_CORNER_Y = -3;
const LID_TOP = -109;
export const LID_TRAVEL = 226;

const UPPER_PTS: [number, number][] = (() => {
  const n = UPPER.match(/-?\d+\.?\d*/g)!.map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
  return pts;
})();

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The upper lashes and lid with the lid `k` closed (0 = open, 1 = shut).
 * The traced outline is bent downward along a parabola between the eye's two
 * corners: the corners stay put, the middle travels the most, and the lashes
 * ride on the lid and shorten a little, as lashes seen from the front do.
 */
export function upperLidPath(k: number): string {
  if (k <= 0) return UPPER;
  let d = "";
  UPPER_PTS.forEach(([x, y], i) => {
    const u = Math.max(0, 1 - (x / LID_X) * (x / LID_X));
    const edge = LID_CORNER_Y + u * LID_TOP;
    const w = clamp01((40 - y) / 60); // only the upper half moves; the lower rim stays
    const off = y - edge;
    const y2 = off < 0 ? edge + off * (1 - 0.35 * k) : y;
    const ny = y2 + w * u * LID_TRAVEL * k;
    d += (i === 0 ? "M" : i % 3 === 1 ? "C" : " ") + x.toFixed(1) + " " + ny.toFixed(1);
  });
  return d + "Z";
}

const lidControlY = (k: number) => LID_CORNER_Y + 2 * (LID_TOP + LID_TRAVEL * k);

/** Everything below the lid's edge: clips the eyeball as the lid comes down. */
export function lidClipPath(k: number): string {
  const slack = 32 * (1 - clamp01(k * 6)); // fully open: never cut into the art's own top edge
  return `M-320 ${LID_CORNER_Y} L${-LID_X} ${LID_CORNER_Y} Q0 ${(lidControlY(k) - slack).toFixed(1)} ${LID_X} ${LID_CORNER_Y} L320 ${LID_CORNER_Y} L320 320 L-320 320Z`;
}

/** The lid's edge, a clean line where the lid meets the eye. */
export function lidEdgePath(k: number): string {
  return `M${-LID_X} ${LID_CORNER_Y} Q0 ${lidControlY(k).toFixed(1)} ${LID_X} ${LID_CORNER_Y}`;
}

// ----- surfaces -----

const stops = (s: [number, string, number?][]) =>
  s.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? "" : ` stop-opacity="${a}"`}/>`).join("");

/** Gradients, the two blurs, and the fixed clip shapes. `id` keeps several eyes on one page apart. */
export function eyeDefs(id: string, p: EyePalette = NORMAL): string {
  const U = `gradientUnits="userSpaceOnUse"`;
  const three = (c: Stops3, mid: number): [number, string][] => [
    [0, c[0]],
    [mid, c[1]],
    [1, c[2]],
  ];
  return `
    <radialGradient id="${id}sc" cx="0" cy="8" r="205" ${U}>${stops([[0.2, p.sclera[0]], [0.62, p.sclera[1]], [0.86, p.sclera[2]], [1, p.sclera[3]]])}</radialGradient>
    <linearGradient id="${id}ls" x1="0" y1="-125" x2="0" y2="-30" ${U}>${stops([[0, "#000", 0.55], [1, "#000", 0]])}</linearGradient>
    <radialGradient id="${id}ir" cx="0" cy="0" r="${IRIS_R}" ${U}>${stops([[0, p.iris[0]], [0.32, p.iris[1]], [0.68, p.iris[2]], [1, p.iris[3]]])}</radialGradient>
    <radialGradient id="${id}n0" cx="-34" cy="-30" r="62" ${U}>${stops([[0, p.clouds[0], 0.42], [1, p.clouds[0], 0]])}</radialGradient>
    <radialGradient id="${id}n1" cx="40" cy="36" r="58" ${U}>${stops([[0, p.clouds[1], 0.4], [1, p.clouds[1], 0]])}</radialGradient>
    <radialGradient id="${id}n2" cx="30" cy="-48" r="40" ${U}>${stops([[0, p.clouds[2], 0.28], [1, p.clouds[2], 0]])}</radialGradient>
    <linearGradient id="${id}sv" x1="0" y1="0" x2="1" y2="1">${stops(three(p.metal, 0.55))}</linearGradient>
    <linearGradient id="${id}s2" x1="0" y1="0" x2="0" y2="1">${stops(three(p.outline, 0.5))}</linearGradient>
    <linearGradient id="${id}rg" x1="-40" y1="-40" x2="40" y2="40" ${U}>${stops(three(p.ring, 0.6))}</linearGradient>
    <linearGradient id="${id}la" x1="0" y1="-230" x2="0" y2="120" ${U}>${stops(three(p.lash, 0.45))}</linearGradient>
    <radialGradient id="${id}pu" cx="0" cy="0" r="21" ${U}>${stops([[0, p.pupil[0]], [0.5, p.pupil[1]], [0.85, p.pupil[2]], [1, p.pupil[3]]])}</radialGradient>
    <radialGradient id="${id}ha" cx="0" cy="0" r="1" gradientTransform="translate(0 70) scale(200 110)" ${U}>${stops([[0, p.glow, 0.2], [1, p.glow, 0]])}</radialGradient>
    <filter id="${id}b6" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="${id}b2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
    <clipPath id="${id}op"><path d="${OPENING}"/></clipPath>
    ${LOWER.map((d, i) => `<clipPath id="${id}lc${i}"><path d="${d}"/></clipPath>`).join("")}`;
}

/** Bevel drawn inside a lash shape: a band and a bright rim, clipped to the shape. */
const bevel = (d: string, wide: number, p: EyePalette) =>
  `<path d="${d}" fill="none" stroke="${p.bevelBand}" stroke-width="${wide}" opacity="0.42"/><path d="${d}" fill="none" stroke="${p.bevelRim}" stroke-width="${wide / 3}" opacity="0.4"/>`;

/** Stroke widths of the upper lashes' bevel (its path changes as the lid moves, so <Eye> draws it). */
export const UPPER_BEVEL_WIDTHS = { band: 18, rim: 6 };

/** The four lower lashes: fill, outline, bevel. */
export function lowerLashes(id: string, p: EyePalette = NORMAL): string {
  return LOWER.map(
    (d, i) =>
      `<path d="${d}" fill="url(#${id}la)" stroke="url(#${id}s2)" stroke-width="2.6" stroke-linejoin="round" class="eye__lower"/><g clip-path="url(#${id}lc${i})">${bevel(d, 14, p)}</g>`,
  ).join("");
}

/** Shading that sits on the white of the eye: a soft rim so it reads as a ball set inside the lids. */
export function scleraRim(p: EyePalette = NORMAL): string {
  return [
    [26, 0.1],
    [15, 0.14],
    [7, 0.5],
  ]
    .map(([w, o]) => `<path d="${OPENING}" fill="none" stroke="${p.scleraRim}" stroke-width="${w}" opacity="${o}"/>`)
    .join("");
}

/** Inside the iris, under the stars: soft clouds and fine fibres radiating from the centre. */
export function irisDetail(id: string, p: EyePalette = NORMAL): string {
  const rnd = seeded(23);
  let s = `<circle r="${IRIS_R}" fill="url(#${id}n0)"/><circle r="${IRIS_R}" fill="url(#${id}n1)"/><circle r="${IRIS_R}" fill="url(#${id}n2)"/>`;
  for (let i = 0; i < 96; i++) {
    const a = i * 3.75 + (rnd() - 0.5) * 2;
    const r1 = 40 + rnd() * 6;
    const r2 = i % 2 ? 70 + rnd() * 22 : 92 + rnd() * 12;
    s += `<path d="M${polar(a, r1)} L${polar(a, r2)}" stroke="${i % 3 ? p.fibre : p.fibreBright}" stroke-width="${i % 4 ? 0.8 : 1.3}" opacity="${(0.12 + rnd() * 0.2).toFixed(2)}"/>`;
  }
  return s;
}

/** A few of the brightest stars drawn as tiny four-point glints. */
export function irisGlints(p: EyePalette = NORMAL): string {
  return DOTS.filter((_, i) => i % 13 === 4)
    .map((d) => {
      const { x, y } = d;
      const q = (dx: number, dy: number) => `${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`;
      const c = `${x} ${y}`;
      return `<path d="M${q(-5, 0)} Q${c} ${q(0, -5)} Q${c} ${q(5, 0)} Q${c} ${q(0, 5)} Q${c} ${q(-5, 0)}Z" fill="${p.glint}" opacity="0.9"/>`;
    })
    .join("");
}

/** An engraved ring of tick marks near the iris edge, like an astrolabe. It turns slowly. */
export function irisTicks(p: EyePalette = NORMAL): string {
  let s = `<circle r="99" fill="none" stroke="${p.tick}" stroke-width="0.7" opacity="0.35"/><circle r="91" fill="none" stroke="${p.tick}" stroke-width="0.5" opacity="0.22" stroke-dasharray="1.5 4"/>`;
  for (let a = 0; a < 360; a += 5) {
    const major = a % 30 === 0;
    s += `<path d="M${polar(a, 99)} L${polar(a, major ? 91 : 95.5)}" stroke="${p.tick}" stroke-width="${major ? 1.5 : 0.7}" opacity="${major ? 0.75 : 0.38}"/>`;
  }
  for (let a = 15; a < 360; a += 30) {
    const [cx, cy] = polar(a, 103).split(",");
    s += `<circle cx="${cx}" cy="${cy}" r="1.1" fill="${p.glint}" opacity="0.6"/>`;
  }
  return s;
}

/** The dark limbal ring and a thin metal line around the iris. */
export function irisRim(id: string): string {
  return `<circle r="${IRIS_R - 2.5}" fill="none" stroke="#000" stroke-width="6" opacity="0.6"/><circle r="${IRIS_R}" fill="none" stroke="url(#${id}s2)" stroke-width="1.4" opacity="0.8"/>`;
}

/** Half of a star arm, for the shaded facet. */
function starFacet(deg: number, from: number, to: number, half: number): string {
  const mid = from + (to - from) * 0.45;
  return `M${polar(deg, from, half)} Q${polar(deg, mid, half * 0.22)} ${polar(deg, to)} L${polar(deg, from)} Z`;
}

/** The compass star as cut metal: four thin diagonal arms, then each main arm with a light and a dark facet and a bright ridge. */
export function compassStar(p: EyePalette = NORMAL): string {
  let s = [45, 135, 225, 315].map((a) => `<path d="${starArm(a, 34, 66, 3.2)}" fill="${p.starMinor}" opacity="0.75"/>`).join("");
  const arms: [number, number][] = [
    [-90, 102],
    [90, 102],
    [0, 99],
    [180, 99],
  ];
  for (const [a, to] of arms) {
    s += `<path d="${starArm(a, 30, to, 8.5)}" fill="${p.starLight}"/><path d="${starFacet(a, 30, to, -8.5)}" fill="${p.starDark}"/><path d="M${polar(a, 31)} L${polar(a, to - 1)}" stroke="${p.starRidge}" stroke-width="0.7" opacity="0.9"/>`;
  }
  return s;
}

/** The pupil's socket: black well, metal ring with engraved notches, a faint red dashed ring. */
export function pupilSocket(id: string, p: EyePalette = NORMAL): string {
  let s = `<circle r="35" fill="#000"/><circle r="38.5" fill="none" stroke="url(#${id}rg)" stroke-width="6.5"/><circle r="42.2" fill="none" stroke="${p.socketLine}" stroke-width="0.8" opacity="0.75"/><circle r="34.8" fill="none" stroke="${p.socketInner}" stroke-width="1"/>`;
  for (let a = 0; a < 360; a += 22.5) s += `<path d="M${polar(a, 36.2)} L${polar(a, 40.8)}" stroke="${p.socketNotch}" stroke-width="${a % 45 ? 0.8 : 1.6}"/>`;
  return s + `<circle r="29.5" fill="none" stroke="${p.socketDash}" stroke-width="0.6" opacity="0.35" stroke-dasharray="2 3"/>`;
}

/** Fine work inside the red pupil: an inner ring, a dark core and faint rays. */
export function pupilDetail(p: EyePalette = NORMAL): string {
  if (!p.pupilDetail) return "";
  let s = `<circle r="13.5" fill="none" stroke="#ff9a8a" stroke-width="0.8" opacity="0.5"/><circle r="7" fill="#000" opacity="0.75"/>`;
  for (let a = 0; a < 360; a += 45) s += `<path d="M${polar(a, 9)} L${polar(a, 17.5)}" stroke="#ffb0a0" stroke-width="0.6" opacity="0.35"/>`;
  return s;
}

/** Static SVG markup of the whole eye, open (used for icons). */
export function staticEyeSvg(id = "e", p: EyePalette = NORMAL): string {
  const dots = DOTS.map((d) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${p.dots}" opacity="${d.o}"/>`).join("");
  const slit = p.slit ? ` transform="scale(${p.slit[0]} ${p.slit[1]})"` : "";
  return `
  <defs>${eyeDefs(id, p)}<clipPath id="${id}uc"><path d="${UPPER}"/></clipPath></defs>
  <ellipse cx="0" cy="70" rx="200" ry="110" fill="url(#${id}ha)"/>
  <path d="${OPENING}" fill="${p.glow}" filter="url(#${id}b6)" opacity="0.28" transform="translate(0 8)"/>
  <path d="${UPPER}" fill="none" stroke="${p.glow}" stroke-width="5" filter="url(#${id}b2)" opacity="0.22"/>
  <path d="${UPPER}" fill="url(#${id}la)" stroke="url(#${id}s2)" stroke-width="2.6" stroke-linejoin="round"/>
  <g clip-path="url(#${id}uc)">${bevel(UPPER, UPPER_BEVEL_WIDTHS.band, p)}</g>
  ${lowerLashes(id, p)}
  <path d="${OPENING}" fill="url(#${id}sc)"/>
  <g clip-path="url(#${id}op)">
    ${scleraRim(p)}
    <circle r="${IRIS_R}" fill="url(#${id}ir)"/>
    ${irisDetail(id, p)}
    ${dots}
    ${irisGlints(p)}
    ${irisTicks(p)}
    ${irisRim(id)}
    ${compassStar(p)}
    ${SPARKLES.map((d) => `<path d="${d}" fill="url(#${id}sv)"/>`).join("")}
    ${pupilSocket(id, p)}
    <g${slit}>
      <circle r="24" fill="${p.pupilGlow}" filter="url(#${id}b2)" opacity="0.85"/>
      <circle r="21" fill="url(#${id}pu)"/>
      ${pupilDetail(p)}
    </g>
    <rect x="-200" y="-150" width="400" height="150" fill="url(#${id}ls)"/>
  </g>`;
}
