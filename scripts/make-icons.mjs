// Renders Elise's eye (same geometry as the in-app <Eye>) to a 1024px PNG,
// then lets the Tauri CLI build every icon size from it.
//   node scripts/make-icons.mjs
import { Resvg } from "@resvg/resvg-js";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { staticEyeSvg } from "../src/components/eyeArt.ts";

// Black rounded square so the eye reads on light and dark taskbars.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="16" y="16" width="992" height="992" rx="210" fill="#000"/>
  <rect x="16" y="16" width="992" height="992" rx="210" fill="none" stroke="#2a2a30" stroke-width="8"/>
  <g transform="translate(512 548) scale(1.66)">${staticEyeSvg("i")}</g>
</svg>`;

mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/eye-icon.svg", svg);
writeFileSync("scripts/out/eye-icon.png", new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render().asPng());
console.log("rendered scripts/out/eye-icon.png");
execSync("npx tauri icon scripts/out/eye-icon.png", { stdio: "inherit" });

// Keep only what a Windows build uses.
const keep = new Set(["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.png"]);
for (const f of readdirSync("src-tauri/icons")) {
  if (!keep.has(f)) rmSync(`src-tauri/icons/${f}`, { recursive: true, force: true });
}
