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

for (const fx of ["spx", "nvda"]) {
  await page.goto(`${BASE}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 60_000 });
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-ladder-440x956@3x.png`) });

  await tapQuote(page, fx === "spx" ? "call-ask-7545" : "call-ask-182.5");
  await page.waitForSelector("[data-testid='options-chain-order-sheet']", { timeout: 30_000 });
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-1leg-440x956@3x.png`) });

  const strike2 = fx === "spx" ? "7550" : "185";
  await tapQuote(page, `call-bid-${strike2}`);
  await page.waitForTimeout(400);
  const legs = await page.locator("[data-testid='options-chain-order-sheet']").innerText();
  if (!legs.includes("2 legs") && !legs.includes("2 leg")) {
    console.warn(`warn: expected 2 legs on ${fx}, got: ${legs.slice(0, 80)}`);
  }
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-2leg-440x956@3x.png`) });

  await page.locator("[data-testid='options-chain-order-sheet']").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `at-phase-a-${fx}-sheet-expanded-440x956@3x.png`) });
}

await browser.close();
vite.kill();
console.log(JSON.stringify({ ok: true, out: OUT }, null, 2));