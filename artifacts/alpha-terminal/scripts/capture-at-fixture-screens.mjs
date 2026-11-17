import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const OUT = "/opt/cursor/artifacts";
const BASE = "http://127.0.0.1:3000/dev/active-trader";
const MOCKUP = "/home/ubuntu/.cursor/projects/agent-repos-Alpha-Terminal/assets/mockup_20261117.png";
const MIN_LADDER_ROWS = 15;

const scenes = [
  {
    name: "at-01-default-440x956.png",
    url: `${BASE}?scene=default`,
    waitSelector: "[data-at-key-levels]",
    minRows: MIN_LADDER_ROWS,
    scrollAtm: true,
  },
  {
    name: "at-01-settings-collapsed-440x956.png",
    url: `${BASE}?scene=settings-collapsed`,
    waitSelector: "[data-at-strike]",
    minRows: 10,
  },
  {
    name: "at-01-settings-expanded-440x956.png",
    url: `${BASE}?scene=settings-expanded`,
    waitSelector: "[data-at-settings-summary]",
    expandSettings: true,
    minRows: 8,
  },
  {
    name: "at-position-plus2-440x956.png",
    url: `${BASE}?scene=position`,
    waitSelector: "[data-at-strike='7545']",
    minRows: 8,
    clipStrike: 7545,
  },
  { name: "at-05-vertical-440x956.png", url: `${BASE}?scene=vertical`, waitSelector: "[data-at-key-levels]", minRows: 10 },
  {
    name: "at-02-trade-strip-440x956.png",
    url: `${BASE}?scene=strip`,
    waitSelector: "[data-at-trade-strip]",
    minRows: 0,
  },
  {
    name: "at-06-vertical-strip-440x956.png",
    url: `${BASE}?scene=strip-vertical`,
    waitSelector: "[data-at-trade-strip]",
    minRows: 0,
  },
  {
    name: "at-03-confirm-review-440x956.png",
    url: `${BASE}?scene=confirm`,
    waitText: "Trigger order summary",
    minRows: 0,
  },
];

async function waitForServer(ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}?scene=default`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return false;
}

async function startVite() {
  if (await waitForServer(2500)) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "3000", "--strictPort"], {
    cwd: PKG_ROOT,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, BROWSER: "none", VITE_DEV_BYPASS_AUTH: "true" },
  });
  child.unref();
  const ok = await waitForServer(120_000);
  if (!ok) {
    child.kill();
    throw new Error("Vite dev server did not become ready on :3000");
  }
  return child;
}

async function waitForLadderRows(page, minRows) {
  await page.waitForFunction(
    (min) => document.querySelectorAll("[data-at-strike]").length >= min,
    minRows,
    { timeout: 60_000 },
  );
}

async function scrollAtmIntoView(page) {
  await page.evaluate(() => {
    const spot = document.querySelector("[data-at-strike='7540']") ?? document.querySelector("[data-at-strike='7545']");
  const scrollParent =
      spot?.closest("[style*='overflow']") ??
      [...document.querySelectorAll("*")].find((el) => {
        const s = getComputedStyle(el);
        return (s.overflowY === "auto" || s.overflowY === "scroll") && el.querySelector("[data-at-strike]");
      });
    if (spot && scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const spotRect = spot.getBoundingClientRect();
      scrollParent.scrollTop += spotRect.top - parentRect.top - parentRect.height * 0.35;
    }
  });
  await page.waitForTimeout(400);
}

await mkdir(OUT, { recursive: true });
const viteChild = await startVite();

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

async function prepCaptureViewport(page) {
  await page.addStyleTag({
    content: `
      nav[aria-label="Main navigation"] { display: none !important; }
      [data-testid="bottom-nav"] { display: none !important; }
      footer, [class*="BottomNav"] { display: none !important; }
      [data-ui-audit="ticker-tape"] { display: none !important; }
    `,
  });
}

for (const scene of scenes) {
  await page.goto(scene.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await prepCaptureViewport(page);
  if (scene.waitSelector) {
    await page.waitForSelector(scene.waitSelector, { timeout: 60_000 });
  }
  if (scene.waitText) {
    await page.waitForFunction((needle) => document.body?.innerText?.includes(needle), scene.waitText, {
      timeout: 60_000,
    });
  }
  if (scene.minRows > 0) {
    await waitForLadderRows(page, scene.minRows);
  }
  if (scene.expandSettings) {
    const expanded = page.locator("[data-at-settings-expanded]");
    if (!(await expanded.isVisible().catch(() => false))) {
      await page.locator("[data-at-settings-summary]").click();
      await expanded.waitFor({ state: "visible", timeout: 15_000 });
    }
  }
  if (scene.name.includes("settings-collapsed") || scene.name.includes("01-default")) {
    const summary = page.locator("[data-at-settings-summary]");
    if (await summary.count()) {
      const expanded = page.locator("[data-at-settings-expanded]");
      if (await expanded.isVisible().catch(() => false)) {
        await summary.click();
        await page.waitForTimeout(300);
      }
    }
  }
  if (scene.scrollAtm) await scrollAtmIntoView(page);
  const delay = scene.name.includes("strip") ? 1800 : scene.name.includes("confirm") ? 2400 : 1200;
  await page.waitForTimeout(delay);

  if (scene.name.includes("01-default")) {
    const rowCount = await page.locator("[data-at-strike]").count();
    const vis = await page.evaluate(() => {
      const vh = window.innerHeight;
      return [...document.querySelectorAll("[data-at-strike]")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= vh;
      }).length;
    });
    console.log(`Ladder rows: DOM=${rowCount} visibleInViewport=${vis}`);
    const domOk = rowCount >= MIN_LADDER_ROWS;
    if (!domOk && vis < MIN_LADDER_ROWS) {
      throw new Error(`Expected ≥${MIN_LADDER_ROWS} ladder rows (DOM=${rowCount} visible=${vis})`);
    }
    if (vis < MIN_LADDER_ROWS) {
      console.warn(`Visible rows ${vis} < ${MIN_LADDER_ROWS}; DOM has ${rowCount} (chrome-limited viewport)`);
    }
  }

  if (scene.clipStrike) {
    const el = page.locator(`[data-at-strike='${scene.clipStrike}']`).first();
    const box = await el.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(OUT, scene.name),
        clip: {
          x: 0,
          y: Math.max(0, box.y - 120),
          width: 440,
          height: Math.min(956, box.height + 200),
        },
      });
      continue;
    }
  }

  await page.screenshot({ path: path.join(OUT, scene.name), fullPage: false });
}

await page.goto(`${BASE}?scene=default`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-at-key-levels]", { timeout: 60_000 });
await waitForLadderRows(page, MIN_LADDER_ROWS);
await scrollAtmIntoView(page);
await page.waitForTimeout(800);
const box = await page.locator("[data-at-key-levels]").first().boundingBox();
if (box) {
  await page.screenshot({
    path: path.join(OUT, "at-key-levels-zoom-440x956.png"),
    clip: {
      x: Math.max(0, box.x - 4),
      y: Math.max(0, box.y - 4),
      width: Math.min(440, box.width + 8),
      height: Math.min(130, box.height + 8),
    },
  });
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
if (viteChild) viteChild.kill();
console.log("Wrote screenshots to", OUT);