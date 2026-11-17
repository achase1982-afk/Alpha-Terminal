import type { Request } from "express";
import { parseRangeQuery, RUNTIME_LOG_MAX_LIMIT } from "./telemetryEventsDb.js";

const ALLOWED_SERVICES = new Set(["server", "web"]);
const ALLOWED_LEVELS = new Set(["INFO", "WARN", "ERROR"]);

export function parseLevelsQuery(levelsRaw?: string, defaultLevels = "ERROR,WARN"): string[] {
  const raw = (levelsRaw ?? defaultLevels).trim();
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((l) => ALLOWED_LEVELS.has(l));
  return parsed.length ? parsed : ["ERROR", "WARN"];
}

export function parseRuntimeLogParams(req: Request): {
  from: Date;
  to: Date;
  limit: number;
  q?: string;
  systems?: string[];
  services?: string[];
  levels: string[];
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
  const levels = parseLevelsQuery(
    typeof req.query.levels === "string" ? req.query.levels : undefined,
  );
  return {
    from: parsed.from,
    to: parsed.to,
    limit,
    q,
    systems: systems.length ? systems : undefined,
    services: services.length ? services : undefined,
    levels,
  };
}