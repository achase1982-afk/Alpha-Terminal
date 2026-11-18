import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installSafeAreaInsets } from "./lib/iphone17ProMax.js";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";

async function startVite() {
  try {
    execSync("pkill -f 'vite --host 127.0.0.1 --port 3000' || true", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 500));
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_TOP: "1",
      VITE_AT_GLANCE_FLOW_FIXTURE: "1",
    },
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}?fixture=nvda`).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite timeout");
}

function tapQuote(page, sel) {
  return page.locator(`[data-at-quote="${sel}"]`).click({ timeout: 15_000 });
}

function parseMoney(text) {
  const m = text.match(/\$?([\d,]+\.\d{2})/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

async function assertSpxTwoLeg(page) {
  const limit = await page.locator("[data-testid='chain-sheet-limit']").inputValue();
  const mid = parseFloat(limit);
  if (!Number.isFinite(mid) || mid < 1.5 || mid > 3) {
    throw new Error(`expected spread limit ~2.15, got ${limit}`);
  }
  const body = await page.locator("[data-testid='options-chain-order-sheet']").innerText();
  const maxLoss = parseMoney(body.match(/Max loss[\s\S]*?(\$[\d,.]+)/i)?.[1] ?? "");
  const maxProfit = parseMoney(body.match(/Max profit[\s\S]*?(\$[\d,.]+)/i)?.[1] ?? "");
  if (maxLoss != null && (maxLoss < 150 || maxLoss > 350)) {
    throw new Error(`max loss out of range: ${maxLoss} (text snippet: ${body.slice(0, 200)})`);
  }
  if (maxProfit != null && (maxProfit < 200 || maxProfit > 400)) {
    throw new Error(`max profit out of range: ${maxProfit}`);
  }
  if (body.includes("1,360") || body.includes("1360")) {
    throw new Error("stale single-leg max loss still visible");
  }
  return { limit: mid, maxLoss, maxProfit };
}

await mkdir(OUT, { recursive: true });
const vite = await startVite();
const browser = await webkit.launch();
const page = await browser.newPage({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await installSafeAreaInsets(page, 62, 34);

const checks = {};

for (const fx of ["spx", "nvda"]) {
  await page.goto(`${BASE}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-ladder-440x956@3x.png`) });

  await tapQuote(page, fx === "spx" ? "call-ask-7545" : "call-ask-182.5");
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-1leg-440x956@3x.png`) });

  const strike2 = fx === "spx" ? "7550" : "185";
  await tapQuote(page, `call-bid-${strike2}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-2leg-440x956@3x.png`) });
  if (fx === "spx") {
    checks.spx2leg = await assertSpxTwoLeg(page);
  }

  if (fx === "spx") {
    await page.locator("button", { hasText: "CLEAR" }).click();
    await page.waitForTimeout(300);
    await tapQuote(page, "put-bid-7530");
    await tapQuote(page, "put-ask-7520");
    await tapQuote(page, "call-bid-7550");
    await tapQuote(page, "call-ask-7555");
    await page.waitForTimeout(500);
    const icText = await page.locator("[data-testid='options-chain-order-sheet']").innerText();
    if (!icText.match(/4\s*leg/i)) {
      console.warn("warn: expected 4 legs iron condor", icText.slice(0, 120));
    }
    await page.screenshot({ path: path.join(OUT, `at-phase-a-spx-4leg-440x956@3x.png`) });
  }

  await page.locator("[data-testid='options-chain-order-sheet']").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-sheet-expanded-440x956@3x.png`) });
}

await browser.close();
vite.kill();
console.log(JSON.stringify({ ok: true, out: OUT, checks }, null, 2));