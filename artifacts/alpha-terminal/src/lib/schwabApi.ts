import { fetchWithAuth, humanizeFailedApiBody } from "./fetchWithAuth";

export type SchwabHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type SchwabRestApp = "app1" | "app2";
export type SchwabStreamerCommand = "SUBS" | "ADD" | "UNSUBS" | "VIEW";
export type SchwabStreamerService =
  | "LEVELONE_EQUITIES"
  | "LEVELONE_OPTIONS"
  | "LEVELONE_FUTURES"
  | "LEVELONE_FUTURES_OPTIONS"
  | "LEVELONE_FOREX"
  | "NYSE_BOOK"
  | "NASDAQ_BOOK"
  | "OPTIONS_BOOK"
  | "CHART_EQUITY"
  | "CHART_FUTURES"
  | "SCREENER_EQUITY"
  | "SCREENER_OPTION"
  | "ACCT_ACTIVITY"
  | "TIMESALE_EQUITY"
  | "TIMESALE_FUTURES"
  | "TIMESALE_OPTIONS";

type QueryValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | null
  | undefined;

export interface SchwabEndpointRequest {
  method?: SchwabHttpMethod;
  path: `/marketdata/v1/${string}` | `/trader/v1/${string}`;
  query?: Record<string, QueryValue>;
  body?: unknown;
  app?: SchwabRestApp;
}

export interface SchwabStreamerRequest {
  service: SchwabStreamerService;
  command?: SchwabStreamerCommand;
  parameters?: Record<string, QueryValue>;
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

export async function getSchwabCapabilities<T = unknown>(): Promise<T> {
  return readResponse<T>(await fetchWithAuth("/api/schwab/capabilities"));
}

export async function invokeSchwabEndpoint<T = unknown>(
  request: SchwabEndpointRequest,
): Promise<T> {
  return readResponse<T>(await fetchWithAuth("/api/schwab/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }));
}

export async function invokeSchwabStreamer(
  request: SchwabStreamerRequest,
): Promise<{ accepted: true; service: SchwabStreamerService; command: string; requestId: string }> {
  return readResponse(await fetchWithAuth("/api/schwab/stream/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }));
}
