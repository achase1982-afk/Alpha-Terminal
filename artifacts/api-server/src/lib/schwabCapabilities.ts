export type SchwabHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type SchwabRestApp = "app1" | "app2";
export type SchwabStreamerCommand = "SUBS" | "ADD" | "UNSUBS" | "VIEW";

export const SCHWAB_HTTP_METHODS: readonly SchwabHttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

export const SCHWAB_REST_NAMESPACES = [
  {
    prefix: "/marketdata/v1/",
    product: "Market Data Production",
    defaultApp: "app2",
    operations: [
      "batch and single-symbol quotes",
      "option chains",
      "option expiration chains",
      "price history",
      "movers",
      "single and multi-market hours",
      "instrument search",
      "CUSIP instrument lookup",
    ],
  },
  {
    prefix: "/trader/v1/",
    product: "Accounts and Trading Production",
    defaultApp: "app1",
    operations: [
      "account-number hashes",
      "all and single account balances and positions",
      "account and all-linked-account orders",
      "order placement",
      "order preview",
      "order detail",
      "order replacement",
      "order cancellation",
      "transaction lists and transaction detail",
      "user preferences",
    ],
  },
] as const;

export const SCHWAB_STREAMER_SERVICES = [
  "LEVELONE_EQUITIES",
  "LEVELONE_OPTIONS",
  "LEVELONE_FUTURES",
  "LEVELONE_FUTURES_OPTIONS",
  "LEVELONE_FOREX",
  "NYSE_BOOK",
  "NASDAQ_BOOK",
  "OPTIONS_BOOK",
  "CHART_EQUITY",
  "CHART_FUTURES",
  "SCREENER_EQUITY",
  "SCREENER_OPTION",
  "ACCT_ACTIVITY",
  "TIMESALE_EQUITY",
  "TIMESALE_FUTURES",
  "TIMESALE_OPTIONS",
] as const;

export type SchwabStreamerService = (typeof SCHWAB_STREAMER_SERVICES)[number];

export const SCHWAB_STREAMER_COMMANDS: readonly SchwabStreamerCommand[] = [
  "SUBS",
  "ADD",
  "UNSUBS",
  "VIEW",
];

export class SchwabCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchwabCapabilityError";
  }
}

export function parseSchwabHttpMethod(value: unknown): SchwabHttpMethod {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!SCHWAB_HTTP_METHODS.includes(method as SchwabHttpMethod)) {
    throw new SchwabCapabilityError("unsupported_schwab_method");
  }
  return method as SchwabHttpMethod;
}

export function validateSchwabRestPath(value: unknown): {
  path: string;
  product: (typeof SCHWAB_REST_NAMESPACES)[number];
} {
  if (typeof value !== "string") {
    throw new SchwabCapabilityError("invalid_schwab_path");
  }
  const path = value.trim();
  if (
    path.length === 0 ||
    path.length > 300 ||
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new SchwabCapabilityError("invalid_schwab_path");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new SchwabCapabilityError("invalid_schwab_path");
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new SchwabCapabilityError("invalid_schwab_path");
  }
  const product = SCHWAB_REST_NAMESPACES.find(({ prefix }) => path.startsWith(prefix));
  if (!product) {
    throw new SchwabCapabilityError("schwab_path_not_entitled_namespace");
  }
  return { path, product };
}

export function normalizeSchwabStringRecord(
  value: unknown,
  errorCode: string,
): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SchwabCapabilityError(errorCode);
  }
  const record = Object.create(null) as Record<string, string>;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || raw == null) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      record[key] = String(raw);
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
      record[key] = raw.map(String).join(",");
      continue;
    }
    throw new SchwabCapabilityError(`${errorCode}:${key}`);
  }
  return record;
}

export function parseSchwabRestApp(
  value: unknown,
  defaultApp: SchwabRestApp,
): SchwabRestApp {
  if (value == null || value === "") return defaultApp;
  if (value === "app1" || value === "app2") return value;
  throw new SchwabCapabilityError("invalid_schwab_app");
}

export function parseSchwabStreamerService(value: unknown): SchwabStreamerService {
  if (
    typeof value !== "string" ||
    !SCHWAB_STREAMER_SERVICES.includes(value as SchwabStreamerService)
  ) {
    throw new SchwabCapabilityError("unsupported_schwab_streamer_service");
  }
  return value as SchwabStreamerService;
}

export function parseSchwabStreamerCommand(value: unknown): SchwabStreamerCommand {
  const command = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!SCHWAB_STREAMER_COMMANDS.includes(command as SchwabStreamerCommand)) {
    throw new SchwabCapabilityError("unsupported_schwab_streamer_command");
  }
  return command as SchwabStreamerCommand;
}
