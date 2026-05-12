import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import {
  getEvents,
  getGroupedEvents,
  getSystemCounts,
  resetSystemCount,
  resolveEvent,
  clearAllEvents,
  getTotalCount,
  emitTelemetry,
} from "../lib/telemetryStore.js";
import { logFailure } from "../lib/telemetry.js";
import {
  parseRangeQuery,
  queryTelemetryEvents,
  rowsToCsv,
  rowsToPlainText,
  RUNTIME_LOG_MAX_LIMIT,
} from "../lib/telemetryEventsDb.js";
import { db, telemetryEventsTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { z } from "zod";

const router: IRouter = Router();

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user_local";

const ALLOWED_SERVICES = new Set(["server", "web"]);

/** Maps DB/schema failures to actionable JSON for the Logs UI (e.g. missing migration). */
function runtimeLogsFailurePayload(
  err: unknown,
  mode: "list" | "export",
): {
  status: number;
  payload: { error: string; hint?: string };
} {
  const msg = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (
    code === "42703" ||
    /column\s+"service"\s+does\s+not\s+exist/i.test(msg) ||
    (/telemetry_events/i.test(msg) && /service/i.test(msg) && /does not exist/i.test(msg))
  ) {
    return {
      status: 503,
      payload: {
        error:
          "Runtime logs query failed: telemetry_events.service is missing (database schema is older than this API build).",
        hint: "Apply migration 0031_telemetry_events_service.sql to Postgres, redeploy the API, then reload this page.",
      },
    };
  }
  return {
    status: 500,
    payload: {
      error: mode === "export" ? "Failed to export runtime logs" : "Failed to fetch runtime logs",
    },
  };
}

const browserEventsBodySchema = z.object({
  events: z
    .array(
      z.object({
        level: z.enum(["INFO", "WARN", "ERROR"]),
        message: z.string().min(1).max(8000),
        details: z.record(z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(40),
});

function parseRuntimeLogParams(req: Request): {
  from: Date;
  to: Date;
  limit: number;
  q?: string;
  systems?: string[];
  services?: string[];
} | { error: string } {
  const parsed = parseRangeQuery({
    minutes: typeof req.query.minutes === "string" ? req.query.minutes : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
  });
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const limitRaw = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 500;
  const limit = Math.min(
    RUNTIME_LOG_MAX_LIMIT,
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 500),
  );
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const systemsRaw = typeof req.query.systems === "string" ? req.query.systems : "";
  const systems = systemsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const servicesRaw = typeof req.query.services === "string" ? req.query.services : "";
  const services = servicesRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ALLOWED_SERVICES.has(s));
  return {
    from: parsed.from,
    to: parsed.to,
    limit,
    q,
    systems: systems.length ? systems : undefined,
    services: services.length ? services : undefined,
  };
}

/** Ingests browser-side errors/events into telemetry_events (service alpha-terminal). Clerk session required. */
router.post("/browser-events", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = DEV_BYPASS ? DEV_USER_ID : getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsed = browserEventsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    const rows = parsed.data.events.map((e) => ({
      service: "web" as const,
      system: "CLIENT",
      level: e.level,
      message: e.message,
      subsystem: "BROWSER",
      details: { ...(e.details ?? {}), clerk_user_id: userId },
      requestId: null as string | null,
    }));
    await db.insert(telemetryEventsTable).values(rows);
    res.json({ ok: true, inserted: rows.length });
  } catch (err: unknown) {
    req.log?.error({ err }, "browser-events insert failed");
    res.status(500).json({ error: "Failed to record browser events" });
  }
});

/** Durable telemetry_events (HTTP timing + emitTelemetry); Clerk-gated via /api middleware. */
router.get("/runtime-logs", async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseRuntimeLogParams(req);
    if ("error" in params) {
      res.status(400).json({ error: params.error });
      return;
    }
    const rows = await queryTelemetryEvents({
      from: params.from,
      to: params.to,
      limit: params.limit,
      q: params.q,
      systems: params.systems,
      services: params.services,
    });
    res.json({
      entries: rows,
      truncated: rows.length >= params.limit,
      maxLimit: RUNTIME_LOG_MAX_LIMIT,
    });
  } catch (err: unknown) {
    req.log?.error({ err }, "runtime-logs query failed");
    const { status, payload } = runtimeLogsFailurePayload(err, "list");
    res.status(status).json(payload);
  }
});

router.get("/runtime-logs/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const params = parseRuntimeLogParams(req);
    if ("error" in params) {
      res.status(400).json({ error: params.error });
      return;
    }
    const fmtRaw = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";
    const format = fmtRaw === "text" || fmtRaw === "csv" || fmtRaw === "json" ? fmtRaw : "json";

    const rows = await queryTelemetryEvents({
      from: params.from,
      to: params.to,
      limit: params.limit,
      q: params.q,
      systems: params.systems,
      services: params.services,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (format === "json") {
      const body = JSON.stringify(rows, null, 2);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="telemetry-runtime-logs-${stamp}.json"`);
      res.send(body);
      return;
    }
    if (format === "csv") {
      const body = rowsToCsv(rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="telemetry-runtime-logs-${stamp}.csv"`);
      res.send(body);
      return;
    }
    const body = rowsToPlainText(rows);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="telemetry-runtime-logs-${stamp}.txt"`);
    res.send(body);
  } catch (err: unknown) {
    req.log?.error({ err }, "runtime-logs export failed");
    const { status, payload } = runtimeLogsFailurePayload(err, "export");
    res.status(status).json(payload);
  }
});

router.get("/", async (req, res) => {
  try {
    const system = req.query.system as string | undefined;
    const severity = req.query.severity as string | undefined;
    const showResolved = req.query.showResolved === "true";
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 500, 2000));
    const grouped = req.query.grouped === "true";

    if (grouped) {
      const result = getGroupedEvents({ system, severity, showResolved, limit });
      return res.json(result);
    } else {
      const entries = getEvents({ system, severity, showResolved, limit });
      return res.json({ entries });
    }
  } catch (err: any) {
    req.log.error({ err }, "Telemetry fetch error");
    return res.status(500).json({ error: "Failed to fetch telemetry" });
  }
});

router.get("/counts", async (_req, res) => {
  try {
    const totals = getTotalCount();
    const perSystem = getSystemCounts();
    res.json({ unresolvedCount: totals.errors + totals.warns, total: totals.total, errors: totals.errors, warns: totals.warns, perSystem });
    return;
  } catch {
    return res.json({ unresolvedCount: 0, total: 0, errors: 0, warns: 0, perSystem: {} });
  }
});

router.post("/reset-count/:system", async (req, res) => {
  resetSystemCount(req.params.system);
  return res.json({ ok: true });
});

router.patch("/:id/resolve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const ok = resolveEvent(id);
    return res.json({ ok });
  } catch (err: any) {
    req.log.error({ err }, "Telemetry resolve error");
    return res.status(500).json({ error: "Failed to resolve" });
  }
});

router.delete("/clear", async (_req, res) => {
  clearAllEvents();
  return res.json({ ok: true });
});

router.post("/client-event", async (req, res): Promise<void> => {
  try {
    const body = req.body && typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
    const stage = typeof body.stage === "string" ? body.stage : "";
    if (!stage.trim()) {
      res.status(400).json({ error: "stage is required" });
      return;
    }

    const details: Record<string, unknown> = { ...body, source: "client" };
    emitTelemetry("STRATEGIST", "WARN", `Client telemetry: ${stage}`, details, "STRATEGIST");

    void logFailure("STRATEGIST", "INFO", `Desk audio client event: ${stage}`, details);

    res.json({ ok: true });
  } catch (err) {
    req.log?.error({ err }, "client-event telemetry failed");
    res.status(500).json({ error: "Failed to record event" });
  }
});

export default router;
