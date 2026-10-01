// Renders README screenshots + the summoning GIF from scripts/preview.html
// (sample data only). Needs the dev server: `npm run dev` in another terminal.
//   node scripts/screenshots.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:1420/scripts/preview.html";
const OUT = "docs/screenshots";
const EDGE = process.env.ELISE_BROWSER || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, userDataDir: process.env.ELISE_SHOT_PROFILE || "scripts/.edge-profile", args: ["--force-color-profile=srgb", "--no-first-run", "--no-default-browser-check"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 820, deviceScaleFactor: 1.5 });

// 1) Month view
await page.goto(BASE, { waitUntil: "networkidle0" });
await sleep(2500);
await page.screenshot({ path: `${OUT}/calendar.png` });

// 2) Typed command in the calendar
await page.click(".titlebar__eye .eye");
await sleep(900);
await page.type(".cmd__input input", "Dinner with Sarah on Saturday at 8pm, remind me an hour before", { delay: 8 });
await page.keyboard.press("Enter");
await sleep(1800);
await page.screenshot({ path: `${OUT}/command.png` });
await page.mouse.click(40, 600);

// 3) Week view
await page.click(".segmented button:nth-child(3)");
await sleep(1200);
await page.screenshot({ path: `${OUT}/week.png` });

// 4) Reminder in the corner overlay (over a dark backdrop instead of a desktop)
await page.setViewport({ width: 560, height: 560, deviceScaleFactor: 1.5 });
await page.goto(`${BASE}?window=overlay`, { waitUntil: "networkidle0" });
await page.addStyleTag({ content: "body.overlay{background:radial-gradient(circle at 70% 80%,#2a1b3d,#07050c 70%)!important}" });
await sleep(2200);
await page.screenshot({ path: `${OUT}/reminder.png` });

// 5) Big eye: record the summoning with the browser's screencast (real frame
//    timing), then assemble a GIF with Python/Pillow.
await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 });
const frames = `${OUT}/_frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
await page.goto("about:blank");
const cdp = await page.createCDPSession();
const shots = [];
cdp.on("Page.screencastFrame", async (f) => {
  shots.push({ data: f.data, t: f.metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, maxWidth: 960, maxHeight: 600 });
await page.goto(`${BASE}?window=stage`, { waitUntil: "domcontentloaded" });
await page.addStyleTag({ content: ".stage__hint,.stage__close{display:none!important}" });
await sleep(4200);
await cdp.send("Page.stopScreencast");
await page.screenshot({ path: `${OUT}/big-eye.png` });
await browser.close();

const { writeFileSync } = await import("node:fs");
const timing = [];
shots.forEach((s, i) => {
  writeFileSync(`${frames}/${String(i).padStart(4, "0")}.png`, Buffer.from(s.data, "base64"));
  timing.push(Math.round(((shots[i + 1]?.t ?? s.t + 0.6) - s.t) * 1000));
});
writeFileSync(`${frames}/timing.json`, JSON.stringify(timing));

execFileSync("python", ["-c", `
import glob, json
from PIL import Image
d = r"${frames}"
files = sorted(glob.glob(d + "/*.png"))
timing = json.load(open(d + "/timing.json"))
# drop blank frames before the page painted
keep = [(f, t) for f, t in zip(files, timing) if Image.open(f).convert("L").getextrema()[1] > 30]
frames, durs = [], []
for f, t in keep:
    t = max(20, min(t, 1500))
    if frames and t < 40 and durs[-1] < 40:  # merge very fast frames to keep the file small
        durs[-1] += t
        continue
    frames.append(Image.open(f).convert("RGB").resize((720, 450), Image.LANCZOS))
    durs.append(t)
durs[-1] = 1500
pal = [im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im in frames]
pal[0].save(r"${OUT}/summon.gif", save_all=True, append_images=pal[1:], duration=durs, loop=0, optimize=True)
print("gif frames:", len(pal), "length ms:", sum(durs))
`], { stdio: "inherit" });
rmSync(frames, { recursive: true, force: true });
console.log("screenshots written to", OUT);
