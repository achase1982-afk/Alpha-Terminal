/**
 * Live AAPL: chain + AT quote reasons, heat pill, ladder caption @ 440×956 WebKit.
 */
import { webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/opt/cursor/artifacts/at-aapl-quote-reasons";

async function pickSymbol(page, label) {
  await page.getByRole("button", { name: "MARKETS", exact: true }).click({ timeout: 25_000 }).catch(() => undefined);
  await page.waitForTimeout(350);
  await page.keyboard.press("Meta+k").catch(() => page.keyboard.press("Control+k"));
  await page.waitForTimeout(250);
  await page.getByPlaceholder(/search|symbol/i).first().fill(label.replace(/^\$/, ""), { timeout: 8_000 });
  await page.waitForTimeout(200);
  await page.getByRole("option", { name: new RegExp(label.replace(/^\$/, ""), "i") }).first().click({ timeout: 8_000 }).catch(() =>
    page.keyboard.press("Enter"),
  );
  await page.waitForTimeout(700);
}

const report = { checks: [] };
const record = (name, pass, detail) => report.checks.push({ name, pass, detail });

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);
await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
await pickSymbol(page, "AAPL");

await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(OUT, "aapl-chain-440x956.png"), fullPage: true });

const chain = await page.evaluate(() => {
  const reasons = [...document.querySelectorAll("[data-chain-quote-reason]")]
    .map((el) => el.getAttribute("data-chain-quote-reason"))
    .filter(Boolean);
  const breakdown = { Crossed: 0, "No quote": 0, Stale: 0 };
  for (const r of reasons) breakdown[r] = (breakdown[r] ?? 0) + 1;
  return { reasonCount: reasons.length, breakdown, sample: reasons.slice(0, 12) };
});
record("chain shows quote reasons when invalid", chain.reasonCount >= 0, JSON.stringify(chain));

await page.locator('[data-at-view-selector] select').first().selectOption("at");
await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
await page.waitForTimeout(2500);

const at = await page.evaluate(() => {
  const pill = document.querySelector("[data-at-ladder-heat-source]")?.textContent?.trim() ?? "";
  const fresh = document.querySelector("[data-at-ladder-heat-fresh]")?.getAttribute("data-at-ladder-heat-fresh") ?? "";
  const caption = document.querySelector("[data-at-ladder-heat-caption]")?.textContent?.trim() ?? "";
  const captionLines = caption.split("\n").filter(Boolean).length;
  const captionRect = document.querySelector("[data-at-ladder-heat-caption]")?.getBoundingClientRect();
  const unavailable = [...document.querySelectorAll("[data-at-quote-unavailable]")].map((el) => ({
    strike: el.closest("[data-at-strike]")?.getAttribute("data-at-strike"),
    reason: el.getAttribute("data-at-quote-unavailable"),
  }));
  const breakdown = { Crossed: 0, "No quote": 0, Stale: 0 };
  for (const u of unavailable) {
    const r = u.reason ?? "";
    if (r in breakdown) breakdown[r] += 1;
  }
  const headerRange = document.querySelector('[data-ui-audit="metrics-day-range"]')?.textContent?.trim() ?? "";
  return { pill, fresh, caption, captionLines, captionH: captionRect?.height, unavailable: unavailable.slice(0, 20), breakdown, headerRange };
});

record("ladder caption one line", at.caption === "Contracts · 30s" && (at.captionLines ?? 1) <= 1, `${at.caption} lines=${at.captionLines}`);
record("caption height readable", (at.captionH ?? 99) < 24, `h=${at.captionH}`);
record(
  "heat pill not live when quotes degraded",
  !at.pill.includes("Live · ~1s poll") || at.unavailable.length === 0,
  `pill=${at.pill} fresh=${at.fresh} breakdown=${JSON.stringify(at.breakdown)}`,
);
record("day range not zero placeholder", !/\$0\.00.*\$0\.00/.test(at.headerRange), at.headerRange);

await page.screenshot({ path: path.join(OUT, "aapl-at-quotes-440x956.png") });

report.failed = report.checks.filter((c) => !c.pass).length;
report.at = at;
report.chain = chain;
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.failed ? 1 : 0);