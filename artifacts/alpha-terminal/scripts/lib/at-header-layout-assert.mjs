/** Shared Playwright assertions for Anthony AT header layout. */
export function rectsOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

export async function assertAtHeaderLayout(page, record) {
  const header = page.locator("[data-at-glance-top]");
  const headerBox = await header.boundingBox();
  record("header height", (headerBox?.height ?? 0) > 0 && (headerBox?.height ?? 0) <= 200, `${headerBox?.height?.toFixed(1) ?? 0}px`);

  const dupSymbol = await page.locator("[data-at-symbol-header]").count();
  record("no duplicate at-symbol-header", dupSymbol === 0, String(dupSymbol));

  const grid = page.locator("[data-at-day-levels-grid]");
  const gridBox = await grid.boundingBox();
  const headerW = headerBox?.width ?? 0;
  const gridW = gridBox?.width ?? 0;
  record("grid width >= 80% header", gridW >= headerW * 0.8, `${gridW.toFixed(0)} / ${headerW.toFixed(0)}`);

  const pairs = [
    ["[data-at-day-low]", "[data-at-day-high]"],
    ["[data-at-low-zone-ref]", "[data-at-high-zone-ref]"],
    ["[data-at-day-low]", "[data-at-low-zone-ref]"],
    ["[data-at-day-high]", "[data-at-high-zone-ref]"],
  ];
  let overlap = false;
  for (const [leftSel, rightSel] of pairs) {
    const a = await grid.locator(leftSel).boundingBox();
    const b = await grid.locator(rightSel).boundingBox();
    if (!a || !b) continue;
  const eps = 0.25;
    const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (ox > eps && oy > eps) overlap = true;
  }
  record("grid cells no overlap", !overlap, overlap ? "intersect" : "ok");

  const wrapBad = await grid.evaluate((el) => {
    const cells = el.querySelectorAll("[data-at-day-low], [data-at-day-high], [data-at-low-zone-ref], [data-at-high-zone-ref]");
    for (const c of cells) {
      const r = c.getBoundingClientRect();
      if (r.height > 14) return true;
    }
    const words = el.querySelectorAll("span");
    for (const w of words) {
      if ((w.textContent ?? "").trim().length === 1 && w.getBoundingClientRect().height > 12) return true;
    }
    return false;
  });
  record("grid no crushed wrap", !wrapBad, wrapBad ? "bad" : "ok");

  const gaps = await header.evaluate((el) => {
    const kids = [...el.children].filter((n) => n.getBoundingClientRect().height > 0);
    let maxGap = 0;
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i].getBoundingClientRect();
      const b = kids[i + 1].getBoundingClientRect();
      const gap = b.top - a.bottom;
      if (gap > maxGap) maxGap = gap;
    }
    return maxGap;
  });
  record("header child gaps <= 16px", gaps <= 16, `${gaps.toFixed(1)}px`);

  const callWall = await page.locator('[data-at-flow-wall="calls"]').count();
  const putWall = await page.locator('[data-at-flow-wall="puts"]').count();
  record("call flow row + wall", callWall > 0, String(callWall));
  record("put flow row + wall", putWall > 0, String(putWall));
}