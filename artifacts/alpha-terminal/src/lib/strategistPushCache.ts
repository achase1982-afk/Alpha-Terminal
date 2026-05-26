/** Cache name shared with `public/sw.js` for strategist completion push handoff. */
export const STRATEGIST_PUSH_CACHE = "alpha-strategist-push-v1";
const PENDING_JOB_KEY = "https://alpha-terminal.local/pending-strategist-job";

export type StashedStrategistPush = {
  jobId: string;
  ticker?: string;
  at: number;
};

/** Read and clear a strategist job stashed by the service worker (survives iOS focus races). */
export async function readStashedStrategistPushJob(): Promise<StashedStrategistPush | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(STRATEGIST_PUSH_CACHE);
    const res = await cache.match(PENDING_JOB_KEY);
    if (!res) return null;
    await cache.delete(PENDING_JOB_KEY);
    const data = (await res.json()) as StashedStrategistPush;
    if (!data?.jobId || typeof data.jobId !== "string") return null;
    return { jobId: data.jobId.trim(), ticker: data.ticker, at: data.at ?? 0 };
  } catch {
    return null;
  }
}
