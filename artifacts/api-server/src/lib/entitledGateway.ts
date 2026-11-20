export const ENTITLED_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type EntitledHttpMethod = (typeof ENTITLED_HTTP_METHODS)[number];

export class EntitledGatewayError extends Error {}

export function parseEntitledMethod(value: unknown): EntitledHttpMethod {
  const method = String(value ?? "GET").toUpperCase();
  if (!ENTITLED_HTTP_METHODS.includes(method as EntitledHttpMethod)) {
    throw new EntitledGatewayError("unsupported_http_method");
  }
  return method as EntitledHttpMethod;
}

export function validateEntitledPath(value: unknown, prefixes: readonly string[]): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("://")) {
    throw new EntitledGatewayError("invalid_api_path");
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new EntitledGatewayError("invalid_api_path");
  }
  if (decoded.split("/").includes("..") || !prefixes.some((prefix) => decoded.startsWith(prefix))) {
    throw new EntitledGatewayError("api_path_not_allowed");
  }
  return value;
}

export function normalizeEntitledQuery(value: unknown): URLSearchParams {
  const params = new URLSearchParams();
  if (value == null) return params;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new EntitledGatewayError("invalid_api_query");
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const item of values) {
      if (!["string", "number", "boolean"].includes(typeof item)) {
        throw new EntitledGatewayError("invalid_api_query");
      }
      params.append(key, String(item));
    }
  }
  return params;
}

export async function forwardEntitledResponse(upstream: Response, res: {
  status(code: number): { send(body?: string): unknown };
  setHeader(name: string, value: string): void;
}): Promise<unknown> {
  for (const name of ["content-type", "location", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining"]) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const text = await upstream.text().catch(() => "");
  return res.status(upstream.status).send(text || undefined);
}
