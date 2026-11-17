import { resolveOptionStreamHolderId } from "@/lib/optionHoldClient";
import type { ChainHoldSubscribers } from "../useChainOptionHold";

export const HOLD_TEST_CLIENT_ID = "hold-test-client";

async function runHolderOp(
  tail: Map<string, Promise<unknown>>,
  holderId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = tail.get(holderId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  tail.set(holderId, next);
  await next;
  if (tail.get(holderId) === next) tail.delete(holderId);
}

export type HoldTestHarness = ChainHoldSubscribers & {
  server: Map<string, string[]>;
  holderId: (purpose: string, viewId: string) => string;
  drain: () => Promise<void>;
};

export function createOptionHoldTestHarness(opts?: { postDelayMs?: number }): HoldTestHarness {
  const server = new Map<string, string[]>();
  const tail = new Map<string, Promise<unknown>>();
  const generation = new Map<string, number>();

  const holderId = (purpose: string, viewId: string) =>
    resolveOptionStreamHolderId(HOLD_TEST_CLIENT_ID, purpose, viewId);

  const subscribeOptionSymbols: NonNullable<ChainHoldSubscribers["subscribeOptionSymbols"]> = async (
    symbols,
    options,
  ) => {
    if (!symbols.length) return undefined;
    const purpose = options?.purpose ?? "watchlist";
    const viewId = options?.viewId ?? "";
    const id = holderId(purpose, viewId);
    const genAt = generation.get(id) ?? 0;
    generation.set(id, genAt + 1);
    await runHolderOp(tail, id, async () => {
      if (opts?.postDelayMs) await new Promise((r) => setTimeout(r, opts.postDelayMs));
      if (options?.isAborted?.()) return;
      server.set(id, [...symbols]);
    });
    return id;
  };

  const releaseOptionHold: NonNullable<ChainHoldSubscribers["releaseOptionHold"]> = async (id) => {
    if (!id) return;
    const genWhenQueued = generation.get(id) ?? 0;
    await runHolderOp(tail, id, async () => {
      if ((generation.get(id) ?? 0) > genWhenQueued) return;
      server.delete(id);
    });
  };

  const drain = async () => {
    await Promise.all([...tail.values()]);
  };

  return { subscribeOptionSymbols, releaseOptionHold, server, holderId, drain };
}
