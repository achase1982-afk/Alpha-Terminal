/**
 * Dev-only: load SPX then /ES Active Trader fixtures; fail on React hooks console errors.
 */
import { webkit } from "playwright";

const BASE = "http://127.0.0.1:3000/dev/active-trader";

async function collectHooksErrors(page, fixture) {
  const errors = [];
  page.on("console", (msg) => {
    const t = msg.text();
    if (/hooks.*order|Rendered more hooks|fewer hooks/i.test(t)) errors.push(t);
  });
  page.on("pageerror", (err) => {
    if (/hooks/i.test(err.message)) errors.push(err.message);
  });
  await page.goto(`${BASE}?fixture=${fixture}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1200);
  return errors;
}

const browser = await webkit.launch();
const all = [];
for (const fx of ["spx", "es", "spx"]) {
  const ctx = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  all.push(...(await collectHooksErrors(page, fx)));
  await ctx.close();
}
await browser.close();
if (all.length) {
  console.error("Hooks errors:", all);
  process.exit(1);
}
console.log("OK: SPX ↔ ES Active Trader — no hooks errors");