import { test, expect } from "@playwright/test";

const base = process.env.AT_GLANCE_LAYOUT_BASE ?? "http://127.0.0.1:3000/dev/active-trader";

const overlapCheck = () => {
  const glance = document.querySelector("[data-at-glance-top]");
  if (!glance) return { ok: false, reason: "no_glance" as const };
  const g = glance.getBoundingClientRect();
  const selectors = [
    "[data-at-settings-summary]",
    '[data-ui-audit="at-puts-hdr"]',
    "[data-at-symbol-header]",
  ];
  let worstOverlap = 0;
  let nextTop: number | null = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    if (top < g.top + 2) continue;
    const overlap = g.bottom - top;
    if (overlap > worstOverlap) {
      worstOverlap = overlap;
      nextTop = top;
    }
  }
  return {
    ok: worstOverlap <= 0.5,
    overlapPx: worstOverlap,
    glancePx: g.height,
    glanceBottom: g.bottom,
    nextTop,
    window: document.querySelector("[data-at-glance-flow-window]")?.getAttribute("data-at-glance-flow-window"),
  };
};

const fixtures = ["spx", "nvda", "es"] as const;
const windows = ["1m", "5m", "hr"] as const;

for (const fx of fixtures) {
  for (const win of windows) {
    test(`glance stack ${fx} flow ${win} @440`, async ({ page }) => {
      await page.setViewportSize({ width: 440, height: 956 });
      await page.goto(`${base}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector("[data-at-glance-flow='live']", { timeout: 60_000 });
      await page.locator(`[data-at-glance-flow-seg="${win}"]`).click();
      await expect(page.locator("[data-at-glance-flow-window]")).toHaveAttribute("data-at-glance-flow-window", win);
      const m = await page.evaluate(overlapCheck);
      expect(m.ok, JSON.stringify(m)).toBe(true);
      expect(m.glancePx).toBeLessThanOrEqual(110.5);
    });
  }
}