import { logger } from "./logger.js";

/** PostgreSQL SQLSTATE values are five ASCII characters (e.g. 23505, 42P01). */
function isPgSqlstate(code: unknown): code is string {
  return typeof code === "string" && /^[0-9A-Z]{5}$/i.test(code);
}

function getNextCause(cur: unknown): unknown | undefined {
  if (cur instanceof Error && cur.cause !== undefined) return cur.cause;
  if (typeof cur === "object" && cur !== null) {
    const o = cur as Record<string, unknown>;
    if (o.cause !== undefined) return o.cause;
    if (o.originalError !== undefined) return o.originalError;
  }
  return undefined;
}

/** Outer error first (Drizzle driver, app), then `cause` / `originalError` chains. */
function walkErrorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  for (let depth = 0; depth < 12 && cur !== undefined && cur !== null; depth++) {
    if (typeof cur === "object" || typeof cur === "function") {
      if (seen.has(cur)) break;
      seen.add(cur);
    }
    chain.push(cur);
    const next = getNextCause(cur);
    if (next === undefined) break;
    cur = next;
  }
  return chain;
}

/**
 * Prefer the driver / ORM message (usually first), and PostgreSQL
 * `code` / `detail` / `constraint` from the inner `pg` error (often `cause`).
 */
export function extractPgErrorContext(err: unknown): {
  message: string;
  pgMessage?: string;
  code?: string;
  detail?: string;
  constraint?: string;
} {
  const chain = walkErrorChain(err);
  let message = "";
  for (const node of chain) {
    if (node instanceof Error && node.message) {
      message = node.message;
      break;
    }
    if (typeof node === "object" && node !== null) {
      const m = (node as { message?: unknown }).message;
      if (typeof m === "string" && m.length > 0) {
        message = m;
        break;
      }
    }
  }
  if (!message) message = String(err);

  let code: string | undefined;
  let detail: string | undefined;
  let constraint: string | undefined;
  let pgMessage: string | undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    if (typeof node !== "object" || node === null) continue;
    const rec = node as Record<string, unknown>;
    if (!isPgSqlstate(rec.code)) continue;
    code = rec.code;
    if (typeof rec.detail === "string") detail = rec.detail;
    if (typeof rec.constraint === "string") constraint = rec.constraint;
    if (typeof rec.message === "string") pgMessage = rec.message;
    break;
  }
  return { message, pgMessage, code, detail, constraint };
}

function serializeErr(err: unknown): Record<string, unknown> {
  const pg = extractPgErrorContext(err);
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(pg.code !== undefined ? { pgCode: pg.code } : {}),
      ...(pg.detail !== undefined ? { pgDetail: pg.detail } : {}),
      ...(pg.constraint !== undefined ? { pgConstraint: pg.constraint } : {}),
      ...(pg.pgMessage !== undefined && pg.pgMessage !== err.message ? { pgMessage: pg.pgMessage } : {}),
    };
  }
  return {
    value: String(err),
    ...(pg.code !== undefined ? { pgCode: pg.code } : {}),
    ...(pg.detail !== undefined ? { pgDetail: pg.detail } : {}),
    ...(pg.constraint !== undefined ? { pgConstraint: pg.constraint } : {}),
    ...(pg.pgMessage !== undefined ? { pgMessage: pg.pgMessage } : {}),
  };
}

/**
 * Structured logging for options flow pipeline (persistence, rollup, tape
 * backfill, highlights). Item 22: no silent failures — every catch path
 * should call this or logger with the same shape.
 */
export function logFlowPipelineWarn(
  stage: string,
  message: string,
  ctx: Record<string, unknown> & { err?: unknown },
): void {
  const { err, ...rest } = ctx;
  logger.warn(
    {
      op: "flow_pipeline",
      stage,
      ...rest,
      ...(err !== undefined ? { err: serializeErr(err) } : {}),
    },
    message,
  );
}
