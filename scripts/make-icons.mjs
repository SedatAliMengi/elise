// Renders Elise's eye to a 1024px PNG, then lets the Tauri CLI build every
// icon size (tray, taskbar, installer) from it.
//   node scripts/make-icons.mjs
import { Resvg } from "@resvg/resvg-js";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const fibers = Array.from({ length: 44 }, (_, i) => {
  const a = (i / 44) * Math.PI * 2 + (i % 3) * 0.03;
  const r0 = 14 + (i % 4);
  const r1 = 29 + (i % 5) * 1.2;
  const o = 0.1 + (i % 5) * 0.045;
  return `<line x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * r1).toFixed(2)}" y2="${(Math.sin(a) * r1).toFixed(2)}" stroke="#f0d9ff" stroke-opacity="${o.toFixed(2)}" stroke-width="0.9" stroke-linecap="round"/>`;
}).join("");

const almond = "M -92 0 C -48 -58 48 -58 92 0 C 48 58 -48 58 -92 0 Z";

// Square badge (dark, rounded) so the eye reads on light and dark taskbars.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="bg" cx="512" cy="430" r="700" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#241438"/>
      <stop offset="1" stop-color="#0a0710"/>
    </radialGradient>
    <radialGradient id="sclera" cx="0" cy="0" r="92" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2a1c44"/><stop offset="0.6" stop-color="#150e24"/><stop offset="1" stop-color="#0a0612"/>
    </radialGradient>
    <radialGradient id="iris" cx="0" cy="0" r="34" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f0c8ff"/><stop offset="0.36" stop-color="#c35cff"/><stop offset="0.66" stop-color="#8b00ff"/><stop offset="0.9" stop-color="#4a0094"/><stop offset="1" stop-color="#22003f"/>
    </radialGradient>
    <radialGradient id="pupil" cx="-3" cy="-3" r="15" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff7a7a"/><stop offset="0.35" stop-color="#ff1f1f"/><stop offset="0.8" stop-color="#d70000"/><stop offset="1" stop-color="#6a0000"/>
    </radialGradient>
    <filter id="b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <filter id="b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
    <clipPath id="clip"><path d="${almond}"/></clipPath>
  </defs>
  <rect x="24" y="24" width="976" height="976" rx="220" fill="url(#bg)"/>
  <rect x="24" y="24" width="976" height="976" rx="220" fill="none" stroke="#8b00ff" stroke-opacity="0.55" stroke-width="10"/>
  <g transform="translate(512 512) scale(4.3)">
    <path d="${almond}" fill="none" stroke="#b44cff" stroke-width="9" filter="url(#b6)" opacity="0.9"/>
    <g clip-path="url(#clip)">
      <rect x="-100" y="-70" width="200" height="140" fill="url(#sclera)"/>
      <circle r="40" fill="#8b00ff" filter="url(#b6)" opacity="0.8"/>
      <circle r="36" fill="url(#iris)" transform="scale(1.06)"/>
      <g transform="scale(1.06)">${fibers}</g>
      <circle r="36" fill="none" stroke="#1b0033" stroke-width="2.4"/>
      <circle r="16" fill="#ff2a2a" filter="url(#b3)"/>
      <circle r="13" fill="url(#pupil)"/>
      <ellipse cx="-12" cy="-13" rx="5.5" ry="4" fill="#fff" opacity="0.9" transform="rotate(-25 -12 -13)"/>
    </g>
    <path d="${almond}" fill="none" stroke="#dcc6ff" stroke-width="3.2" stroke-linejoin="round"/>
  </g>
</svg>`;

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/eye-icon.svg", svg);
const png = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng();
writeFileSync("scripts/out/eye-icon.png", png);
console.log("rendered scripts/out/eye-icon.png");
execSync("npx tauri icon scripts/out/eye-icon.png", { stdio: "inherit" });
