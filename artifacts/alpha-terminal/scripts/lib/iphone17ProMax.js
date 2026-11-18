/** Anthony device: iPhone 17 Pro Max — CSS 440×956, DPR 3, safe-area ~62 top / ~34 bottom. */
export const IPHONE_17_PRO_MAX = {
  tag: "440x956@3x",
  width: 440,
  height: 956,
  deviceScaleFactor: 3,
  safeTop: 62,
  safeBottom: 34,
};

export const SECONDARY_VIEWPORT = { tag: "390x844", width: 390, height: 844, deviceScaleFactor: 2 };

export async function installSafeAreaInsets(page, top = 62, bottom = 34) {
  await page.addInitScript(
    ({ top: t, bottom: b }) => {
      const style = document.createElement("style");
      style.id = "playwright-safe-area";
      style.textContent = `
        :root { --pw-safe-top: ${t}px; --pw-safe-bottom: ${b}px; }
        body {
          padding-top: ${t}px !important;
          padding-bottom: ${b}px !important;
          box-sizing: border-box;
        }
        body * { box-sizing: border-box; }
      `;
      document.head.appendChild(style);
    },
    { top, bottom },
  );
}

/** DOM assert: glance must not paint over bracket row or ladder column headers. */
export function glanceStackOverlapScript() {
  return `(() => {
    const glance = document.querySelector("[data-at-glance-top]");
    if (!glance) return { ok: false, reason: "no_glance" };
    const g = glance.getBoundingClientRect();
    const selectors = [
      "[data-at-settings-summary]",
      '[data-ui-audit="at-puts-hdr"]',
      "[data-at-symbol-header]",
    ];
    let worstOverlap = 0;
    let nextTop = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      if (top < g.top + 2) continue;
      const overlap = g.bottom - top;
      if (overlap > worstOverlap) {
        worstOverlap = overlap;
        nextTop = Math.round(top);
      }
    }
    return {
      ok: worstOverlap <= 0.5,
      overlapPx: Math.round(worstOverlap),
      glancePx: Math.round(g.height),
      glanceBottom: Math.round(g.bottom),
      nextTop,
    };
  })()`;
}

export function layoutMetricsScript() {
  return `(() => {
    const r = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
    const b = (el) => (el ? Math.round(el.getBoundingClientRect().bottom) : 0);
    const t = (el) => (el ? Math.round(el.getBoundingClientRect().top) : 0);
    const glance = document.querySelector("[data-at-glance-top]");
    const header = document.querySelector("[data-at-symbol-header]");
    const sub = document.querySelector("[data-at-subview-chrome]");
    const ladder = document.querySelector("[data-at-ladder-scroll]");
    const sheet = document.querySelector("[data-order-ticket-sheet]");
    const backdrop = document.querySelector("[data-order-ticket-backdrop]");
    const nav = document.querySelector("[data-bottom-nav]");
    let visibleRows = 0;
    let selectedVisible = false;
  const selectedStrike = document.querySelector("[data-at-ladder-scroll]")?.getAttribute("data-selected-strike");
    if (ladder) {
      const floor = Math.max(b(glance), b(header));
      const ceil = sheet ? t(sheet) : window.innerHeight - (nav ? r(nav) : 56);
      for (const row of ladder.querySelectorAll("[data-at-strike]")) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > floor + 2 && rect.top < ceil - 2) visibleRows++;
        if (selectedStrike && row.getAttribute("data-at-strike") === selectedStrike && rect.bottom > floor && rect.top < ceil) {
          selectedVisible = true;
        }
      }
    }
    return {
      viewportH: window.innerHeight,
      safeTop: ${62},
      safeBottom: ${34},
      glancePx: r(glance),
      headerPx: r(header),
      subviewPx: r(sub),
      topChromePx: r(glance) + r(header) + r(sub),
      ladderPx: r(ladder),
      sheetPx: r(sheet),
      backdropVisible: !!backdrop,
      visibleLadderRows: visibleRows,
      selectedStrikeVisible: selectedVisible,
    };
  })()`;
}