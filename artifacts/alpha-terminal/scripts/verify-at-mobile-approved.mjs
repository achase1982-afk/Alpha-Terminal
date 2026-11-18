import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-mobile";
const IPHONE = devices["iPhone 14 Pro Max"];

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

async function openAt(page) {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  await page.waitForTimeout(500);
  const viewSel = page.locator('[data-at-view-selector] select, select[aria-label="Options view"]');
  await viewSel.first().selectOption("at");
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, { timeout: 90_000 });
}

await mkdir(OUT, { recursive: true });
const browser = await webkit.launch();
const ctx = await browser.newContext({ ...IPHONE, viewport: { width: 440, height: 956 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("alpha-terminal-storage", JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }));
});

await openAt(page);

const noTicket = (await page.locator("[data-at-approved-ticket]").count()) === 0;
record("empty: no ticket footer", noTicket, noTicket ? "ok" : "sheet visible");

const heatStates = await page.evaluate(() => {
  const pairs = [...document.querySelectorAll("[data-at-quote-heat]")].slice(0, 12);
  const states = pairs.map((el) => el.getAttribute("data-at-quote-heat-state"));
  const unavailable = states.filter((s) => s === "unavailable").length;
  return { count: pairs.length, unavailable, states: states.slice(0, 4) };
});
record(
  "ladder heat not dollar-unavailable",
  heatStates.count > 5 && heatStates.unavailable < heatStates.count,
  JSON.stringify(heatStates),
);

const heatTag = await page.locator("[data-at-ladder-heat-source]").innerText().catch(() => "");
record("ladder heat source tag", heatTag.includes("Live"), heatTag || "missing");

const quoteNeutral = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("[data-at-quote]")].slice(0, 6);
  return btns.every((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    return !bg.includes("209, 102") && !bg.includes("242, 54");
  });
});
record("quotes not volume-tinted", quoteNeutral, quoteNeutral ? "neutral" : "tinted");

await page.locator("[data-at-quote^='call-ask']").first().click({ timeout: 15_000 });
await page.waitForTimeout(500);

const ticket = await page.locator("[data-at-approved-ticket]").count();
record("one-leg ticket", ticket === 1, ticket ? "visible" : "missing");

const wrongSide = await page.evaluate(() => {
  const pressed = [...document.querySelectorAll("[data-at-quote][data-at-quote-side]")].filter((el) =>
    el.getAttribute("style")?.includes("solid"),
  );
  return pressed.every((el) => {
    const side = el.getAttribute("data-at-quote-side");
    const id = el.getAttribute("data-at-quote") ?? "";
    return (side === "BUY" && id.includes("ask")) || (side === "SELL" && id.includes("bid"));
  });
});
record("selection maps buy→ask sell→bid", wrongSide, wrongSide ? "ok" : "mismatch");

const limit0 = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
await page.waitForTimeout(1200);
const limit1 = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
await page.getByTestId("chain-sheet-limit").evaluate((el) => {
  el.dispatchEvent(new Event("focus"));
});
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Lock limit" }).click();
await page.waitForTimeout(600);
const limit2 = await page.getByTestId("chain-sheet-limit").inputValue().catch(() => "");
record("locked limit ignores mid refresh", limit1 === limit0 || limit1.length > 0, `before=${limit0} lock=${limit2}`);
record(
  "locked limit stable after quote tick",
  limit2 === limit1 && limit1.length > 0,
  limit2 === limit1 ? "stable" : `Δ ${limit1}→${limit2}`,
);

const overlap = await page.evaluate(() => {
  const header = document.querySelector("[data-at-glance-top]");
  if (!header) return false;
  const leaves = [...header.querySelectorAll("*")].filter((n) => n.children.length === 0 && (n.textContent ?? "").trim());
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i].getBoundingClientRect();
      const b = leaves[j].getBoundingClientRect();
      if (a.width < 2 || b.width < 2) continue;
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlapX > 2 && overlapY > 2) return true;
    }
  }
  return false;
});
record("header text no overlap", !overlap, overlap ? "intersect" : "ok");

await page.screenshot({ path: path.join(OUT, "live-at-mobile-1leg-440x956.png") });
await writeFile(path.join(OUT, "report.json"), JSON.stringify({ checks, failed: checks.filter((c) => !c.pass).length }, null, 2));
await browser.close();

const failed = checks.filter((c) => !c.pass).length;
console.log(JSON.stringify({ failed, checks }, null, 2));
process.exit(failed ? 1 : 0);