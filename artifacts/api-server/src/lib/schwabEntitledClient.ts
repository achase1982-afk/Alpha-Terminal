import type { SchwabHttpMethod, SchwabRestApp } from "./schwabCapabilities.js";
import { getValidAccessToken } from "./tokenStore.js";
import { deskSchwabRestFetch } from "./desk/deskSchwabRestCredential.js";

const SCHWAB_BASE = "https://api.schwabapi.com";

export interface SchwabEntitledFetchInput {
  method: SchwabHttpMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  app: SchwabRestApp;
}

export interface SchwabEntitledFetchResult {
  app: SchwabRestApp;
  fellBack: boolean;
  res: Response;
}

function requestInit(input: SchwabEntitledFetchInput): RequestInit {
  const bodyString = input.body == null ? undefined : JSON.stringify(input.body);
  return {
    method: input.method,
    headers: {
      Accept: "application/json",
      ...(bodyString ? { "Content-Type": "application/json" } : {}),
    },
    body: bodyString,
  };
}

export async function schwabEntitledFetch(
  input: SchwabEntitledFetchInput,
): Promise<SchwabEntitledFetchResult> {
  const query = input.query && Object.keys(input.query).length > 0
    ? `?${new URLSearchParams(input.query).toString()}`
    : "";
  const url = `${SCHWAB_BASE}${input.path}${query}`;
  const init = requestInit(input);

  if (input.path.startsWith("/marketdata/v1/")) {
    const result = await deskSchwabRestFetch(input.app, url, init);
    return { app: result.app, fellBack: result.fellBack, res: result.res };
  }

  if (input.app !== "app1") {
    return {
      app: "app1",
      fellBack: false,
      res: new Response(
        JSON.stringify({ error: "schwab_app2_market_data_only" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const token = getValidAccessToken("trader");
  if (!token) {
    return {
      app: "app1",
      fellBack: false,
      res: new Response(
        JSON.stringify({ error: "schwab_trader_not_connected" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  return { app: "app1", fellBack: false, res };
}
