const APP2_MAX_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
/** Parallel in-flight Schwab app-2 REST calls (rate still capped at 120/min). */
const MAX_CONCURRENT = 12;

const recentCallTimes: number[] = [];
let inFlight = 0;
const waiters: Array<() => void> = [];

export function deskSchwab2RateLimitMaxPerMinute(): number {
  return APP2_MAX_PER_MINUTE;
}

function prune(now: number): void {
  while (recentCallTimes.length > 0 && now - recentCallTimes[0]! >= WINDOW_MS) {
    recentCallTimes.shift();
  }
}

function releaseConcurrency(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

async function waitForRateSlot(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    prune(now);
    if (recentCallTimes.length < APP2_MAX_PER_MINUTE) {
      recentCallTimes.push(now);
      return;
    }
    const oldest = recentCallTimes[0]!;
    const waitMs = Math.max(WINDOW_MS - (now - oldest) + 25, 50);
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)));
  }
}

async function acquireConcurrency(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(() => {
      inFlight += 1;
      resolve();
    });
  });
}

/** Token-bucket style rate limit (120/min) with bounded concurrency for parallel chains/puts. */
export function deskSchwab2RateLimited<T>(fn: () => Promise<T>, queueBudgetMs = 120_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const startMs = Date.now();
    const run = async () => {
      try {
        while (Date.now() - startMs > queueBudgetMs) {
          throw new Error("schwab2_rate_limit_queue_timeout");
        }
        await acquireConcurrency();
        try {
          while (Date.now() - startMs > queueBudgetMs) {
            throw new Error("schwab2_rate_limit_queue_timeout");
          }
          await waitForRateSlot();
          const result = await fn();
          resolve(result);
        } finally {
          releaseConcurrency();
        }
      } catch (err) {
        reject(err);
      }
    };
    void run();
  });
}

export function resetSchwab2RateLimitForTests(): void {
  recentCallTimes.length = 0;
  inFlight = 0;
  waiters.length = 0;
}