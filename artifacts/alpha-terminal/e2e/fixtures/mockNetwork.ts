import type { Page } from "@playwright/test";
import type { OptionChainResponse } from "@workspace/api-client-react";
import {
  buildSpx0DteChain,
  SPX_5910_CALL_SYMBOL,
  SPX_ATM_CALL_SYMBOL,
  streamKeysFromChain,
} from "./spxChain.js";

const CHAIN = buildSpx0DteChain();
const OPTION_KEYS = streamKeysFromChain(CHAIN);

export const QA_ACCOUNT_HASH = "qa-hash-1";

const MOCK_ACCOUNT = {
  hashValue: QA_ACCOUNT_HASH,
  accountNumber: "···1234",
  type: "MARGIN",
  balances: {
    buyingPower: 12_500,
    liquidationValue: 30_000,
    cashBalance: 8_000,
    equity: 30_000,
  },
};

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

export type QaMockScenario = "default" | "fail" | "option-header" | "debit-vertical";

export async function installQaNetworkMocks(
  page: Page,
  opts?: { symbol?: string; aaplStock?: boolean; scenario?: QaMockScenario },
) {
  const symbol = opts?.symbol ?? "SPX";
  const scenario = opts?.scenario ?? "default";

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (!url.includes("/api/")) {
      await route.continue();
      return;
    }

    if (url.includes("/api/market/options") || url.includes("optionchain")) {
      await route.fulfill(json({ ...CHAIN, symbol }));
      return;
    }

    if (url.includes("/api/market/quote") || url.includes("/quotes")) {
      if (opts?.aaplStock) {
        await route.fulfill(
          json({
            symbol: "AAPL",
            last: 187.42,
            bid: 187.41,
            ask: 187.43,
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
            ? [{ symbol: "AAPL", last: 187.421, bid: 187.41, ask: 187.43 }]
            : [{ symbol: "SPX", last: 5900.5, bid: 5900.25, ask: 5900.75 }],
        }),
      );
      return;
    }

    if (url.includes("/api/market/earnings-date")) {
      await route.fulfill(json({ earningsDate: null }));
      return;
    }

    if (url.includes("/api/portfolio/accounts") || url.includes("/portfolio/accounts")) {
      await route.fulfill(json([MOCK_ACCOUNT]));
      return;
    }

    if (url.includes("/api/portfolio") || url.includes("/api/schwab")) {
      await route.fulfill(json([MOCK_ACCOUNT]));
      return;
    }

    await route.fulfill(json({}));
  });

  await page.routeWebSocket(/\/api\/ws\/prices/, (ws) => {
    const pushOptionTicks = () => {
      const now = Date.now();
      for (const key of OPTION_KEYS) {
        const call = CHAIN.calls.find((c) => (c as { schwabSymbol?: string }).schwabSymbol === key);
        let bid = call?.bid ?? 1.1;
        let ask = call?.ask ?? 1.2;
        let last = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask;
        if (key === SPX_ATM_CALL_SYMBOL && scenario === "option-header") {
          bid = 3.76;
          ask = 3.8;
          last = 3.78;
        }
        if (key === SPX_ATM_CALL_SYMBOL && scenario === "debit-vertical") {
          bid = 3.76;
          ask = 3.8;
          last = 3.78;
        }
        if (key === SPX_5910_CALL_SYMBOL && (scenario === "debit-vertical" || scenario === "option-header")) {
          bid = 1.2;
          ask = 1.25;
          last = 1.22;
        }
        if (key === SPX_ATM_CALL_SYMBOL && scenario === "fail") {
          bid = 3.8;
          ask = 3.2;
          last = 3.5;
        }
        ws.send(
          JSON.stringify({
            event: "optionQuote",
            data: {
              key,
              bid: bid ?? null,
              ask: ask ?? null,
              last,
              delta: call?.delta ?? 0.5,
              ts: now,
            },
          }),
        );
      }
    };

    ws.onMessage(() => {
      pushSnapshot();
      pushOptionTicks();
    });
    const pushSnapshot = () => {
      ws.send(
        JSON.stringify({
          event: "snapshot",
          data: {
            status: "connected",
            quotes: opts?.aaplStock
              ? [{ symbol: "AAPL", last: 187.421, bid: 187.41, ask: 187.43 }]
              : [{ symbol: "SPX", last: 5900.5, bid: 5900.25, ask: 5900.75 }],
          },
        }),
      );
      const portfolioPayload = {
        event: "portfolio",
        data: {
          accounts: [MOCK_ACCOUNT],
          orders: [],
          status: "connected",
        },
      };
      ws.send(JSON.stringify(portfolioPayload));
      ws.send(JSON.stringify({ event: "streamerStatus", data: { status: "connected" } }));
    };
    pushSnapshot();
    pushOptionTicks();
  });
}

export function getChainFixture(): OptionChainResponse {
  return CHAIN;
}