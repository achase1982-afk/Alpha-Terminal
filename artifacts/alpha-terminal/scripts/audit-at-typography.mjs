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
  "## 1:1 mapping (AT → app source)",
  "",
  "| AT surface | Token / component | Chain or app reference |",
  "| --- | --- | --- |",
  "| Settings summary | `AtSettingsPanel` summary button | `ExpirationSection` (`chain-exp-btn`) — 13px → 11px multiline, MONO, `FW_NORMAL` |",
  "| Expiry + flow window | Panel expanded header row | Chain toolbar strike `SelectTrigger` — 14px, `#111` / `#2a2a2a` |",
  "| Template selects | `TemplateBar` | Chain toolbar `SelectTrigger` |",
  "| SESSION REGIME label | `RegimeStrip` | Chain column labels — 10px, `0.08em`, uppercase, `DIM` |",
  "| Regime value | `RegimeStrip` | Chain expiration stats — 12px, `WHITE` / `FW_NORMAL` |",
  "| Wall / GEX grid | `RegimeStrip` | Chain strike row metadata — 10px labels, 12px values, tabular-nums |",
  "| Filter chips | `FilterStrip` | Options chain pill chips — 10px, bordered, MONO |",
  "| Trigger leg plan | `AtTemplateLegPlan` | Order ticket leg rows — 11px MONO |",
  "| Trigger confirm block | `TriggerOrderConfirmSummary` | Order ticket review — 10/11/12px MONO, `DIM` labels |",
  "| Ladder PUT/CALL headers | `ActiveTraderView` subheader | `chain-calls-hdr` — 12px, 600, `0.08em` |",
  "| Ladder volume cells | `LadderBody` | `chain-bid-cell` — 12px, tabular-nums, `FW_LIGHT` |",
  "| Strike pill | `LadderBody` strike column | `chain-strike-cell` — 12px, `#000` on accent |",
  "| Flow bars | `LadderBody` `FlowBar` | AT-only; colors `optionsTheme.UP` / `DOWN` |",
  "",
  "## Color polish (research summary)",
  "",
  "| Pattern | Pro habit | Our token |",
  "| --- | --- | --- |",
  "| Put flow | Red/coral activity | `optionsTheme.DOWN` (`#f23645`) |",
  "| Call flow | Green activity | `optionsTheme.UP` (`#00d166`) |",
  "| Flow intensity | Thin gradient bars | 4px bar in 6px track, gradient cc→22 |",
  "| ATM row | Highlight band | `ITM_OCEAN` + inset accent ring |",
  "| Trade strip bid/ask | Bid red / ask green | `DOWN` SELL, `UP` BUY |",
  "",
].join("\n");

writeFileSync(OUT, md);
console.log("Wrote", OUT);