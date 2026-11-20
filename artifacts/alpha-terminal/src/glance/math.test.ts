import { describe, expect, it } from "vitest";
import { FIXTURE } from "./fixture";
import { sessionExtremes, type MinuteBar } from "./useGlanceLive";
import {
  dayMove,
  fromOpenPoints,
  pathStats,
  premiumNet,
  priceNotFollowing,
  qualifiesTrend,
  railPositions,
  resolveTrend,
  wallDistance,
  wallDrift,
} from "./math";

describe("glance price arithmetic", () => {
  it("uses the official close and the actual open", () => {
    const day = dayMove(FIXTURE.spot, FIXTURE.previousClose);
    expect(day?.points).toBeCloseTo(-91.32, 2);
    expect(day?.percent).toBeCloseTo(-1.24, 2);
    expect(fromOpenPoints(FIXTURE.spot, FIXTURE.rthOpen)).toBeCloseTo(-41.32, 2);
    expect(dayMove(FIXTURE.spot, null)).toBeNull();
    expect(FIXTURE.windows.m5).toBeCloseTo(1.2, 2);
    expect(FIXTURE.windows.m15).toBeCloseTo(-18.4, 2);
  });

  it("does not treat a later first bar as the 09:30 open", () => {
    const late: MinuteBar = { t: Date.parse("2026-11-19T15:12:00.000Z"), o: 7200, h: 7210, l: 7190, c: 7204 };
    const onOpen: MinuteBar = { t: Date.parse("2026-11-19T14:30:00.000Z"), o: 7310, h: 7312, l: 7300, c: 7308 };
    const highBar: MinuteBar = { t: Date.parse("2026-11-19T14:34:00.000Z"), o: 7314, h: 7316.4, l: 7313, c: 7315 };
    const laterLow: MinuteBar = { t: Date.parse("2026-11-19T16:48:00.000Z"), o: 7264, h: 7266, l: 7261.96, c: 7262 };
    expect(sessionExtremes([late]).open).toBeNull();
    const full = sessionExtremes([onOpen, highBar, laterLow]);
    expect(full.open).toBe(7310);
    expect(full.high).toBe(7316.4);
    expect(full.low).toBe(7261.96);
    expect(full.highMinute).toBe("09:34");
    expect(full.lowMinute).toBe("11:48");
  });
});

describe("glance flow net", () => {
  it("matches the four-window fixture nets", () => {
    expect(premiumNet(FIXTURE.flow.m1)).toBeCloseTo(6.9e6, 0);
    expect(premiumNet(FIXTURE.flow.m5)).toBeCloseTo(9.8e6, 0);
    expect(premiumNet(FIXTURE.flow.m15)).toBeCloseTo(6.8e6, 0);
    expect(premiumNet(FIXTURE.flow.session)).toBeCloseTo(-24.6e6, 0);
  });

  it("does not treat a missing gross as zero", () => {
    expect(premiumNet({ ...FIXTURE.flow.m1, pb: null })).toBeNull();
  });
});

describe("PRICE NOT FOLLOWING", () => {
  const base = { cb: 1e6, cs: 1e6, pb: 1e6, ps: 1e6 };

  it("keeps the strict boundaries from the spec", () => {
    expect(priceNotFollowing({ ...base, cb: 10_000_000 }, 2).status).toBe("quiet");
    expect(priceNotFollowing({ ...base, cb: 10_010_000 }, 2.99).status).toBe("tag");
    expect(priceNotFollowing({ ...base, cb: 10_010_000 }, 3).status).toBe("quiet");
    expect(priceNotFollowing({ ...base, pb: 12e6 }, -2.99).status).toBe("tag");
    expect(priceNotFollowing({ ...base, pb: 12e6 }, -3).status).toBe("quiet");
    expect(priceNotFollowing({ ...base, ps: 12e6 }, -5).status).toBe("tag");
    expect(priceNotFollowing({ ...base, cs: 12e6 }, 0).status).toBe("tag");
    expect(priceNotFollowing({ ...base, cb: 12e6, pb: 11e6 }, 1).status).toBe("opposed");
    expect(priceNotFollowing({ ...base, cb: 6e6, ps: 6e6 }, 0).status).toBe("quiet");
    expect(priceNotFollowing({ cb: null, cs: null, pb: null, ps: null }, 1).status).toBe("incomplete");
  });

  it("flags the fixture five-minute window", () => {
    expect(priceNotFollowing(FIXTURE.flow.m5, FIXTURE.windows.m5).status).toBe("tag");
  });
});

describe("price trend", () => {
  it("qualifies a monotone 15-point path at efficiency 1", () => {
    const closes = Array.from({ length: 16 }, (_, i) => 7300 + i);
    const stats = pathStats(closes);
    expect(stats?.move).toBe(15);
    expect(stats?.efficiency).toBe(1);
    expect(qualifiesTrend(15, stats!.move, stats!.efficiency)).toBe(true);
  });

  it("gives a flat series efficiency zero", () => {
    const stats = pathStats(Array.from({ length: 16 }, () => 7300));
    expect(stats?.move).toBe(0);
    expect(stats?.efficiency).toBe(0);
  });

  it("holds at 0.40 and releases below it", () => {
    const held = { horizon: 15 as const, direction: -1 as const, move: -16, efficiency: 0.7 };
    const kept = resolveTrend({
      m10: null,
      m15: { move: -4, efficiency: 0.4 },
      held,
    });
    expect(kept?.horizon).toBe(15);
    expect(resolveTrend({ m10: null, m15: { move: -4, efficiency: 0.39 }, held })).toBeNull();
  });

  it("clears when 10m and 15m qualify in opposite directions", () => {
    expect(
      resolveTrend({
        m10: { move: 12, efficiency: 0.8 },
        m15: { move: -16, efficiency: 0.8 },
        held: null,
      }),
    ).toBeNull();
  });

  it("selects 15m when both qualify the same way", () => {
    const chip = resolveTrend({
      m10: { move: -12, efficiency: 0.9 },
      m15: { move: -18.4, efficiency: 0.88 },
      held: null,
    });
    expect(chip?.horizon).toBe(15);
    expect(chip?.direction).toBe(-1);
  });
});

describe("walls and rail", () => {
  it("keeps distance and drift distinct, including a put wall above spot", () => {
    expect(wallDistance(7350, FIXTURE.spot)).toBeCloseTo(81.32, 2);
    expect(wallDrift(7350, 7450)).toBe(-100);
    expect(wallDistance(7325, FIXTURE.spot)).toBeGreaterThan(0);
    expect(wallDistance(7265, FIXTURE.spot)).toBeLessThan(0);
  });

  it("places both walls above spot on the same side of center", () => {
    const marks = railPositions(FIXTURE.spot, [
      { id: "spot", price: FIXTURE.spot },
      { id: "call", price: 7350 },
      { id: "put", price: 7325 },
    ]);
    const spot = marks.find((m) => m.id === "spot")!;
    const call = marks.find((m) => m.id === "call")!;
    const put = marks.find((m) => m.id === "put")!;
    expect(spot.x).toBeCloseTo(0.5, 5);
    expect(call.x).toBeGreaterThan(0.5);
    expect(put.x).toBeGreaterThan(0.5);
    expect(call.x).toBeGreaterThan(put.x);
  });
});
