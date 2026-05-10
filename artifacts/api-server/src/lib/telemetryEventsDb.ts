import {
  and,
  db,
  desc,
  gte,
  inArray,
  lte,
  sql,
  telemetryEventsTable,
  type TelemetryEventRow,
} from "@workspace/db";

/** Hard cap per request to protect Postgres and payload sizes. */
export const RUNTIME_LOG_MAX_LIMIT = 5000;

export type RuntimeLogRow = {
  id: string;
  emittedAt: string;
  service: string;
  system: string;
  level: string;
  message: string;
  subsystem: string | null;
  details: unknown;
};

function rowToDto(r: TelemetryEventRow): RuntimeLogRow {
  return {
    id: String(r.id),
    emittedAt: r.emittedAt.toISOString(),
    service: r.service ?? "server",
    system: r.system,
    level: r.level,
    message: r.message,
    subsystem: r.subsystem ?? null,
    details: r.details,
  };
}

export function parseRangeQuery(params: {
  minutes?: string;
  from?: string;
  to?: string;
}): { from: Date; to: Date } | { error: string } {
  const toParam = params.to?.trim();
  const fromParam = params.from?.trim();
  const minRaw = params.minutes?.trim();

  const to = toParam ? new Date(toParam) : new Date();
  if (Number.isNaN(to.getTime())) {
    return { error: "Invalid to" };
  }

  if (fromParam) {
    const from = new Date(fromParam);
    if (Number.isNaN(from.getTime())) {
      return { error: "Invalid from" };
    }
    if (from >= to) {
      return { error: "from must be before to" };
    }
    return { from, to };
  }

  const minutes = minRaw ? Number.parseInt(minRaw, 10) : 5;
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 43200) {
    return { error: "minutes must be between 1 and 43200 (30 days)" };
  }
  const from = new Date(to.getTime() - minutes * 60 * 1000);
  return { from, to };
}

export async function queryTelemetryEvents(opts: {
  from: Date;
  to: Date;
  q?: string;
  systems?: string[];
  /** Filters telemetry_events.service (server | web). */
  services?: string[];
  limit: number;
}): Promise<RuntimeLogRow[]> {
  const lim = Math.min(Math.max(1, opts.limit), RUNTIME_LOG_MAX_LIMIT);

  const conditions = [
    gte(telemetryEventsTable.emittedAt, opts.from),
    lte(telemetryEventsTable.emittedAt, opts.to),
  ];

  if (opts.systems?.length) {
    conditions.push(inArray(telemetryEventsTable.system, opts.systems));
  }

  if (opts.services?.length) {
    conditions.push(inArray(telemetryEventsTable.service, opts.services));
  }

  const safeQ = (opts.q ?? "").trim().replace(/[%_]/g, "").slice(0, 240);
  if (safeQ.length > 0) {
    const p = `%${safeQ}%`;
    conditions.push(
      sql`(${telemetryEventsTable.message} ILIKE ${p} OR (${telemetryEventsTable.details})::text ILIKE ${p})`,
    );
  }

  const rows = await db
    .select()
    .from(telemetryEventsTable)
    .where(and(...conditions))
    .orderBy(desc(telemetryEventsTable.emittedAt))
    .limit(lim);

  return rows.map(rowToDto);
}

export function rowsToPlainText(rows: RuntimeLogRow[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    const detailStr =
      r.details !== null && typeof r.details === "object"
        ? JSON.stringify(r.details)
        : String(r.details ?? "");
    lines.push(`${r.emittedAt}\t${r.service}\t${r.system}\t${r.level}\t${r.message}\t${detailStr}`);
  }
  return lines.join("\n");
}

export function rowsToCsv(rows: RuntimeLogRow[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ["emittedAt", "service", "system", "level", "message", "subsystem", "details"];
  const out = [header.join(",")];
  for (const r of rows) {
    const detailStr =
      r.details !== null && typeof r.details === "object"
        ? JSON.stringify(r.details)
        : String(r.details ?? "");
    out.push(
      [
        esc(r.emittedAt),
        esc(r.service),
        esc(r.system),
        esc(r.level),
        esc(r.message),
        esc(r.subsystem ?? ""),
        esc(detailStr),
      ].join(","),
    );
  }
  return out.join("\n");
}
