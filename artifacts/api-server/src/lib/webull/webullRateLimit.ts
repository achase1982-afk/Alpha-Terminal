type BucketKey = "accounts" | "default";

interface BucketState {
  timestamps: number[];
  windowMs: number;
  max: number;
}

const buckets: Record<BucketKey, BucketState> = {
  accounts: { timestamps: [], windowMs: 30_000, max: 10 },
  default: { timestamps: [], windowMs: 2_000, max: 2 },
};

function prune(state: BucketState, now: number) {
  state.timestamps = state.timestamps.filter((t) => now - t < state.windowMs);
}

export async function webullRateLimitWait(bucket: BucketKey): Promise<void> {
  for (;;) {
    const now = Date.now();
    const state = buckets[bucket];
    prune(state, now);
    if (state.timestamps.length < state.max) {
      state.timestamps.push(now);
      return;
    }
    const oldest = state.timestamps[0] ?? now;
    const waitMs = Math.max(25, state.windowMs - (now - oldest) + 5);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}