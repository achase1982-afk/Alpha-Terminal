import { webkit, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const LIVE = process.env.AT_VERIFY_LIVE ?? "https://alpha-terminal-production-f297.up.railway.app";
const OUT = process.env.AT_VERIFY_OUT ?? "/cursor/stores/self/live-at-c4";
const IPHONE = devices["iPhone 14 Pro Max"];
const PREFS_KEY = "activeTraderPrefs:v6";

const checks = [];
function record(name, pass, detail) {
  checks.push({ name, pass, detail });
}

/** @typedef {"sequence" | "oco"} C4TemplateCase */

const INDEX_DEFAULTS = {
  template: "TRG w/ bracket",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 10 },
  stopLoss: { enabled: false, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
  ladderMode: "single",
  verticalWidth: 5,
  exitDuration: "GOOD_TILL_CANCEL",
  stopLossOrderType: "STOP",
  stopLimitOffset: 0.05,
};

/** @type {Record<C4TemplateCase, object>} */
const TEMPLATE_PREFS = {
  sequence: {
    template: "TRG w/ bracket",
    takeProfit: { enabled: true, mode: "percent", offset: 10 },
    stopLoss: { enabled: false, mode: "percent", offset: -10 },
  },
  oco: {
    template: "OCO",
    takeProfit: { enabled: true, mode: "percent", offset: 10 },
    stopLoss: { enabled: true, mode: "percent", offset: -10 },
  },
};

await mkdir(OUT, { recursive: true });

const browser = await webkit.launch();
const context = await browser.newContext({
  ...IPHONE,
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();
let placeOrderPosts = 0;
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/api/portfolio/place-order")) placeOrderPosts += 1;
});

await page.addInitScript(() => {
  localStorage.setItem(
    "alpha-terminal-storage",
    JSON.stringify({ state: { symbol: "$SPX" }, version: 35 }),
  );
});

async function applyTemplatePrefs(templateCase) {
  const overlay = TEMPLATE_PREFS[templateCase];
  const indexPrefs = {
    ...INDEX_DEFAULTS,
    ...overlay,
    takeProfit: { ...INDEX_DEFAULTS.takeProfit, ...overlay.takeProfit },
    stopLoss: { ...INDEX_DEFAULTS.stopLoss, ...overlay.stopLoss },
    autoSend: { ...INDEX_DEFAULTS.autoSend, armed: false },
  };
  const origin = new URL(LIVE).origin;
  if (!page.url().startsWith(origin)) {
    await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  }
  await page.evaluate(
    ({ key, indexPrefs: prefs }) => {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.index = prefs;
      localStorage.setItem(key, JSON.stringify(parsed));
    },
    { key: PREFS_KEY, indexPrefs },
  );
}

async function openAt(height) {
  await page.setViewportSize({ width: 440, height });
  await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click({ timeout: 60_000 });
  const viewSel = page.getByLabel("Options view");
  if ((await viewSel.count()) > 0) {
    await viewSel.selectOption("at");
  } else {
    await page.getByRole("button", { name: "Active Trader", exact: true }).click({ timeout: 90_000 });
  }
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, {
    timeout: 90_000,
  });
}

async function atmAskSelector() {
  return page.evaluate(() => {
    const spot = [...document.querySelectorAll("[data-at-strike]")].find((n) => {
      const bg = getComputedStyle(n).backgroundColor;
      return bg.includes("251") || bg.includes("rgb(251");
    });
    const strike = spot?.getAttribute("data-at-strike");
    return strike ? `[data-at-quote="call-ask-${strike}"]` : null;
  });
}

/** @returns {Promise<{ positionEffect: string; orderKind: string; isParent: boolean }[] | null>} */
async function readConfirmRows() {
  const confirm = page.getByTestId("at-trigger-confirm");
  if ((await confirm.count()) === 0) return null;
  return confirm.evaluate((root) => {
    const rows = [...root.querySelectorAll('[data-testid="at-trigger-confirm-row"]')];
    return rows.map((el) => ({
      positionEffect: el.getAttribute("data-position-effect") ?? "",
      orderKind: el.getAttribute("data-order-kind") ?? "",
      isParent: el.getAttribute("data-order-parent") === "true",
    }));
  });
}

function validateRows(templateCase, rows) {
  if (!rows || rows.length === 0) return "no trigger confirm rows";
  const parents = rows.filter((r) => r.isParent && r.positionEffect === "TO OPEN");
  if (parents.length !== 1) return `expected 1 parent OPEN, got ${parents.length}`;

  if (templateCase === "sequence") {
    if (rows.length !== 2) return `Sequence: expected 2 rows, got ${rows.length}`;
    const closeLimits = rows.filter(
      (r) => !r.isParent && r.positionEffect === "TO CLOSE" && r.orderKind === "LIMIT",
    );
    if (closeLimits.length !== 1) return `Sequence: expected 1 LIMIT close child, got ${closeLimits.length}`;
    return null;
  }

  if (rows.length !== 3) return `OCO: expected 3 rows, got ${rows.length}`;
  const closeLimits = rows.filter(
    (r) => !r.isParent && r.positionEffect === "TO CLOSE" && r.orderKind === "LIMIT",
  );
  const closeStops = rows.filter(
    (r) => !r.isParent && r.positionEffect === "TO CLOSE" && r.orderKind === "STOP",
  );
  if (closeLimits.length !== 1 || closeStops.length !== 1) {
    return `OCO: expected 1 LIMIT + 1 STOP close (LMT=${closeLimits.length} STP=${closeStops.length})`;
  }
  return null;
}

/**
 * @param {C4TemplateCase} templateCase
 * @param {number} height
 */
async function runCase(templateCase, height) {
  placeOrderPosts = 0;
  const tag = `${templateCase}@${height}px`;

  await applyTemplatePrefs(templateCase);
  await openAt(height);

  const askSel = await atmAskSelector();
  if (!askSel) {
    record(`ATM ask (${tag})`, false, "no selector");
    process.exitCode = 1;
    return;
  }
  await page.locator(askSel).click({ timeout: 15_000 });
  await page
    .waitForSelector("[data-at-mobile-peek], [data-at-sheet-detent='peek']", { timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);

  const tpCheckbox = page.locator('[data-at-mobile-peek] input[type="checkbox"]').first();
  if ((await tpCheckbox.count()) > 0 && !(await tpCheckbox.isChecked())) {
    await tpCheckbox.check().catch(() => undefined);
  }

  const mobileReview = page.getByTestId("at-mobile-review");
  const chainReview = page.getByTestId("chain-sheet-review");
  if ((await mobileReview.count()) > 0) {
    await mobileReview.waitFor({ state: "visible", timeout: 12_000 });
    await mobileReview.click();
  } else if ((await chainReview.count()) > 0) {
    record(`Review CTA (${tag})`, false, "mobile peek missing; chain sheet path not asserted for AT templates");
    process.exitCode = 1;
    return;
  } else {
    const peekText = await page.locator("[data-at-mobile-peek]").innerText().catch(() => "");
    record(`Review CTA (${tag})`, false, peekText.slice(0, 120) || "at-mobile-review missing");
    process.exitCode = 1;
    await page.screenshot({ path: path.join(OUT, `live-at-c4-${templateCase}-${height}px-fail.png`) });
    return;
  }

  await page.waitForSelector("[data-at-sheet-detent='confirm'], [data-order-ticket-sheet]", { timeout: 15_000 });
  await page.waitForTimeout(400);

  const confirmRoot = page.getByTestId("at-trigger-confirm");
  const hasConfirm = (await confirmRoot.count()) > 0;
  record(`Review trigger summary (${tag})`, hasConfirm, hasConfirm ? "scoped confirm" : "missing at-trigger-confirm");

  const rows = await readConfirmRows();
  const rowErr = validateRows(templateCase, rows);
  record(`Leg rows (${tag})`, rowErr == null, rowErr ?? `rows=${rows?.length ?? 0}`);

  if (templateCase === "oco") {
    const ocoNote = hasConfirm
      ? await confirmRoot.evaluate((root) => /one cancels other \(OCO\)/i.test(root.innerText))
      : false;
    record(`OCO pair note (${tag})`, ocoNote, ocoNote ? "present" : "missing");
  }

  const sendBtn = page.getByTestId("at-mobile-send-preview");
  const sendVisible = (await sendBtn.count()) > 0;
  const sendDisabled = sendVisible ? await sendBtn.isDisabled() : false;
  record(
    `Send disabled (${tag})`,
    sendVisible && sendDisabled,
    sendVisible ? `disabled=${sendDisabled}` : "no preview send",
  );

  if (!hasConfirm) {
    record(`hard-fail scope (${tag})`, false, "confirm not in review panel");
    process.exitCode = 1;
  }

  record(`zero place-order POST (${tag})`, placeOrderPosts === 0, `count=${placeOrderPosts}`);
  if (placeOrderPosts > 0) process.exitCode = 1;
  if (rowErr) process.exitCode = 1;

  await page.screenshot({
    path: path.join(OUT, `live-at-c4-${templateCase}-${height}px.png`),
    fullPage: false,
  });
}

try {
  for (const templateCase of /** @type {const} */ (["sequence", "oco"])) {
    for (const height of [956, 658]) {
      await runCase(templateCase, height);
    }
  }
} catch (err) {
  record("c4 capture", false, err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

await writeFile(
  path.join(OUT, "live-at-c4-report.json"),
  JSON.stringify({ checks, live: LIVE, out: OUT, templates: Object.keys(TEMPLATE_PREFS) }, null, 2),
);
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);