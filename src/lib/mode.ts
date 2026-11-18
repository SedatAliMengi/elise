import { useEffect, useState } from "react";

/**
 * Nihil mode: typing "nihil" to Elise makes her blink and turn the whole app
 * red and black (and typing it again turns her back).
 *
 * The switch has two beats so it happens behind her eyelid: "closing" (every
 * eye shuts), then "swap" (colours change, eyes open again).
 *
 * The app's stylesheets are not written twice. On the first switch every CSS
 * rule that names a colour is read back from the browser and re-emitted with
 * that colour moved into red and black, into one extra stylesheet that is only
 * switched on in Nihil. New CSS is therefore covered without doing anything.
 * Colours set from code (event and project colours, the eye, the starfield)
 * go through `tint()` / `isNihil()` instead.
 */

const KEY = "elise-nihil";
type Phase = "closing" | "swap";
type Sub = (phase: Phase, nihil: boolean) => void;

const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const subs = new Set<Sub>();
let target = read();
let shown = target;
let timer: number | undefined;
let sheet: HTMLStyleElement | null = null;

/** Whether the colours on screen are Nihil's right now. */
export const isNihil = () => shown;
/** The mode remembered from last time (the settings file is the truth; this avoids a flash at start). */
export const storedNihil = read;

export function onMode(cb: Sub): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Call once at start, after the stylesheets are loaded. */
export function initMode() {
  apply(shown);
}

/** Ask for a mode. `instant` skips the blink (used when a window first learns the saved mode). */
export function requestMode(nihil: boolean, instant = false) {
  if (nihil === target) return;
  target = nihil;
  try {
    localStorage.setItem(KEY, nihil ? "1" : "");
  } catch {
    /* private mode: the settings file still remembers */
  }
  clearTimeout(timer);
  const swap = () => {
    shown = nihil;
    apply(nihil);
    subs.forEach((s) => s("swap", nihil));
  };
  if (instant) return swap();
  subs.forEach((s) => s("closing", nihil));
  timer = window.setTimeout(swap, 200);
}

/** Re-renders the caller when the colours on screen change. */
export function useNihil(): boolean {
  const [n, setN] = useState(shown);
  useEffect(() => onMode((phase, nihil) => phase === "swap" && setN(nihil)), []);
  return n;
}

/** Does this text ask for the mode switch? ("nihil" anywhere in it, any case.) */
export const asksForNihil = (text: string) => /nihil/i.test(text);

// ----- colours -----

type RGB = [number, number, number];

/**
 * A colour moved into Nihil's palette: reds stay, black stays, everything
 * else keeps its brightness but becomes a red (dark colours become darker
 * still, so the app is mostly black).
 */
function toNihil([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (max < 6) return [r, g, b]; // black
  if (s > 0.45 && r === max && g < r * 0.55 && b < r * 0.55) return [r, g, b]; // already a red
  if (s < 0.12) {
    // whites and greys
    if (v > 0.5) return [max, max * 0.7, max * 0.65];
    return [max * 0.9, max * 0.2, max * 0.18];
  }
  if (v < 0.4) {
    const d = max * 0.8;
    return [d, d * 0.14, d * 0.12];
  }
  if (s < 0.35) return [max, max * 0.4, max * 0.34]; // soft colours: text, dim labels
  const rr = max * Math.min(1, 0.72 + 0.56 * (1 - s));
  const gg = rr * (0.1 + 0.25 * (1 - s));
  return [rr, gg, gg * 0.85];
}

const hexToRgb = (h: string): [RGB, number] | null => {
  let x = h.replace("#", "");
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join("");
  if (x.length !== 6 && x.length !== 8) return null;
  const n = (i: number) => parseInt(x.slice(i, i + 2), 16);
  return [[n(0), n(2), n(4)], x.length === 8 ? n(6) / 255 : 1];
};

const fmt = ([r, g, b]: RGB, a: number | string) =>
  a === 1 || a === "1" ? `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})` : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;

const COLOR = /#([0-9a-f]{3,8})\b|rgba?\(([^()]+)\)/gi;

/** Every colour literal in a piece of CSS, moved into Nihil's palette. */
function convertCss(text: string): string {
  return text.replace(COLOR, (whole, hex: string | undefined, inner: string | undefined) => {
    if (hex !== undefined) {
      const p = hexToRgb(hex);
      return p ? fmt(toNihil(p[0]), +p[1].toFixed(3)) : whole;
    }
    const parts = inner!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.slice(0, 3).some((x) => Number.isNaN(parseFloat(x)))) return whole;
    const rgb = parts.slice(0, 3).map(parseFloat) as RGB;
    return fmt(toNihil(rgb), parts[3] ?? 1);
  });
}

function convertRules(rules: CSSRuleList): string {
  let out = "";
  for (const r of Array.from(rules)) {
    if (r instanceof CSSStyleRule) {
      const before = r.style.cssText;
      if (before.includes("url(")) continue;
      const after = convertCss(before);
      if (after !== before) out += `${r.selectorText}{${after}}`;
    } else if (r instanceof CSSMediaRule) {
      const inner = convertRules(r.cssRules);
      if (inner) out += `@media ${r.conditionText}{${inner}}`;
    } else if (r instanceof CSSKeyframesRule) {
      const before = r.cssText;
      const after = convertCss(before);
      if (after !== before) out += after;
    }
  }
  return out;
}

function buildSheet(): HTMLStyleElement {
  let css = "";
  for (const s of Array.from(document.styleSheets)) {
    if ((s.ownerNode as HTMLElement | null)?.id === "elise-nihil") continue;
    try {
      css += convertRules(s.cssRules);
    } catch {
      /* a stylesheet we may not read: leave it alone */
    }
  }
  const el = document.createElement("style");
  el.id = "elise-nihil";
  el.textContent = css;
  document.head.appendChild(el);
  return el;
}

function apply(nihil: boolean) {
  if (nihil) document.documentElement.dataset.mode = "nihil";
  else delete document.documentElement.dataset.mode;
  if (nihil && !sheet) sheet = buildSheet();
  if (sheet) sheet.disabled = !nihil;
}

/**
 * A colour chosen in code (an event's, a project's). In Nihil it becomes a
 * shade of red, darker or brighter by its original hue, so different colours
 * can still be told apart.
 */
export function tint(color: string): string {
  if (!shown) return color;
  const p = hexToRgb(color);
  if (!p) return color;
  const [r, g, b] = p[0];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
  }
  const v = 0.42 + 0.58 * (h / 360);
  const rr = 255 * v;
  const gg = rr * 0.1 + (v > 0.8 ? (v - 0.8) * 300 : 0);
  return fmt([rr, gg, gg * 0.85], 1);
}
