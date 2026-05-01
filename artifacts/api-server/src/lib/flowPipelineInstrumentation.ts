import { logger } from "./logger.js";

function serializeErr(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { value: String(err) };
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
