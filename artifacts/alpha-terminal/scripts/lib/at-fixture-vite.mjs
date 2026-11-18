import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.dirname(fileURLToPath(import.meta.url)) + "/..";

export const AT_FIXTURE_BASE = "http://127.0.0.1:5173/dev/active-trader";

export async function ensureAtFixtureVite(extraEnv = {}) {
  const probe = `${AT_FIXTURE_BASE}?fixture=spx`;
  const ok = await fetch(probe).then((r) => r.ok).catch(() => false);
  if (ok) return null;
  const child = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: PKG,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      BROWSER: "none",
      VITE_DEV_BYPASS_AUTH: "true",
      VITE_AT_GLANCE_TOP: "1",
      ...extraEnv,
    },
  });
  child.unref();
  for (let i = 0; i < 90; i++) {
    if (await fetch(probe).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("vite fixture server timeout");
}

export async function waitForLiveLadder(page, timeoutMs = 120_000) {
  await page.waitForSelector("[data-at-ladder-scroll]", { timeout: timeoutMs });
  await page.waitForFunction(() => document.querySelectorAll("[data-at-strike]").length > 5, { timeout: timeoutMs });
  await page.waitForFunction(
    () => !document.querySelector("[data-at-ladder-skeleton]"),
    { timeout: timeoutMs },
  ).catch(() => undefined);
}