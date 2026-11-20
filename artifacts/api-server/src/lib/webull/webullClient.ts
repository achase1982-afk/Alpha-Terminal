import { logger } from "../logger.js";
import { webullApiHost, webullNonce, webullSignRequest, webullUtcTimestamp } from "./webullSign.js";
import { webullRateLimitWait } from "./webullRateLimit.js";
import {
  getWebullToken,
  isWebullTradingReady,
  webullAppKey,
  webullAppSecret,
  webullCredentialsConfigured,
} from "./webullTokenStore.js";

const BASE = `https://${webullApiHost()}`;

export type WebullMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function accountsPath(path: string): boolean {
  return path === "/trading/accounts/list";
}

export class WebullApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "WebullApiError";
  }
}

export async function webullSignedFetch<T = unknown>(opts: {
  method: WebullMethod;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Token-auth endpoints (trading). Omit for /auth/tokens/* */
  withAccessToken?: boolean;
  accessTokenOverride?: string;
}): Promise<T> {
  if (!webullCredentialsConfigured()) {
    throw new WebullApiError("webull_not_configured", 503, "");
  }
  const appKey = webullAppKey();
  const appSecret = webullAppSecret();
  await webullRateLimitWait(accountsPath(opts.path) ? "accounts" : "default");

  let accessToken = opts.accessTokenOverride ?? "";
  if (opts.withAccessToken) {
    const stored = await getWebullToken();
    if (!isWebullTradingReady(stored) && !opts.accessTokenOverride) {
      throw new WebullApiError("webull_token_not_ready", 401, "");
    }
    accessToken = opts.accessTokenOverride ?? stored!.accessToken;
  }

  const bodyString =
    opts.body != null ? JSON.stringify(opts.body) : null;
  return webullSignedFetchRaw<T>({
    method: opts.method,
    path: opts.path,
    query: opts.query,
    bodyString,
    appKey,
    appSecret,
    accessToken: opts.withAccessToken ? accessToken : undefined,
  });
}

async function webullSignedFetchRaw<T>(params: {
  method: WebullMethod;
  path: string;
  query?: Record<string, string>;
  bodyString: string | null;
  appKey: string;
  appSecret: string;
  accessToken?: string;
}): Promise<T> {
  const timestamp = webullUtcTimestamp();
  const nonce = webullNonce();
  const signature = webullSignRequest({
    method: params.method,
    path: params.path,
    query: params.query,
    bodyString: params.bodyString,
    appKey: params.appKey,
    appSecret: params.appSecret,
    timestamp,
    nonce,
  });

  const headers: Record<string, string> = {
    "x-app-key": params.appKey,
    "x-timestamp": timestamp,
    "x-signature": signature,
    "x-signature-algorithm": "HMAC-SHA1",
    "x-signature-version": "1.0",
    "x-signature-nonce": nonce,
    "x-version": "v3",
    Accept: "application/json",
  };
  if (params.accessToken) headers["x-access-token"] = params.accessToken;
  if (params.bodyString) headers["Content-Type"] = "application/json";

  const qs = params.query
    ? `?${new URLSearchParams(params.query).toString()}`
    : "";
  const url = `${BASE}${params.path}${qs}`;

  const res = await fetch(url, {
    method: params.method,
    headers,
    body: params.bodyString ?? undefined,
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    logger.warn(
      { path: params.path, status: res.status, body: text.slice(0, 400) },
      `Webull API error ${res.status} ${params.path}`,
    );
    throw new WebullApiError(`webull_${params.path}`, res.status, text);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

export async function webullCreateToken(): Promise<{
  token: string;
  expires_at: number;
  status: string;
}> {
  return webullSignedFetch({
    method: "POST",
    path: "/auth/tokens/create",
    withAccessToken: false,
  });
}

export async function webullCheckToken(token: string): Promise<{
  token: string;
  expires_at: number;
  status: string;
}> {
  return webullSignedFetch({
    method: "POST",
    path: "/auth/tokens/check",
    body: { token },
    withAccessToken: false,
  });
}