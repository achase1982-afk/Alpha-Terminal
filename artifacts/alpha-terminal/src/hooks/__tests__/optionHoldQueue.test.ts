/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";

/** Mirrors useMarketStream per-holder queue: release must follow post. */
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

describe("option hold queue", () => {
  it("strike change with same expiry keeps final payload after serialized release and post", async () => {
    const tail = new Map<string, Promise<unknown>>();
    const holderId = "stream:tab:chain:chain:SPY:abc";
    const payloads = new Map<string, string[]>();
    const log: string[] = [];

    const post = async (keys: string[]) => {
      log.push(`post:${keys.join(",")}`);
      payloads.set(holderId, keys);
    };
    const release = async () => {
      log.push("release");
      payloads.delete(holderId);
    };

    await runHolderOp(tail, holderId, async () => post(["SPY   251121C00590000"]));
    await runHolderOp(tail, holderId, async () => {
      await release();
      await post(["SPY   251121C00600000"]);
    });

    expect(log).toEqual([
      "post:SPY   251121C00590000",
      "release",
      "post:SPY   251121C00600000",
    ]);
    expect(payloads.get(holderId)).toEqual(["SPY   251121C00600000"]);
  });
});