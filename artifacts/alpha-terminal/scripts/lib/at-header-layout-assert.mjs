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
  const gridCount = await grid.count();
  const headerW = headerBox?.width ?? 0;
  let gridW = 0;
  if (gridCount === 0) {
    record("grid width >= 80% header", true, "grid hidden");
    record("grid cells no overlap", true, "n/a");
    record("grid no crushed wrap", true, "n/a");
  } else {
  const gridBox = await grid.boundingBox();
  gridW = gridBox?.width ?? 0;
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
      if (r.height > 18) return true;
      if (c.scrollWidth > c.clientWidth + 2) return true;
    }
    return false;
  });
  record("grid no crushed wrap", !wrapBad, wrapBad ? "bad" : "ok");
  }

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

  const headerTextOverlap = await header.evaluate((root) => {
    const eps = 0.5;
    const leaves = [...root.querySelectorAll("*")].filter((n) => {
      if (n.children.length > 0) return false;
      const t = (n.textContent ?? "").trim();
      if (t.length === 0) return false;
      const r = n.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    });
    const boxes = leaves.map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, el: n };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > eps && oy > eps) return true;
      }
    }
    return false;
  });
  record("header text nodes no overlap", !headerTextOverlap, headerTextOverlap ? "intersect" : "ok");

  const wallOneLine = await page
    .locator('[data-at-flow-wall="calls"]')
    .evaluate((el) => el.getBoundingClientRect().height <= 18)
    .catch(() => false);
  record("wall labels single-line", wallOneLine, wallOneLine ? "ok" : "stacked");

  const noClip = await header.evaluate((root) => {
    const headerRight = root.getBoundingClientRect().right;
    const maxRight = headerRight - 8;
    const leaves = [...root.querySelectorAll("*")].filter((n) => {
      if (n.children.length > 0) return false;
      const t = (n.textContent ?? "").trim();
      if (t.length === 0) return false;
      const r = n.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    });
    for (const n of leaves) {
      const r = n.getBoundingClientRect();
      if (r.right > maxRight + 0.5) return false;
      const el = /** @type {HTMLElement} */ (n);
      if (el.scrollWidth > el.clientWidth + 1) return false;
    }
    return true;
  });
  record("header text in safe area", noClip, noClip ? "ok" : "clipped");

  const flowMath = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-at-gross-flow-row]")];
    let maxDelta = 0;
    for (const row of rows) {
      const soldAttr = row.getAttribute("data-at-flow-gross-sold-usd");
      const buyAttr = row.getAttribute("data-at-flow-gross-bought-usd");
      if (!soldAttr || !buyAttr) continue;
      const soldUsd = Number(soldAttr);
      const buyUsd = Number(buyAttr);
      if (!Number.isFinite(soldUsd) || !Number.isFinite(buyUsd)) continue;
      const text = (row.textContent ?? "").replace(/\s+/g, " ");
      const soldM = text.match(/Sold \$?([\d,.]+[KMB]?)/i);
      const buyM = text.match(/Bought \$?([\d,.]+[KMB]?)/i);
      const parseCompact = (raw) => {
        const t = raw.replace(/,/g, "");
        const m = t.match(/^([\d.]+)([KMB])?$/i);
        if (!m) return NaN;
        const n = Number(m[1]);
        const suf = (m[2] ?? "").toUpperCase();
        const scale = suf === "K" ? 1e3 : suf === "M" ? 1e6 : suf === "B" ? 1e9 : 1;
        return n * scale;
      };
      const soldShown = soldM ? parseCompact(soldM[1]) : NaN;
      const buyShown = buyM ? parseCompact(buyM[1]) : NaN;
      if (Number.isFinite(soldShown)) maxDelta = Math.max(maxDelta, Math.abs(soldUsd - soldShown));
      if (Number.isFinite(buyShown)) maxDelta = Math.max(maxDelta, Math.abs(buyUsd - buyShown));
    }
    return { maxDelta, rows: rows.length };
  });
  record(
    "top flow math diff zero",
    flowMath.rows === 0 || flowMath.maxDelta < 1.5,
    flowMath.rows ? `Δ${flowMath.maxDelta.toFixed(3)}` : "no rows",
  );
}