// Records the demo GIF from the running local UI (`npm run serve`), with real reviews.
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs [DEMO_SCALE=1.125] node demo/record.mjs OUT_DIR
// Frames are screenshots with explicit durations, so the model's wait is shortened
// honestly: the GIF holds one "reading" frame and the card states the real latency.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT ?? "playwright");
const out = process.argv[2] ?? "demo/out";
const url = process.env.DEMO_URL ?? "http://localhost:5174/";
mkdirSync(join(out, "frames"), { recursive: true });

const cases = [
  { caption: "A social-proof line translated word by word",
    text: "Fidato da oltre 2.000 negozi", en: "Trusted by over 2,000 shops", ctx: "homepage social proof" },
  { caption: "An English-style heading",
    text: "Inizia Oggi la Tua Prova Gratuita", en: "Start Your Free Trial Today", ctx: "pricing page heading" },
  { caption: "A line that is already right",
    text: "Prova gratis per 14 giorni", en: "Try it free for 14 days", ctx: "pricing page button" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 900 }, deviceScaleFactor: Number(process.env.DEMO_SCALE ?? 1.125) });
await page.goto(url);
await page.addStyleTag({ content: `
  #demo-bar { position: sticky; top: 0; z-index: 9; display: flex; gap: 12px; align-items: baseline;
    margin: -32px -16px 20px; padding: 12px 16px; background: #1d1b18; color: #faf7f2; font-size: 15px; }
  #demo-bar b { color: #9bb7e0; font-variant-numeric: tabular-nums; }
  .demo-time { float: right; color: #6b645b; font-size: .85rem; }
  main { padding-top: 32px; }
` });
await page.evaluate(() => {
  const bar = document.createElement("div");
  bar.id = "demo-bar";
  document.querySelector("main").prepend(bar);
});

const frames = [];
async function frame(seconds) {
  const file = `f${String(frames.length).padStart(4, "0")}.png`;
  await page.screenshot({ path: join(out, "frames", file) });
  frames.push({ file, seconds });
}

async function typeInto(selector, value) {
  await page.fill(selector, "");
  await page.focus(selector);
  for (let i = 0; i < value.length; i += 2) {
    await page.keyboard.type(value.slice(i, i + 2));
    await frame(0.05);
  }
}

const results = [];
for (const [i, c] of cases.entries()) {
  await page.evaluate(([n, caption]) => {
    document.getElementById("demo-bar").innerHTML = `<b>${n} / 3</b><span>${caption}</span>`;
    document.getElementById("out").innerHTML = "";
  }, [i + 1, c.caption]);
  await frame(1.4);
  await typeInto("#text", c.text);
  await typeInto("#en", c.en);
  await typeInto("#context", c.ctx);
  await frame(0.5);

  const started = Date.now();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/review"), { timeout: 180_000 });
  await page.click("#go");
  await page.waitForSelector("#out .card");
  await page.waitForTimeout(300);
  await frame(1.1);
  const body = await (await response).json();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  await page.waitForSelector("#out .verdict");
  await page.evaluate((s) => {
    const card = document.querySelector("#out .card");
    card.insertAdjacentHTML("afterbegin", `<span class="demo-time">took ${s} s · wait cut from this recording</span>`);
    card.scrollIntoView({ block: "end" });
  }, seconds);
  for (let k = 0; k < 4; k++) await frame(0.06);
  await frame(i === cases.length - 1 ? 6 : 5);
  results.push({ case: c, seconds: Number(seconds), review: body.review, toolCalls: body.toolCalls });
  await page.evaluate(() => window.scrollTo(0, 0));
}
await browser.close();

writeFileSync(join(out, "reviews.json"), JSON.stringify(results, null, 1));
const list = frames.map((f) => `file 'frames/${f.file}'\nduration ${f.seconds}`).join("\n");
writeFileSync(join(out, "frames.txt"), `${list}\nfile 'frames/${frames.at(-1).file}'\n`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(out, "frames.txt"),
  "-vf", "fps=20,split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
  join(out, "sanity-demo.gif")]);
// The same frames as an MP4 for a video host; even dimensions for H.264.
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(out, "frames.txt"),
  "-vf", "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0xfaf7f2,format=yuv420p", "-c:v", "libx264", "-crf", "18",
  "-preset", "slow", "-movflags", "+faststart", join(out, "sanity-demo.mp4")]);
console.log(`${frames.length} frames, ${results.map((r) => `${r.review.verdict} in ${r.seconds}s`).join(", ")}`);
