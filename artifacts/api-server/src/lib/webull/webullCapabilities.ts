import type { WebullMethod } from "./webullClient.js";

export const WEBULL_HTTP_METHODS: readonly WebullMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

export const WEBULL_HTTP_NAMESPACES = [
  {
    prefix: "/market-data/",
    product: "Market Data API",
    categories: [
      "stocks",
      "options",
      "futures",
      "crypto",
      "event contracts",
      "news",
      "community",
      "screeners",
      "watchlists",
      "fundamentals",
      "funds",
      "institutional and insider data",
      "economic calendars",
      "stream subscriptions",
    ],
  },
  {
    prefix: "/trading/",
    product: "Trading API",
    categories: [
      "accounts",
      "balances",
      "positions",
      "cash activities",
      "transfer activities",
      "instruments",
      "order preview",
      "order placement",
      "batch orders",
      "order replacement",
      "order cancellation",
      "open orders",
      "order history",
      "order detail",
    ],
  },
] as const;

export class WebullCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebullCapabilityError";
  }
}

export function parseWebullMethod(value: unknown): WebullMethod {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!WEBULL_HTTP_METHODS.includes(method as WebullMethod)) {
    throw new WebullCapabilityError("unsupported_webull_method");
  }
  return method as WebullMethod;
}

export function validateWebullEntitledPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new WebullCapabilityError("invalid_webull_path");
  }
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > 240 ||
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new WebullCapabilityError("invalid_webull_path");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new WebullCapabilityError("invalid_webull_path");
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new WebullCapabilityError("invalid_webull_path");
  }
  if (!WEBULL_HTTP_NAMESPACES.some(({ prefix }) => path.startsWith(prefix))) {
    throw new WebullCapabilityError("webull_path_not_entitled_namespace");
  }
  return path;
}

export function normalizeWebullQuery(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new WebullCapabilityError("invalid_webull_query");
  }

  const query = Object.create(null) as Record<string, string>;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || raw == null) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      query[key] = String(raw);
      continue;
    }
    if (
      Array.isArray(raw) &&
      raw.every((item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean"
      )
    ) {
      query[key] = raw.map(String).join(",");
      continue;
    }
    throw new WebullCapabilityError(`invalid_webull_query_value:${key}`);
  }
  return query;
}
