/** Shared bucket close timing (~1s lag target). */

export const DESK_LIVE_FLOW_BUCKET_CLOSE_MS = 1_100;
export const DESK_LIVE_FLOW_BUCKET_TICK_MS = 250;

export function bucketMs1s(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

export function minuteMs(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}

export function bucketDueToClose(bucketStartMs: number, nowMs: number, widthMs: number): boolean {
  return nowMs >= bucketStartMs + widthMs + (DESK_LIVE_FLOW_BUCKET_CLOSE_MS - widthMs);
}

type CloseHandler = (nowMs: number) => void;

let timer: ReturnType<typeof setInterval> | null = null;
const handlers = new Set<CloseHandler>();

export function deskLiveFlowBucketsRegister(onTick: CloseHandler): () => void {
  handlers.add(onTick);
  if (!timer) {
    timer = setInterval(() => {
      const now = Date.now();
      for (const h of handlers) h(now);
    }, DESK_LIVE_FLOW_BUCKET_TICK_MS);
    timer.unref?.();
  }
  return () => {
    handlers.delete(onTick);
    if (handlers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function deskLiveFlowBucketsResetForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  handlers.clear();
}