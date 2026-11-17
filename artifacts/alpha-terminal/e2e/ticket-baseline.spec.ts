import { test, expect, type Page } from "@playwright/test";

const base = process.env.TICKET_BASELINE_BASE_URL ?? "http://127.0.0.1:3000/dev/ticket-baseline";
const outDir = process.env.TICKET_BASELINE_ARTIFACT_DIR ?? "/opt/cursor/artifacts";

type Shot = {
  name: string;
  scene: string;
  kind: "order" | "chain";
  confirm?: boolean;
  scrollSteps?: number;
};

const shots: Shot[] = [
  { name: "ticket-stock-buy-aapl-440x956", scene: "stock-buy", kind: "order", scrollSteps: 3 },
  { name: "ticket-stock-buy-aapl-confirm-440x956", scene: "stock-buy-confirm", kind: "order", confirm: true },
  { name: "ticket-stock-sell-aapl-440x956", scene: "stock-sell", kind: "order", scrollSteps: 3 },
  { name: "ticket-option-bto-spy-call-440x956", scene: "option-bto", kind: "order", scrollSteps: 3 },
  { name: "ticket-option-bto-spy-call-confirm-440x956", scene: "option-bto-confirm", kind: "order", confirm: true },
  { name: "ticket-option-stc-spy-call-440x956", scene: "option-stc", kind: "order", scrollSteps: 3 },
  { name: "ticket-chain-spy-1leg-collapsed-440x956", scene: "chain-1-leg-collapsed", kind: "chain" },
  { name: "ticket-chain-spy-1leg-expanded-440x956", scene: "chain-1-leg-expanded", kind: "chain" },
  { name: "ticket-chain-spy-confirm-440x956", scene: "chain-confirm", kind: "chain", confirm: true },
];

async function waitForOrderTicket(page: Page) {
  const panel = page.locator(".fixed.inset-0.z-\\[210\\]");
  await expect(panel).toBeVisible({ timeout: 45_000 });
  const review = page.getByRole("button", { name: /^Review$/ });
  await expect(review).toBeVisible({ timeout: 15_000 });
  await expect(review).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(800);
}

async function captureOrderTicketScroll(page: Page, fileBase: string, scrollSteps: number) {
  const panel = page.locator(".fixed.inset-0.z-\\[210\\]");
  await expect(panel).toBeVisible();
  if (scrollSteps <= 1) {
    await panel.screenshot({ path: `${outDir}/${fileBase}.png` });
    return;
  }
  for (let i = 0; i < scrollSteps; i++) {
    await page.evaluate((step) => {
      const root = document.querySelector(".fixed.inset-0.z-\\[210\\]");
      const scroller = root?.querySelector('[style*="overflow"]') ?? root;
      if (scroller instanceof HTMLElement) {
        scroller.scrollTop = (scroller.scrollHeight / 3) * step;
      }
    }, i);
    await page.waitForTimeout(350);
    await panel.screenshot({ path: `${outDir}/${fileBase}-scroll${i + 1}-440x956.png` });
  }
}

async function openOrderReview(page: Page) {
  const review = page.getByRole("button", { name: /^Review$/ });
  await expect(review).toBeEnabled({ timeout: 20_000 });
  await review.click();
  await expect(page.getByRole("heading", { name: /order confirmation/i })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
}

test.describe("ticket baseline BEFORE screenshots", () => {
  test.use({ viewport: { width: 440, height: 956 } });

  for (const shot of shots) {
    test(shot.name, async ({ page }) => {
      await page.goto(`${base}?scene=${shot.scene}`, { waitUntil: "domcontentloaded" });

      if (shot.kind === "chain") {
        await expect(page.getByTestId("options-chain-order-sheet")).toBeVisible({ timeout: 45_000 });
        if (shot.confirm) {
          const confirm = page.getByTestId("chain-sheet-confirm");
          if (!(await confirm.isVisible().catch(() => false))) {
            await page.getByTestId("chain-sheet-review").click();
          }
          await expect(confirm).toBeVisible({ timeout: 15_000 });
        }
        await page.waitForTimeout(shot.confirm ? 1200 : 900);
        await page.screenshot({ path: `${outDir}/${shot.name}.png`, fullPage: false });
        return;
      }

      await waitForOrderTicket(page);
      if (shot.confirm) {
        await openOrderReview(page);
        await page.screenshot({ path: `${outDir}/${shot.name}.png`, fullPage: false });
        return;
      }

      if (shot.scrollSteps && shot.scrollSteps > 1) {
        await captureOrderTicketScroll(page, shot.name.replace(/-440x956$/, ""), shot.scrollSteps);
      } else {
        const panel = page.locator(".fixed.inset-0.z-\\[210\\]");
        await panel.screenshot({ path: `${outDir}/${shot.name}.png` });
      }
    });
  }
});