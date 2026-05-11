/** Max UTF-8 size for raw_api_response in GET /telemetry/strategist list responses (full row endpoint is untrimmed). */
export const STRATEGIST_TELEMETRY_RAW_API_LIST_MAX_BYTES = 200_000;

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** Returns a shallow clone of the row with oversized rawApiResponse replaced by a preview marker. */
export function trimStrategistTelemetryRowForListResponse<T extends Record<string, unknown>>(row: T): T {
  const raw = row.rawApiResponse;
  if (raw == null) return row;
  const serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (utf8ByteLength(serialized) <= STRATEGIST_TELEMETRY_RAW_API_LIST_MAX_BYTES) return row;
  return {
    ...row,
    rawApiResponse: {
      _trimmed: true,
      originalSizeBytes: utf8ByteLength(serialized),
      preview: serialized.slice(0, 8000),
    },
  };
}
