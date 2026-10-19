// Renders SMIL-animated SVGs to animated GIFs by stepping the SVG clock in headless Chrome.
// usage: npm i --no-save puppeteer-core@23.11.1 gifenc@1.0.3 pngjs@7.0.0 && node scripts/make-gifs.mjs assets assets/gif
// Needs Google Chrome at the macOS default path.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import puppeteer from "puppeteer-core";
import gifenc from "gifenc";
import { PNG } from "pngjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const [assets, out] = process.argv.slice(2);
const SIZE = 300; // px
const FPS = 12;
const LOOP_S = 7.2; // 2 blinks (3.6s), close to whole cycles of the other animations
const BG = "#ffffff";

mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();
await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });

for (const file of readdirSync(assets).filter((f) => f.endsWith(".svg")).sort()) {
  const svg = readFileSync(join(assets, file), "utf8")
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
    .replace(/\s+xmlns:c2pa="[^"]*"/, "")
    .replace(/width="\d+" height="\d+"/, `width="${SIZE}" height="${SIZE}"`);
  await page.setContent(`<html><body style="margin:0;background:${BG}">${svg}</body></html>`);
  await page.evaluate(() => document.querySelector("svg").pauseAnimations());

  const gif = GIFEncoder();
  const frames = Math.round(LOOP_S * FPS);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => document.querySelector("svg").setCurrentTime(t), i / FPS);
    const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: { x: 0, y: 0, width: SIZE, height: SIZE } })));
    const palette = quantize(png.data, 128);
    gif.writeFrame(applyPalette(png.data, palette), SIZE, SIZE, { palette, delay: Math.round(1000 / FPS) });
  }
  gif.finish();
  const name = basename(file, ".svg").replace(/^(stage\d).*/, "$1") + ".gif";
  writeFileSync(join(out, name), gif.bytes());
  console.log(`${file} -> ${name} (${frames} frames, ${(gif.bytes().length / 1024).toFixed(0)} KB)`);
}
await browser.close();
