const APP2_MAX_PER_MINUTE = 120;
const WINDOW_MS = 60_000;

const recentCallTimes: number[] = [];
let waitChain: Promise<void> = Promise.resolve();

export function deskSchwab2RateLimitMaxPerMinute(): number {
  return APP2_MAX_PER_MINUTE;
}

function prune(now: number): void {
  while (recentCallTimes.length > 0 && now - recentCallTimes[0]! >= WINDOW_MS) {
    recentCallTimes.shift();
  }
}

async function acquireSlot(): Promise<void> {
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

/** Serialize Schwab app-2 market-data REST calls under ~120 requests/minute. */
export function deskSchwab2RateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = waitChain.then(() => acquireSlot()).then(() => fn());
  waitChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetSchwab2RateLimitForTests(): void {
  recentCallTimes.length = 0;
  waitChain = Promise.resolve();
}