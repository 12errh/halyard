/**
 * Render an SVG to PNG at exact sizes.
 *
 * Chromium is used rather than an SVG rasteriser because it honours the same
 * gradients and `shape-rendering` the app will use, so the icon matches what
 * the UI draws. Transparent background via the headless default.
 */
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const CHROME = "/home/rehan/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";

const [svgPath, outDir, ...sizes] = process.argv.slice(2);
const svg = readFileSync(svgPath, "utf8");

for (const size of sizes.map(Number)) {
  const dir = mkdtempSync(join(tmpdir(), "raster-"));
  const page = `<!doctype html><meta charset=utf-8>
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
  const html = join(dir, "p.html");
  writeFileSync(html, page);
  const out = join(outDir, `${size}.png`);
  await new Promise((res, rej) => {
    const p = spawn(CHROME, [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--default-background-color=00000000",
      `--user-data-dir=${join(dir, "prof")}`,
      `--window-size=${size},${size}`,
      "--virtual-time-budget=4000",
      `--screenshot=${out}`,
      `file://${html}`,
    ], { stdio: "ignore" });
    p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`chrome ${c}`))));
  });
  rmSync(dir, { recursive: true, force: true });
  console.log("wrote", out);
}
