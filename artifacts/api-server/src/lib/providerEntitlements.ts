import { deskEnv } from "./desk/deskEnv.js";
import { deskTastytradeAccessToken } from "./desk/deskTastytrade.js";
import {
  EntitledGatewayError,
  type EntitledHttpMethod,
  normalizeEntitledQuery,
  validateEntitledPath,
} from "./entitledGateway.js";

export type EntitledProvider = "alpaca" | "tradier" | "tastytrade" | "unusual-whales";

/**
 * Prefixes are the only path gate. `products` names families so callers can
 * see them. An unlisted informational route under a prefix is still accepted.
 */
export const ENTITLED_PATH_GATE =
  "Every path under pathPrefixes is accepted. products is a catalog, not a block list.";

export const PROVIDER_CAPABILITIES = {
  alpaca: {
    hosts: ["https://api.alpaca.markets", "https://paper-api.alpaca.markets", "https://data.alpaca.markets"],
    pathPrefixes: ["/v1/", "/v1beta1/", "/v1beta3/", "/v2/", "/v3/"],
    pathGate: ENTITLED_PATH_GATE,
    products: [
      "accounts", "configuration", "activities", "portfolio-history", "assets",
      "orders", "positions", "options-exercise", "watchlists", "clock-calendar",
      "corporate-actions", "stocks", "quotes", "bars", "trades", "snapshots",
      "options", "crypto", "news", "screeners", "most-actives",
      "logos", "fixed-income", "locates", "wallets", "tokenization",
    ],
    streams: ["stocks", "options", "crypto", "news", "trade_updates"],
    targets: ["live", "paper", "market-data"],
  },
  tradier: {
    hosts: ["https://api.tradier.com", "https://sandbox.tradier.com", "https://stream.tradier.com"],
    pathPrefixes: ["/v1/"],
    pathGate: ENTITLED_PATH_GATE,
    products: [
      "profile", "accounts", "balances", "history", "gain-loss", "positions",
      "position-groups", "orders", "order-preview", "advanced-orders", "options",
      "quotes", "history-timesales", "etb", "clock-calendar", "search-lookup",
      "watchlists", "fundamentals", "dividends", "corporate-actions", "ratios",
      "financials", "statistics",
    ],
    streams: ["market", "account"],
    targets: ["production", "sandbox", "stream"],
  },
  tastytrade: {
    hosts: ["https://api.tastyworks.com"],
    pathPrefixes: ["/"],
    pathGate: ENTITLED_PATH_GATE,
    products: [
      "customers", "accounts", "balances", "positions", "transactions", "fees",
      "orders", "complex-orders", "order-dry-run", "instruments", "equities",
      "options", "futures", "future-options", "crypto", "market-sessions",
      "metrics", "watchlists", "trading-status", "net-liq", "margin", "risk",
      "alerts", "backtesting", "quote-tokens", "symbol-search", "option-chains",
    ],
    streams: ["dxlink", "account-streamer"],
    targets: ["production"],
  },
  "unusual-whales": {
    hosts: ["https://api.unusualwhales.com"],
    pathPrefixes: ["/api/"],
    pathGate: ENTITLED_PATH_GATE,
    products: [
      "futures", "gex-greeks", "alerts", "commodities", "companies", "congress",
      "crypto", "dark-pool", "earnings", "economy", "etfs", "flex", "forex",
      "institutions", "lit-flow", "market", "news", "option-contracts",
      "option-trades", "options-pulse", "politics", "portfolio", "predictions",
      "private-markets", "screeners", "seasonality", "sec", "shorts", "stocks",
      "volatility", "watchlists",
    ],
    streams: ["websocket", "kafka"],
    targets: ["production"],
  },
} as const;

type InvokeInput = {
  provider: EntitledProvider;
  target?: unknown;
  method: EntitledHttpMethod;
  path: unknown;
  query?: unknown;
  body?: unknown;
};

function required(value: string, error: string): string {
  if (!value) throw new EntitledGatewayError(error);
  return value;
}

function selectTarget(provider: EntitledProvider, target: unknown): { base: string; headers: Record<string, string> } {
  if (provider === "alpaca") {
    const selected = target == null ? "live" : String(target);
    const paper = selected === "paper";
    const key = required(
      paper
        ? deskEnv("ALPACA_PAPER_API_KEY_ID")
        : deskEnv("ALPACA_API_KEY_ID", "APCA_API_KEY_ID"),
      "alpaca_not_configured",
    );
    const secret = required(
      paper
        ? deskEnv("ALPACA_PAPER_API_SECRET_KEY")
        : deskEnv("ALPACA_API_SECRET_KEY", "APCA_API_SECRET_KEY"),
      "alpaca_not_configured",
    );
    const bases: Record<string, string> = {
      live: "https://api.alpaca.markets",
      paper: "https://paper-api.alpaca.markets",
      "market-data": "https://data.alpaca.markets",
    };
    const base = bases[selected];
    if (!base) throw new EntitledGatewayError("invalid_alpaca_target");
    return { base, headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret } };
  }
  if (provider === "tradier") {
    const selected = target == null ? "production" : String(target);
    if (selected !== "sandbox" && selected !== "production" && selected !== "stream") {
      throw new EntitledGatewayError("invalid_tradier_target");
    }
    const token = required(
      selected === "sandbox" ? deskEnv("TRADIER_SANDBOX_TOKEN") : deskEnv("TRADIER_API_KEY", "TRADIER_TOKEN"),
      selected === "sandbox" ? "tradier_sandbox_not_configured" : "tradier_not_configured",
    );
    const base =
      selected === "sandbox"
        ? "https://sandbox.tradier.com"
        : selected === "stream"
          ? "https://stream.tradier.com"
          : "https://api.tradier.com";
    return {
      base,
      headers: { Authorization: `Bearer ${token}` },
    };
  }
  if (provider === "unusual-whales") {
    const key = required(deskEnv("UW_API_KEY_NEW", "UW_API_KEY"), "unusual_whales_not_configured");
    return {
      base: "https://api.unusualwhales.com",
      headers: { Authorization: `Bearer ${key}`, "UW-CLIENT-API-ID": "100001" },
    };
  }
  throw new EntitledGatewayError("tastytrade_requires_async_token");
}

export async function invokeProviderEndpoint(input: InvokeInput): Promise<Response> {
  const capability = PROVIDER_CAPABILITIES[input.provider];
  const path = validateEntitledPath(input.path, capability.pathPrefixes);
  const query = normalizeEntitledQuery(input.query);
  let selected: { base: string; headers: Record<string, string> };
  if (input.provider === "tastytrade") {
    const token = required(await deskTastytradeAccessToken() ?? "", "tastytrade_not_configured");
    selected = {
      base: "https://api.tastyworks.com",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Alpha-Terminal/1.0",
        "Accept-Version": "20261012",
      },
    };
  } else {
    selected = selectTarget(input.provider, input.target);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const hasBody = !["GET", "DELETE"].includes(input.method) && input.body !== undefined;
  return fetch(`${selected.base}${path}${suffix}`, {
    method: input.method,
    headers: {
      ...selected.headers,
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? JSON.stringify(input.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
}
