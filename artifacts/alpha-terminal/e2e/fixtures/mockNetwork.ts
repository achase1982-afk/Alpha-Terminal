import type { Page } from "@playwright/test";
import type { OptionChainResponse } from "@workspace/api-client-react";
import { buildSpx0DteChain, streamKeysFromChain } from "./spxChain.js";

const CHAIN = buildSpx0DteChain();
const OPTION_KEYS = streamKeysFromChain(CHAIN);

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

export async function installQaNetworkMocks(page: Page, opts?: { symbol?: string; aaplStock?: boolean }) {
  const symbol = opts?.symbol ?? "SPX";

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.includes("/api/")) {
      await route.continue();
      return;
    }

    if (url.includes("/api/market/options")) {
      await route.fulfill(json({ ...CHAIN, symbol }));
      return;
    }

    if (url.includes("/api/market/quote")) {
      if (opts?.aaplStock) {
        await route.fulfill(
          json({
            symbol: "AAPL",
            last: 187.42,
            bid: 187.4,
            ask: 187.44,
            change: 1.2,
            percentChange: 0.65,
          }),
        );
        return;
      }
      await route.fulfill(
        json({
          symbol: "SPX",
          last: 5900.5,
          bid: 5900.25,
          ask: 5900.75,
          change: 12.5,
          percentChange: 0.21,
        }),
      );
      return;
    }

    if (url.includes("/api/stream/start")) {
      await route.fulfill(json({ ok: true }));
      return;
    }

    if (url.includes("/api/stream/snapshot")) {
      await route.fulfill(
        json({
          status: "connected",
          quotes: opts?.aaplStock
            ? [{ symbol: "AAPL", last: 187.42, bid: 187.4, ask: 187.44 }]
            : [{ symbol: "SPX", last: 5900.5, bid: 5900.25, ask: 5900.75 }],
        }),
      );
      return;
    }

    if (url.includes("/api/market/earnings-date")) {
      await route.fulfill(json({ earningsDate: null }));
      return;
    }

    if (url.includes("/api/portfolio") || url.includes("/api/schwab")) {
      await route.fulfill(json([]));
      return;
    }

    await route.fulfill(json({}));
  });

  await page.routeWebSocket(/\/api\/ws\/prices/, (ws) => {
    ws.onMessage(() => {});
    const pushSnapshot = () => {
      ws.send(
        JSON.stringify({
          event: "snapshot",
          data: {
            status: "connected",
            quotes: opts?.aaplStock
              ? [{ symbol: "AAPL", last: 187.42, bid: 187.4, ask: 187.44 }]
              : [{ symbol: "SPX", last: 5900.5, bid: 5900.25, ask: 5900.75 }],
          },
        }),
      );
      ws.send(JSON.stringify({ event: "streamerStatus", data: { status: "connected" } }));
    };
    pushSnapshot();

    const now = Date.now();
    for (const key of OPTION_KEYS) {
      const call = CHAIN.calls.find((c) => (c as { schwabSymbol?: string }).schwabSymbol === key);
      const bid = call?.bid ?? 1.1;
      const ask = call?.ask ?? 1.2;
      ws.send(
        JSON.stringify({
          event: "optionQuote",
          data: {
            key,
            bid: bid ?? null,
            ask: ask ?? null,
            last: bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask,
            delta: call?.delta ?? 0.5,
            ts: now,
          },
        }),
      );
    }

    // Illiquid tick for FAIL banner shots (AAPL option or wide SPX wing).
    ws.send(
      JSON.stringify({
        event: "optionQuote",
        data: {
          key: "SPXW  261118C05900000",
          bid: 0.05,
          ask: 1.25,
          last: 0.4,
          delta: 0.52,
          ts: now + 1,
        },
      }),
    );
  });
}

export function getChainFixture(): OptionChainResponse {
  return CHAIN;
}