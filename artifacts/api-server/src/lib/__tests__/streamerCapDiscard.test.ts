import { beforeEach, describe, expect, it } from "vitest";
import {
  streamerSubHold,
  streamerSubLowestPriorityWireDropOrder,
  streamerSubResetForTests,
  streamerSubSetDeskCore,
  streamerSubSetUnderlyingSpotResolver,
} from "../streamerSubscriptionManager.js";
import {
  streamerWireSimulatorAllLevelOneKeysOnWire,
  streamerWireSimulatorApplyPayload,
  streamerWireSimulatorDropLevelOneByPriority,
  streamerWireSimulatorLiveLevelOneOptionsCount,
  streamerWireSimulatorResetForTests,
} from "../streamerWireSimulator.js";

function occQqq(strike: number, type: "C" | "P"): string {
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `QQQ   251121${type}${strikePadded}`;
}

function occSpy(strike: number): string {
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `SPY   251121C${strikePadded}`;
}

describe("cap DISCARDED drop order", () => {
  beforeEach(() => {
    streamerSubResetForTests();
    streamerWireSimulatorResetForTests();
    streamerSubSetUnderlyingSpotResolver(() => 500);
  });

  it("DISCARDED=5 keeps ticket legs and drops farthest OTM SPY chain strikes", () => {
    const ticket = [occQqq(500, "C"), occQqq(500, "P")];
    streamerSubHold("stream:c:ticket:ticket:QQQ:x", "user_visible", "LEVELONE_OPTIONS", ticket);
    const spyChain = Array.from({ length: 100 }, (_, i) => occSpy(300 + i * 5));
    streamerSubHold("stream:c:chain:chain:SPY:y", "user_visible", "LEVELONE_OPTIONS", spyChain);

    const allKeys = [...ticket, ...spyChain];
    streamerWireSimulatorApplyPayload({
      requests: [{ service: "LEVELONE_OPTIONS", command: "ADD", parameters: { keys: allKeys.join(",") } }],
    });
    expect(streamerWireSimulatorLiveLevelOneOptionsCount()).toBe(102);

    const dropOrder = streamerSubLowestPriorityWireDropOrder();
    for (const k of ticket) expect(dropOrder).not.toContain(k);

    streamerWireSimulatorDropLevelOneByPriority(dropOrder, 5);
    expect(streamerWireSimulatorLiveLevelOneOptionsCount()).toBe(97);
    const live = streamerWireSimulatorAllLevelOneKeysOnWire();
    for (const k of ticket) expect(live.has(k)).toBe(true);
    const dropped = dropOrder.slice(0, 5);
    for (const k of dropped) expect(live.has(k)).toBe(false);
  });

  it("with only ticket and desk live, DISCARDED=5 drops nothing from ticket", () => {
    const ticket = [occQqq(500, "C"), occQqq(500, "P")];
    streamerSubHold("stream:c:ticket:ticket:QQQ:x", "user_visible", "LEVELONE_OPTIONS", ticket);
    const desk = [occSpy(500), occSpy(505)];
    streamerSubSetDeskCore("LEVELONE_OPTIONS", desk);

    streamerWireSimulatorApplyPayload({
      requests: [
        {
          service: "LEVELONE_OPTIONS",
          command: "ADD",
          parameters: { keys: [...ticket, ...desk].join(",") },
        },
      ],
    });

    const order = streamerSubLowestPriorityWireDropOrder();
    expect(order.length).toBe(0);
    streamerWireSimulatorDropLevelOneByPriority(order, 5);
    const live = streamerWireSimulatorAllLevelOneKeysOnWire();
    for (const k of ticket) expect(live.has(k)).toBe(true);
  });
});
