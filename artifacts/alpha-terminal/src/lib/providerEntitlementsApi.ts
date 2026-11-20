import { fetchWithAuth, humanizeFailedApiBody } from "./fetchWithAuth";

export type EntitledProvider = "alpaca" | "tradier" | "tastytrade" | "unusual-whales";
export type EntitledHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AlpacaTarget = "live" | "paper" | "market-data";
export type TradierTarget = "production" | "sandbox";

type QueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | null
  | undefined;

export interface ProviderEndpointRequest {
  method?: EntitledHttpMethod;
  path: `/${string}`;
  query?: Record<string, QueryValue>;
  body?: unknown;
  target?: AlpacaTarget | TradierTarget | "production";
}

async function readResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) throw new Error(humanizeFailedApiBody(res.status, text));
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function getProviderCapabilities<T = unknown>(
  provider: EntitledProvider,
): Promise<T> {
  return readResponse<T>(await fetchWithAuth(`/api/providers/${provider}/capabilities`));
}

export async function invokeProviderEndpoint<T = unknown>(
  provider: EntitledProvider,
  request: ProviderEndpointRequest,
): Promise<T> {
  return readResponse<T>(await fetchWithAuth(`/api/providers/${provider}/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }));
}
