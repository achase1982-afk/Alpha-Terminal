import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";
const MOCKUP = "/home/ubuntu/.cursor/projects/agent-repos-Alpha-Terminal/assets/mockup_20261117.png";

const scenes = [
  { name: "at-01-default-440x956.png", url: `${BASE}?scene=default`, waitSelector: "[data-at-key-levels]" },
  { name: "at-01-focus-off-440x956.png", url: `${BASE}?scene=focus-off`, waitSelector: "[data-at-key-levels]" },
  { name: "at-01-settings-expanded-440x956.png", url: `${BASE}?scene=settings-expanded`, waitSelector: "[data-at-key-levels]" },
  {
    name: "at-02-trade-strip-440x956.png",
    url: `${BASE}?scene=strip`,
    waitSelector: "[data-at-trade-strip]",
  },
  { name: "at-03-confirm-disabled-440x956.png", url: `${BASE}?scene=confirm`, waitText: "Trigger order summary" },
  { name: "at-04-chain-unchanged-440x956.png", url: `${BASE}?scene=chain`, waitText: "CALLS" },
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
  if (scene.waitSelector) {
    await page.waitForSelector(scene.waitSelector, { timeout: 45_000 }).catch(() => undefined);
  }
  if (scene.waitText) {
    await page
      .waitForFunction((needle) => document.body?.innerText?.includes(needle), scene.waitText, {
        timeout: 45_000,
      })
      .catch(() => undefined);
  }
  const delay = scene.name.includes("strip")
    ? 1500
    : scene.name.includes("confirm")
      ? 2200
      : scene.name.includes("expanded")
        ? 1500
        : 1200;
  await page.waitForTimeout(delay);
  if (scene.name.includes("01-default")) {
    const rowCount = await page.locator("[data-at-strike]").count();
    console.log(`Ladder strike rows in DOM: ${rowCount}`);
  }
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

await page.goto(`${BASE}?scene=chain`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const chainClip = await page.locator('[data-ui-audit="chain-strike-cell"]').first().boundingBox();
if (chainClip) {
  await page.screenshot({
    path: path.join(OUT, "at-font-compare-chain-crop.png"),
    clip: {
      x: Math.max(0, chainClip.x - 120),
      y: Math.max(0, chainClip.y - 40),
      width: 280,
      height: 120,
    },
  });
}

await page.goto(`${BASE}?scene=default`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const atStrike = await page.locator('[data-at-strike="7540"]').boundingBox();
if (atStrike) {
  await page.screenshot({
    path: path.join(OUT, "at-font-compare-at-crop.png"),
    clip: {
      x: Math.max(0, atStrike.x - 120),
      y: Math.max(0, atStrike.y - 40),
      width: 280,
      height: 120,
    },
  });
}

try {
  execSync(
    `convert +append -bordercolor black -border 4 ` +
      `"${OUT}/at-font-compare-chain-crop.png" "${OUT}/at-font-compare-at-crop.png" ` +
      `"${OUT}/at-font-compare-side-by-side.png"`,
    { stdio: "inherit" },
  );
} catch {
  /* ignore if convert missing */
}

await browser.close();
console.log("Wrote screenshots to", OUT);