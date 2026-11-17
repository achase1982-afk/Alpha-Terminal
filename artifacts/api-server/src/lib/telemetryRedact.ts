const SENSITIVE_KEY =
  /token|authorization|cookie|secret|api_key|apikey|refresh_token|access_token|clerk_token|bearer|password/i;

const URL_SENSITIVE_PARAMS = new Set([
  "token",
  "clerk_token",
  "access_token",
  "refresh_token",
  "api_key",
  "apikey",
  "bearer",
  "password",
]);

export function redactTelemetryString(s: string): string {
  if (!/(:\/\/|\?|&)/.test(s) && !/clerk_token|token=/i.test(s)) {
    return s;
  }
  try {
    const absolute = s.startsWith("http://") || s.startsWith("https://") || s.startsWith("wss://");
    if (!absolute && s.includes("?")) {
      const [path, query] = s.split("?", 2);
      const parts = (query ?? "").split("&").map((pair) => {
        const eq = pair.indexOf("=");
        if (eq < 0) return pair;
        const key = pair.slice(0, eq);
        if (URL_SENSITIVE_PARAMS.has(key.toLowerCase())) {
          return `${key}=[REDACTED]`;
        }
        return pair;
      });
      return parts.length ? `${path}?${parts.join("&")}` : path;
    }
    const u = new URL(s, absolute ? undefined : "http://local.invalid");
    for (const name of URL_SENSITIVE_PARAMS) {
      if (u.searchParams.has(name)) u.searchParams.set(name, "[REDACTED]");
    }
    if (absolute) return u.toString().replace("%5BREDACTED%5D", "[REDACTED]");
    const q = u.searchParams.toString().replace(/%5BREDACTED%5D/gi, "[REDACTED]");
    return q ? `${u.pathname}?${q}` : u.pathname;
  } catch {
    return s
      .replace(/([?&])(clerk_token|token|access_token|refresh_token|api_key|apikey)=([^&]+)/gi, "$1$2=[REDACTED]");
  }
}

export function redactTelemetryValue(value: unknown, depth = 0): unknown {
  if (depth > 14) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") return redactTelemetryString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redactTelemetryValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactTelemetryValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function redactTelemetryDetails(
  details?: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const redacted = redactTelemetryValue(details) as Record<string, unknown>;
  return redacted;
}