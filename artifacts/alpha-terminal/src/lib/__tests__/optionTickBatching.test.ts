import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import { createOptionTickBatcher, type OptionTickBatcherEnv } from "@/lib/optionTickBatcher";

function tick(key: string, over: Partial<OptionTick> = {}): OptionTick {
  return {
    key,
    bid: 1,
    ask: 1.1,
    last: 1.05,
    bidSize: 10,
    askSize: 10,
    volume: 100,
    openInterest: 500,
    iv: 20,
    delta: 0.5,
    gamma: 0.01,
    theta: -0.5,
    vega: 0.1,
    mark: 1.05,
    change: 0,
    lastSize: 1,
    underlyingPrice: 7320,
    quoteTime: 1_000,
    tradeTime: 900,
    volumeSample: null,
    ts: 1_000,
    ...over,
  };
}

/** Manual frame + timer clock so batching can be stepped deterministically. */
function fakeEnv() {
  let nextId = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const env: OptionTickBatcherEnv = {
    requestFrame: (cb) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelFrame: (id) => void frames.delete(id),
    setTimer: (cb) => {
      const id = nextId++;
      timers.set(id, cb);
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  const run = (queue: Map<number, () => void>) => {
    const pending = [...queue.values()];
    queue.clear();
    for (const cb of pending) cb();
  };
  return {
    env,
    frame: () => run(frames),
    timeout: () => run(timers),
    scheduled: () => frames.size + timers.size,
  };
}

describe("options stream store: mergeTicks", () => {
  beforeEach(() => useOptionsStreamStore.getState().clearTicks());

  it("applies a whole batch with one subscriber notification", () => {
    const listener = vi.fn();
    const unsubscribe = useOptionsStreamStore.subscribe(listener);
    const batch = Array.from({ length: 200 }, (_, i) => tick(`K${i % 40}`, { bid: 1 + i / 100, ts: 1_000 + i }));
    useOptionsStreamStore.getState().mergeTicks(batch);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.keys(useOptionsStreamStore.getState().ticks)).toHaveLength(40);
  });

  it("ends in the same state as applying the ticks one at a time", () => {
    const batch = [
      tick("A", { bid: 1.0, ts: 1 }),
      tick("B", { bid: 2.0, ts: 2 }),
      tick("A", { bid: 1.05, ask: 1.15, ts: 3 }),
      tick("A", { bid: 0, ask: 0, last: 1.2, ts: 4 }),
      tick("B", { iv: -999, ts: 5 }),
    ];
    for (const t of batch) useOptionsStreamStore.getState().mergeTick(t);
    const sequential = useOptionsStreamStore.getState().ticks;

    useOptionsStreamStore.getState().clearTicks();
    useOptionsStreamStore.getState().mergeTicks(batch);
    expect(useOptionsStreamStore.getState().ticks).toEqual(sequential);
  });

  it("keeps the newest volume sample of the batch when a quote-only frame follows it", () => {
    useOptionsStreamStore.getState().mergeTicks([tick("A", { volume: 100 })]);
    useOptionsStreamStore.getState().mergeTicks([
      tick("A", { volume: 130, volumeSample: { cumulativeVol: 130, tradeTimeMs: 2_000 }, ts: 2_000 }),
      tick("A", { bid: 1.2, volume: 130, volumeSample: null, ts: 2_010 }),
    ]);
    const merged = useOptionsStreamStore.getState().ticks.A!;
    expect(merged.bid).toBe(1.2);
    expect(merged.volumeSample).toEqual({ cumulativeVol: 130, tradeTimeMs: 2_000 });
  });

  it("does not notify when a batch changes nothing", () => {
    const t = tick("A");
    useOptionsStreamStore.getState().mergeTicks([t]);
    const before = useOptionsStreamStore.getState().ticks;
    const listener = vi.fn();
    const unsubscribe = useOptionsStreamStore.subscribe(listener);
    useOptionsStreamStore.getState().mergeTicks([t, t]);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(useOptionsStreamStore.getState().ticks).toBe(before);
  });
});

describe("option tick batcher", () => {
  it("delivers everything that arrived during a frame in one batch", () => {
    const clock = fakeEnv();
    const delivered: OptionTick[][] = [];
    const batcher = createOptionTickBatcher((b) => delivered.push(b), { env: clock.env });

    for (let i = 0; i < 12; i++) batcher.push(tick(`K${i}`));
    expect(delivered).toHaveLength(0);
    clock.frame();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toHaveLength(12);
    expect(clock.scheduled()).toBe(0);
  });

  it("turns 200 quotes a second into at most one store write per frame", () => {
    useOptionsStreamStore.getState().clearTicks();
    const clock = fakeEnv();
    const batcher = createOptionTickBatcher((b) => useOptionsStreamStore.getState().mergeTicks(b), {
      env: clock.env,
    });
    const listener = vi.fn();
    const unsubscribe = useOptionsStreamStore.subscribe(listener);

    const frames = 60;
    let sent = 0;
    for (let f = 0; f < frames; f++) {
      const due = Math.round(((f + 1) * 200) / frames) - sent;
      for (let i = 0; i < due; i++) {
        batcher.push(tick(`K${sent % 72}`, { bid: 1 + sent / 1000, ts: 10_000 + sent }));
        sent += 1;
      }
      clock.frame();
    }
    unsubscribe();

    expect(sent).toBe(200);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(frames);
    expect(Object.keys(useOptionsStreamStore.getState().ticks)).toHaveLength(72);
  });

  it("falls back to a timer when frames are not running (hidden tab)", () => {
    const clock = fakeEnv();
    const delivered: OptionTick[][] = [];
    const batcher = createOptionTickBatcher((b) => delivered.push(b), { env: clock.env });
    batcher.push(tick("A"));
    clock.timeout();
    expect(delivered).toHaveLength(1);
    clock.frame();
    expect(delivered).toHaveLength(1);
  });

  it("drops queued ticks on cancel", () => {
    const clock = fakeEnv();
    const delivered: OptionTick[][] = [];
    const batcher = createOptionTickBatcher((b) => delivered.push(b), { env: clock.env });
    batcher.push(tick("A"));
    batcher.cancel();
    clock.frame();
    clock.timeout();
    expect(delivered).toHaveLength(0);
    expect(batcher.pending()).toBe(0);
  });
});
