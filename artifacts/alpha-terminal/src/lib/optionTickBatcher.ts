import type { OptionTick } from "@/lib/options-stream-store";

/**
 * Option quotes arrive one WebSocket message at a time, up to hundreds per
 * second. Writing each one to the store runs every subscriber and re-renders
 * synchronously, so a busy tape can keep the main thread from ever reaching a
 * tap. This collects them and hands the batch over once per animation frame.
 *
 * The timer covers a hidden tab, where animation frames stop.
 */
export const OPTION_TICK_MAX_WAIT_MS = 100;

type FrameHandle = number;

export type OptionTickBatcherEnv = {
  requestFrame: (cb: () => void) => FrameHandle;
  cancelFrame: (handle: FrameHandle) => void;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type OptionTickBatcher = {
  push: (tick: OptionTick) => void;
  /** Deliver whatever is queued now. */
  flush: () => void;
  /** Drop whatever is queued (stream reset). */
  cancel: () => void;
  pending: () => number;
};

function browserEnv(): OptionTickBatcherEnv {
  const hasRaf = typeof requestAnimationFrame === "function";
  return {
    requestFrame: (cb) => (hasRaf ? requestAnimationFrame(() => cb()) : 0),
    cancelFrame: (handle) => {
      if (hasRaf && handle) cancelAnimationFrame(handle);
    },
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export function createOptionTickBatcher(
  deliver: (ticks: OptionTick[]) => void,
  opts?: { maxWaitMs?: number; env?: OptionTickBatcherEnv },
): OptionTickBatcher {
  const env = opts?.env ?? browserEnv();
  const maxWaitMs = opts?.maxWaitMs ?? OPTION_TICK_MAX_WAIT_MS;
  let queue: OptionTick[] = [];
  let frame: FrameHandle = 0;
  let timer: unknown = null;
  let scheduled = false;

  const unschedule = () => {
    if (frame) env.cancelFrame(frame);
    if (timer != null) env.clearTimer(timer);
    frame = 0;
    timer = null;
    scheduled = false;
  };

  const flush = () => {
    unschedule();
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    deliver(batch);
  };

  return {
    push(tick) {
      queue.push(tick);
      if (scheduled) return;
      scheduled = true;
      frame = env.requestFrame(flush);
      timer = env.setTimer(flush, maxWaitMs);
    },
    flush,
    cancel() {
      unschedule();
      queue = [];
    },
    pending: () => queue.length,
  };
}
