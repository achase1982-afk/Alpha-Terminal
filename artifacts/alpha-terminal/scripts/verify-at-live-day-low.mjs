import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-day-low";
const IPHONE = devices["iPhone 17 Pro Max"] ?? devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

function wcagContrastRatio(fgRgb, bgRgb) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luma = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const l1 = luma(...fgRgb);
  const l2 = luma(...bgRgb);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(css) {
  const m = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

async function runHeight(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("at").catch(() => undefined);
  await page.waitForSelector("[data-at-glance-top]", { timeout: 90_000 });
  await page.waitForSelector("[data-at-day-low-zone]", { timeout: 90_000 });

  const dayLow = await page.locator("[data-at-day-low]").innerText();
  const zoneRef = page.locator("[data-at-low-zone-ref]");
  const zoneText = (await zoneRef.count()) > 0 ? await zoneRef.first().innerText() : "";
  const asOf = await page
    .locator("[data-at-day-low-as-of]")
    .innerText()
    .catch(() => "");

  const noZero =
    !/\b0\.00\b/.test(dayLow) && !/\bDay low 0\b/.test(dayLow) && !zoneText.includes("Low zone (ref) 0");
  record(`no zero placeholder (${height}px)`, noZero, `${dayLow.trim()} | ${zoneText.trim()}`);

  const hasLabel = /Day low|Prev low/.test(dayLow) && (/Low zone \(ref\)/.test(zoneText) || /Low zone: pending/.test(zoneText));
  record(`labels present (${height}px)`, hasLabel, "ok");

  const asOfOk = asOf === "" || /^as of \d{1,2}:\d{2} ET$/.test(asOf.trim());
  record(`as-of timestamp (${height}px)`, asOfOk, asOf.trim() || "(none)");

  if ((await zoneRef.count()) > 0) {
    await page.getByRole("button", { name: "Low zone reference info" }).click();
    const tip = await page.locator("[data-at-low-zone-tooltip]").innerText();
    const tipOk =
      tip.includes("FINAL daily lows") &&
      tip.includes("NOT a forecast") &&
      tip.includes("K fixed at 35") &&
      tip.includes("L1 stream");
    record(`tooltip copy (${height}px)`, tipOk, tip.slice(0, 120));
  }

  const contrast = await page.evaluate(() => {
    const zoneEl =
      document.querySelector("[data-at-low-zone-ref]") ?? document.querySelector("[data-at-day-low]");
    const glance = document.querySelector("[data-at-glance-top]");
    if (!zoneEl || !glance) return null;
    const fg = getComputedStyle(zoneEl).color;
    const bg = getComputedStyle(glance).backgroundColor;
    return { fg, bg };
  });

  if (contrast?.fg && contrast?.bg) {
    const fgRgb = parseRgb(contrast.fg);
    const bgRgb = parseRgb(contrast.bg);
    if (fgRgb && bgRgb) {
      const ratio = wcagContrastRatio(fgRgb, bgRgb);
      record(`WCAG contrast >=4.5:1 (${height}px)`, ratio >= 4.5, ratio.toFixed(2));
    } else {
      record(`WCAG contrast (${height}px)`, false, "unparsed rgb");
    }
  } else {
    record(`WCAG contrast (${height}px)`, false, "missing element");
  }

  await page.screenshot({ path: path.join(OUT, `live-at-day-low-${height}px.png`) });
}

try {
  await runHeight(956);
  await runHeight(658);
} catch (err) {
  record("day-low capture", false, err instanceof Error ? err.message : String(err));
}

await writeFile(
  path.join(OUT, "live-at-day-low-report.json"),
  JSON.stringify({ checks, live: LIVE, out: OUT }, null, 2),
);
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
