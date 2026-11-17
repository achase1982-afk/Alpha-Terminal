let anchorMs = 0;
let anchorHr = 0n;

/** UTC wall-clock epoch nanoseconds (for tape SSE `rx_ns`). */
export function deskUtcEpochNs(): bigint {
  const ms = Date.now();
  const hr = process.hrtime.bigint();
  if (anchorMs === 0 || Math.abs(ms - anchorMs) > 1_000) {
    anchorMs = ms;
    anchorHr = hr;
  }
  const delta = hr - anchorHr;
  return BigInt(ms) * 1_000_000n + delta;
}

/** Safe JSON field: decimal string integer (epoch ns exceeds `Number.MAX_SAFE_INTEGER`). */
export function deskUtcEpochNsJson(): string {
  return deskUtcEpochNs().toString();
}