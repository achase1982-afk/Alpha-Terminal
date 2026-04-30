/**
 * In-memory cancel flags for background POST /strategist/analyze jobs.
 * Cleared when the analyze worker finishes (success, error, or cancel).
 */

const cancelledJobIds = new Set<string>();

export function markStrategistAnalyzeCancelled(jobId: string): void {
  cancelledJobIds.add(jobId);
}

export function clearStrategistAnalyzeCancelled(jobId: string): void {
  cancelledJobIds.delete(jobId);
}

export function isStrategistAnalyzeCancelled(jobId: string): boolean {
  return cancelledJobIds.has(jobId);
}

export function throwIfStrategistAnalyzeCancelled(jobId: string | undefined): void {
  if (!jobId) return;
  if (cancelledJobIds.has(jobId)) {
    const err = new Error("Analysis cancelled");
    err.name = "AbortError";
    throw err;
  }
}
