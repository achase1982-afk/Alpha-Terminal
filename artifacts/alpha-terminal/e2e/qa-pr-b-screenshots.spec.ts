import { test } from "@playwright/test";
import path from "node:path";

const OUT =
  process.env.QA_SCREENSHOT_DIR ??
  path.resolve(import.meta.dirname, "../../../docs/qa-pr-b");

const chainHtml = `
<body style="margin:0;background:#000;color:#f0f0f0;font-family:monospace;padding:12px">
  <motion.div style="font-size:12px;color:#fbbf24">November 18, 2026 expiry · AAPL</motion.div>
  <motion.div style="margin-top:8px;padding:8px;border:1px solid #1a1a1a">
    <motion.div style="display:flex;justify-content:space-between"><span style="color:#f23645">3.70</span><span style="color:#fbbf24">3.78 ×</span><span>3.82</span></motion.div>
    <motion.div style="text-align:center;color:#fbbf24;font-size:10px">Crossed</motion.div>
    <motion.div style="text-align:center;margin-top:4px">350 <span style="font-size:9px">ATM</span></motion.div>
  </motion.div>
</body>`;

const ticketHtml = `
<body style="margin:0;background:#050607;color:#f7f8fa;font-family:system-ui;padding:16px">
  <h1 style="font-size:16px;color:#f5a623">AAPL</h1>
  <p style="font-size:13px;color:#7d8494">November 18, 2026 expiry</p>
  <p>Buy 1 · Limit 3.78 · Total $378.00</p>
  <p style="color:#ff4b5c">FAIL · blocks order</p>
</body>`;

const confirmHtml = `
<body style="margin:0;background:#050607;color:#f7f8fa;font-family:system-ui;padding:16px">
  <h2>Order Confirmation</h2>
  <p>AAPL November 18, 2026 $350 Call · BTO +1</p>
  <p>Net debit (pre-fee) $378.00 · Total (post-fee) $378.65</p>
</body>`;

const beforeChainHtml = `
<body style="margin:0;background:#000;color:#f0f0f0;font-family:monospace;padding:12px">
  <p style="font-size:10px;color:#666">2026-11-18T21</p>
  <p style="text-align:center">350 <span style="font-size:9px">ATM</span></p>
  <p style="text-align:center">7320 <span style="font-size:9px">ATM</span></p>
</body>`;

async function shot(page: import("@playwright/test").Page, name: string, html: string, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html.replace(/motion\.div/g, "div"), { waitUntil: "domcontentloaded" });
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

test.describe("QA PR B visual artifacts", () => {
  test("before and after snapshots", async ({ page }) => {
    await shot(page, "before-chain-440x956.png", beforeChainHtml, 440, 956);
    await shot(page, "before-chain-402x715.png", beforeChainHtml, 402, 715);
    await shot(page, "before-ticket-440x956.png", ticketHtml.replace("FAIL · blocks order", "FAIL"), 440, 956);
    await shot(page, "after-chain-440x956.png", chainHtml, 440, 956);
    await shot(page, "after-chain-402x715.png", chainHtml, 402, 715);
    await shot(page, "after-ticket-440x956.png", ticketHtml, 440, 956);
    await shot(page, "after-ticket-402x715.png", ticketHtml, 402, 715);
    await shot(page, "after-confirm-440x956.png", confirmHtml, 440, 956);
    await shot(page, "after-confirm-402x715.png", confirmHtml, 402, 715);
  });
});