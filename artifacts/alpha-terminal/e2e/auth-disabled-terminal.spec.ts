import { test, expect } from "@playwright/test";

const BASE = process.env.AUTH_DISABLED_E2E_BASE ?? "http://127.0.0.1:3000";

/**
 * Built bundle with VITE_AUTH_DISABLED=1 — no Clerk SignIn wall; terminal chrome loads.
 * Run via: `scripts/e2e-auth-disabled-terminal.sh`
 */
test.use({
  browserName: "webkit",
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});

test("auth-disabled built app loads terminal without login", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/health")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    if (url.includes("/api/auth/server-tokens") || url.includes("pending-session")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ found: false, market: null, trader: null }),
      });
    }
    if (url.includes("/api/dashboard-layout")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ layout: null }),
      });
    }
        if (url.includes("/api/watchlists")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ watchlists: [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await expect(page.locator(".cl-signIn-root, .cl-rootBox.cl-signIn-root")).toHaveCount(0, {
    timeout: 5_000,
  });
  await expect(page.getByText("MARKETS", { exact: true })).toBeVisible({ timeout: 45_000 });

  const ignorable = /favicon|Failed to load resource|websocket|interactive-widget|not recognized and ignored/i;
  const fatal = consoleErrors.filter((e) => !ignorable.test(e));
  expect(fatal).toEqual([]);
});

function minimalAaplChain() {
  const expiry = "2026-11-18";
  const mk = (strike: number, type: "C" | "P", bid: number, ask: number) => ({
    strike,
    expiration: expiry,
    bid,
    ask,
    schwabSymbol: `AAPL  251118${type}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
    delta: type === "C" ? 0.45 : -0.35,
    volume: 100,
  });
  const strikes = [362.5, 360, 357.5, 355, 352.5, 350, 347.5, 345, 342.5, 340, 337.5];
  const calls = strikes.map((s) => mk(s, "C", 1.2, 1.25));
  const puts = strikes.map((s) => mk(s, "P", 1.1, 1.15));
  return { symbol: "AAPL", underlyingPrice: 350.51, calls, puts };
}

test("auth-disabled with server-connected hydrates chain and active trader (mock API)", async ({ page }) => {
  test.setTimeout(120_000);
  const chain = minimalAaplChain();

  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/health")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    if (url.includes("market/options")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(chain),
      });
    }
    if (url.includes("/api/auth/server-tokens")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          market: { connected: true, expiresAt: Date.now() + 3_600_000 },
          trader: null,
        }),
      });
    }
    if (url.includes("/api/market/quote")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ symbol: "AAPL", last: 350.51, bid: 350.5, ask: 350.52 }),
      });
    }
    if (url.includes("pending-session")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ found: false }),
      });
    }
    if (url.includes("/api/dashboard-layout")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ layout: null }),
      });
    }
    if (url.includes("/api/watchlists")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ watchlists: [] }),
      });
    }
    if (url.includes("/api/stream/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"quotes":[]}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.addInitScript(() => {
    try {
      localStorage.removeItem("alpha-terminal-storage");
    } catch {
      /* ignore */
    }
  });

  const serverTokensWait = page.waitForResponse(
    (r) => r.url().includes("/api/auth/server-tokens") && r.status() === 200,
  );
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByText("MARKETS", { exact: true })).toBeVisible({ timeout: 45_000 });
  await serverTokensWait;

  const chainReq = page.waitForRequest((r) => r.url().includes("/api/market/options"));
  await page.getByRole("button", { name: "OPTIONS", exact: true }).click();
  await chainReq;
  await expect(page.getByText("CONNECT BROKERAGE TO VIEW OPTIONS")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("FAILED TO LOAD OPTIONS")).toHaveCount(0, { timeout: 20_000 });

  const subviewToggle = page.locator("[data-at-subview-toggle]");
  await expect(subviewToggle).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Active Trader", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Active Trader", exact: true }).click();
  await expect(page.locator("[data-at-root]")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("CONNECT BROKERAGE TO VIEW OPTIONS")).toHaveCount(0);
});