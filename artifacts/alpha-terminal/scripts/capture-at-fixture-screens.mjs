import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";
const MOCKUP = "/home/ubuntu/.cursor/projects/agent-repos-Alpha-Terminal/assets/mockup_20261117.png";

const scenes = [
  { name: "at-01-default-440x956.png", url: `${BASE}?scene=default` },
  { name: "at-02-trade-strip-440x956.png", url: `${BASE}?scene=strip` },
  { name: "at-03-confirm-disabled-440x956.png", url: `${BASE}?scene=confirm` },
  { name: "at-04-chain-unchanged-440x956.png", url: `${BASE}?scene=chain` },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

for (const scene of scenes) {
  await page.goto(scene.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const waitText = scene.name.includes("chain") ? "Strike" : "PUT FLOW";
  await page.waitForFunction(
    (needle) => document.body?.innerText?.includes(needle),
    waitText,
    { timeout: 45_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(scene.name.includes("strip") ? 1500 : scene.name.includes("confirm") ? 2200 : 1200);
  await page.screenshot({ path: path.join(OUT, scene.name), fullPage: false });
}

await page.goto(`${BASE}?scene=default`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
const actualPath = path.join(OUT, "at-01-default-440x956.png");
const comparePath = path.join(OUT, "at-compare-mockup-440x956.png");

const { execSync } = await import("node:child_process");
try {
  execSync(
    `convert "${MOCKUP}" -resize 440x956! "${OUT}/mockup-resized.png" && ` +
      `convert +append -bordercolor black -border 4 ` +
      `"${OUT}/mockup-resized.png" "${actualPath}" "${comparePath}"`,
    { stdio: "inherit" },
  );
} catch {
  execSync(`cp "${actualPath}" "${comparePath}"`);
}

await browser.close();
console.log("Wrote screenshots to", OUT);