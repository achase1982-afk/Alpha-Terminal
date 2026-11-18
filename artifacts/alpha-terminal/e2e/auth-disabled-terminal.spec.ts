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