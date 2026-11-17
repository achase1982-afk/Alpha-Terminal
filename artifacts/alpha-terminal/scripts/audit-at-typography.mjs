import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = "/agent/repos/Alpha-Terminal";
const OUT = path.join(ROOT, "docs/active-trader/APP_TYPE_AUDIT.md");
const BASE = "http://127.0.0.1:3000/dev/active-trader";

async function probeStyle(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
      textTransform: s.textTransform,
      lineHeight: s.lineHeight,
      color: s.color,
      height: Math.round(r.height),
      padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
    };
  }, selector);
}

function row(name, app, at) {
  const cols = ["Property", "Chain / App", "Active Trader", "Match?"];
  const keys = Object.keys(app ?? at ?? {});
  const lines = [`### ${name}`, "", `| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`];
  for (const k of keys) {
    const a = app?.[k] ?? "—";
    const b = at?.[k] ?? "—";
    const ok = a === b ? "✓" : "**diff**";
    lines.push(`| ${k} | ${a} | ${b} | ${ok} |`);
  }
  return lines.join("\n");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 440, height: 956 } });

await page.goto(`${BASE}?scene=chain`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(2000);

const probes = {
  "Chain toolbar Strike label": '[data-ui-audit="chain-strike-label"]',
  "Chain subheader CALLS": '[data-ui-audit="chain-calls-hdr"]',
  "Chain subheader STRIKE": '[data-ui-audit="chain-strike-hdr"]',
  "Chain bid cell (sample)": '[data-ui-audit="chain-bid-cell"]',
  "Chain strike cell (sample)": '[data-ui-audit="chain-strike-cell"]',
  "Expiration row": '[data-ui-audit="chain-exp-btn"]',
  "MarketData tab OPTIONS": '[data-testid="market-tab-options"]',
  "Symbol price (main)": '[data-ui-audit="metrics-last"]',
};

const app = {};
for (const [label, sel] of Object.entries(probes)) {
  app[label] = await probeStyle(page, sel);
}

await page.goto(`${BASE}?scene=default`, { waitUntil: "networkidle", timeout: 90_000 });
await page.waitForTimeout(1500);

const atProbes = {
  "AT settings summary": "[data-at-settings-summary]",
  "AT ladder Puts header": '[data-ui-audit="at-puts-hdr"]',
  "AT ladder strike cell": '[data-at-call-strike="7540"]',
  "AT puts volume cell": '[data-at-put-cell="7540"]',
};

const at = {};
for (const [label, sel] of Object.entries(atProbes)) {
  at[label] = await probeStyle(page, sel);
}

await browser.close();

mkdirSync(path.dirname(OUT), { recursive: true });

const md = [
  "# Active Trader typography audit",
  "",
  "Measured via Playwright `getComputedStyle` on the dev fixture route (real Terminal shell).",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Reference (Options chain + shell)",
  "",
  ...Object.entries(app).map(([name, style]) => (style ? row(name, style, null) : `### ${name}\n\n(not found)\n`)),
  "",
  "## Active Trader elements",
  "",
  ...Object.entries(at).map(([name, style]) => (style ? row(name, null, style) : `### ${name}\n\n(not found)\n`)),
  "",
  "## Mapping rules",
  "",
  "| AT element | Must match |",
  "| --- | --- |",
  "| Settings summary row | Expiration section header (`ExpirationSection` button) |",
  "| Ladder bid/ask volumes | Chain `PriceCell` primary span (12px, FW_LIGHT, tabular-nums) |",
  "| Strike column | Chain strike cell (12px, #000 on accent, tabular-nums) |",
  "| Column headers CALLS/PUTS | Chain `OptionsChainHeader` |",
  "| Section labels | Chain column top labels (10px, uppercase, 0.08em) |",
  "| Selects | Chain toolbar `SelectTrigger` (14px, #111 bg, #2a2a2a border) |",
  "",
].join("\n");

writeFileSync(OUT, md);
console.log("Wrote", OUT);