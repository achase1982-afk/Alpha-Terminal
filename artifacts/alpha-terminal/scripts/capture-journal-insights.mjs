import { mkdir } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { IPHONE_17_PRO_MAX, installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const OUT = process.env.JOURNAL_ARTIFACT_DIR ?? "/opt/cursor/artifacts";
const BASE = process.env.JOURNAL_BASE_URL ?? "http://127.0.0.1:4178/dev/journal";

const scenes = [
  { name: "journal-insights-440x956.png", view: "insights", ready: "[data-journal-benchmark]" },
  { name: "journal-drill-440x956.png", view: "drill", ready: "[data-journal-headline]" },
  { name: "journal-trades-440x956.png", view: "trades", ready: "[data-journal-root]" },
  { name: "journal-empty-440x956.png", view: "empty", ready: "[data-journal-empty]" },
];

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: IPHONE_17_PRO_MAX.width, height: IPHONE_17_PRO_MAX.height },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await installSafeAreaInsets(page, IPHONE_17_PRO_MAX.safeTop, IPHONE_17_PRO_MAX.safeBottom);

for (const scene of scenes) {
  await page.goto(`${BASE}?view=${scene.view}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(scene.ready).first().waitFor({ state: "visible", timeout: 20_000 });
  const scroll = await page.evaluate(() => window.scrollY);
  if (scroll !== 0) throw new Error(`${scene.view} opened scrolled to ${scroll}`);
  if (scene.view === "insights") {
    const box = await page.locator("[data-journal-benchmark]").boundingBox();
    if (!box) throw new Error("benchmark box missing");
    if (box.y < 0 || box.y + box.height > IPHONE_17_PRO_MAX.height) {
      throw new Error(`benchmark is outside the first screen: y=${box.y} h=${box.height}`);
    }
    const headline = await page.locator("[data-journal-headline]").boundingBox();
    if (!headline || headline.y + headline.height > IPHONE_17_PRO_MAX.height) {
      throw new Error("headline is outside the first screen");
    }
  }
  if (scene.view === "empty") {
    const text = await page.locator("[data-journal-empty]").innerText();
    if (!text.includes("No closed trades in this period.")) {
      throw new Error(`empty copy missing: ${text}`);
    }
  }
  if (scene.view === "insights") {
    await page.getByRole("button", { name: /Credit spreads \(puts\)/ }).click();
    await page.getByText("IN THE BLACK").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Back to insights" }).click();
    await page.locator("[data-journal-benchmark]").waitFor({ state: "visible" });
  }
  const file = path.join(OUT, scene.name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", file);
}

await browser.close();
