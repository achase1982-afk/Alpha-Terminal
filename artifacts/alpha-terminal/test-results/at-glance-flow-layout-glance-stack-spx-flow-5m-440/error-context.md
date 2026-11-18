# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: at-glance-flow-layout.spec.ts >> glance stack spx flow 5m @440
- Location: e2e/at-glance-flow-layout.spec.ts:42:5

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/dev/active-trader?fixture=spx
Call log:
  - navigating to "http://127.0.0.1:3000/dev/active-trader?fixture=spx", waiting until "domcontentloaded"

```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const base = process.env.AT_GLANCE_LAYOUT_BASE ?? "http://127.0.0.1:3000/dev/active-trader";
  4  | 
  5  | const overlapCheck = () => {
  6  |   const glance = document.querySelector("[data-at-glance-top]");
  7  |   if (!glance) return { ok: false, reason: "no_glance" as const };
  8  |   const g = glance.getBoundingClientRect();
  9  |   const selectors = [
  10 |     "[data-at-settings-summary]",
  11 |     '[data-ui-audit="at-puts-hdr"]',
  12 |     "[data-at-symbol-header]",
  13 |   ];
  14 |   let worstOverlap = 0;
  15 |   let nextTop: number | null = null;
  16 |   for (const sel of selectors) {
  17 |     const el = document.querySelector(sel);
  18 |     if (!el) continue;
  19 |     const top = el.getBoundingClientRect().top;
  20 |     if (top < g.top + 2) continue;
  21 |     const overlap = g.bottom - top;
  22 |     if (overlap > worstOverlap) {
  23 |       worstOverlap = overlap;
  24 |       nextTop = top;
  25 |     }
  26 |   }
  27 |   return {
  28 |     ok: worstOverlap <= 0.5,
  29 |     overlapPx: worstOverlap,
  30 |     glancePx: g.height,
  31 |     glanceBottom: g.bottom,
  32 |     nextTop,
  33 |     window: document.querySelector("[data-at-glance-flow-window]")?.getAttribute("data-at-glance-flow-window"),
  34 |   };
  35 | };
  36 | 
  37 | const fixtures = ["spx", "nvda", "es"] as const;
  38 | const windows = ["1m", "5m", "hr"] as const;
  39 | 
  40 | for (const fx of fixtures) {
  41 |   for (const win of windows) {
  42 |     test(`glance stack ${fx} flow ${win} @440`, async ({ page }) => {
  43 |       await page.setViewportSize({ width: 440, height: 956 });
> 44 |       await page.goto(`${base}?fixture=${fx}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
     |                  ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:3000/dev/active-trader?fixture=spx
  45 |       await page.waitForSelector("[data-at-glance-flow='live']", { timeout: 60_000 });
  46 |       await page.locator(`[data-at-glance-flow-seg="${win}"]`).click();
  47 |       await expect(page.locator("[data-at-glance-flow-window]")).toHaveAttribute("data-at-glance-flow-window", win);
  48 |       const m = await page.evaluate(overlapCheck);
  49 |       expect(m.ok, JSON.stringify(m)).toBe(true);
  50 |       expect(m.glancePx).toBeLessThanOrEqual(110.5);
  51 |     });
  52 |   }
  53 | }
```