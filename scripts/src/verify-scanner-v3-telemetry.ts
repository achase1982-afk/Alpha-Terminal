/**
 * Reads scanner V3 universe telemetry from the in-memory telemetry sink via GET /api/telemetry.
 * Events live in the process-local ring buffer filled by emitTelemetry() (not persisted to SQL).
 *
 * Usage from repo root:
 *   API_URL=https://your-host pnpm exec tsx scripts/src/verify-scanner-v3-telemetry.ts
 *
 * With auth (when DEV_BYPASS_AUTH is not set):
 *   API_URL=... AUTHORIZATION='Bearer <token>' pnpm exec tsx scripts/src/verify-scanner-v3-telemetry.ts
 */
const ONE_HOUR_MS = 60 * 60 * 1000;

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v != null && v !== "" ? v : fallback;
}

interface TelemetryApiEntry {
  id: number;
  timestamp: string;
  system: string;
  severity: string;
  message: string;
  details: Record<string, unknown> | null;
}

interface TelemetryApiResponse {
  entries: TelemetryApiEntry[];
}

async function main(): Promise<void> {
  const base = env("API_URL", "http://127.0.0.1:8080").replace(/\/$/, "");
  const auth = process.env["AUTHORIZATION"] ?? process.env["AUTH_HEADER"] ?? "";

  const url = new URL("/api/telemetry", base);
  url.searchParams.set("system", "SCANNER");
  url.searchParams.set("showResolved", "true");
  url.searchParams.set("limit", "2000");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth) headers["Authorization"] = auth;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    console.error(`HTTP ${res.status} from ${url.toString()}`);
    console.error(body.slice(0, 500));
    process.exit(1);
    return;
  }

  const data = (await res.json()) as TelemetryApiResponse;
  const entries = Array.isArray(data.entries) ? data.entries : [];

  const cutoff = Date.now() - ONE_HOUR_MS;
  const v3 = entries.filter((e) => {
    const msg = e.message ?? "";
    if (msg !== "scanner_v3_universe_returned" && msg !== "scanner_v3_universe_failed") return false;
    const t = new Date(e.timestamp).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });

  v3.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (v3.length === 0) {
    console.log("No scanner_v3_* events in the last hour (system=SCANNER).");
    console.log(`Queried: ${url.toString()}`);
    process.exit(0);
    return;
  }

  for (const e of v3) {
    const d = e.details ?? {};
    const duration_ms =
      typeof d["duration_ms"] === "number" ? d["duration_ms"] : (d["duration_ms"] as number | undefined);
    const count = typeof d["count"] === "number" ? d["count"] : null;
    const error_class = typeof d["error_class"] === "string" ? d["error_class"] : null;
    const tickerLabel =
      count != null ? String(count) : error_class != null ? `(error_class=${error_class})` : "—";
    console.log(
      `${e.timestamp}\t${e.message}\tduration_ms=${duration_ms ?? "?"}\tcount_or_error=${tickerLabel}\tseverity=${e.severity}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
