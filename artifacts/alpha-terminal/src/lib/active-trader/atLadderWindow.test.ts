import { describe, expect, it } from "vitest";
import {
  AT_STREAM_CONTRACT_CAP,
  atLadderPlaceholderOk,
  atLadderRestQuery,
  growAtLadderSide,
  mergeAtChainLegs,
  selectAtStreamKeys,
  trimAtChainLegsToDepth,
} from "./atLadderWindow";

describe("atLadderRestQuery", () => {
  it("opens on one expiry, 20 strikes each side of spot", () => {
    expect(atLadderRestQuery(20, 20)).toEqual({ strikeCount: 40, range: "NTM" });
  });

  it("widens centered strike count when paging strikes above spot", () => {
    expect(growAtLadderSide(20, 20, "up")).toEqual({ above: 40, below: 20 });
    expect(atLadderRestQuery(40, 20)).toEqual({ strikeCount: 80, range: "NTM" });
  });

  it("widens centered strike count when paging strikes below spot", () => {
    expect(growAtLadderSide(20, 20, "down")).toEqual({ above: 20, below: 40 });
    expect(atLadderRestQuery(20, 40)).toEqual({ strikeCount: 80, range: "NTM" });
  });

  it("trims asymmetric wings around spot so only the scrolled side grows", () => {
    const legs = Array.from({ length: 81 }, (_, i) => ({
      strike: 7140 + i * 5,
      expiration: "2026-11-20",
    }));
    const trimmed = trimAtChainLegsToDepth(legs, 7340, 40, 20);
    const strikes = trimmed.map((l) => l.strike);
    expect(Math.min(...strikes)).toBe(7240);
    expect(Math.max(...strikes)).toBe(7540);
  });

  it("reloads both wings once the two sides are even again", () => {
    expect(atLadderRestQuery(40, 40)).toEqual({ strikeCount: 80, range: "NTM" });
  });

  it("stops well short of the full chain", () => {
    let depth = { above: 20, below: 20 };
    for (let i = 0; i < 10; i++) depth = growAtLadderSide(depth.above, depth.below, "up");
    expect(depth.above).toBe(80);
    expect(depth.below).toBe(20);
  });
});

describe("mergeAtChainLegs", () => {
  it("keeps the first wing when a directional page arrives", () => {
    const first = [
      { strike: 5000, expiration: "2026-11-20", schwabSymbol: "C5000" },
      { strike: 5100, expiration: "2026-11-20", schwabSymbol: "C5100" },
    ];
    const page = [{ strike: 5200, expiration: "2026-11-20", schwabSymbol: "C5200" }];
    const merged = mergeAtChainLegs(first, page, "2026-11-20");
    expect(merged.map((c) => c.strike).sort((a, b) => a - b)).toEqual([5000, 5100, 5200]);
  });

  it("drops the previous expiry when the ladder changes expiration", () => {
    const old = [{ strike: 5000, expiration: "2026-11-20", schwabSymbol: "OLD" }];
    const page = [{ strike: 5000, expiration: "2026-11-21", schwabSymbol: "NEW" }];
    expect(mergeAtChainLegs(old, page, "2026-11-21").map((c) => c.schwabSymbol)).toEqual(["NEW"]);
  });
});

describe("selectAtStreamKeys", () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({
    strike: 4000 + i * 5,
    callKey: `C${i}`,
    putKey: `P${i}`,
  }));

  it("subscribes the visible rows plus overscan, not the loaded book", () => {
    const keys = selectAtStreamKeys({
      rows,
      visibleMin: 4200,
      visibleMax: 4250,
      overscan: 2,
    });
    expect(keys.length).toBeLessThanOrEqual(30);
    expect(keys).toContain("C40");
    expect(keys).not.toContain("C0");
    expect(keys).not.toContain("C79");
  });

  it("never asks for more than 150 option contracts", () => {
    const keys = selectAtStreamKeys({
      rows,
      visibleMin: 4000,
      visibleMax: 5000,
      overscan: 80,
      contractCap: AT_STREAM_CONTRACT_CAP,
    });
    expect(keys.length).toBe(AT_STREAM_CONTRACT_CAP);
  });
});

describe("atLadderPlaceholderOk", () => {
  const next = { symbol: "$SPX", fromDate: "2026-11-18", toDate: "2026-11-18" };

  it("never accepts the Chain view's response (no expiry window, no range)", () => {
    expect(atLadderPlaceholderOk({ symbol: "$SPX" }, next)).toBe(false);
    expect(atLadderPlaceholderOk(undefined, next)).toBe(false);
  });

  it("accepts the previous page of the same ladder window", () => {
    expect(
      atLadderPlaceholderOk({ symbol: "$SPX", fromDate: "2026-11-18", toDate: "2026-11-18", range: "NTM" }, next),
    ).toBe(true);
  });

  it("accepts the first-load window that covers the picked expiry", () => {
    expect(
      atLadderPlaceholderOk({ symbol: "$SPX", fromDate: "2026-11-18", toDate: "2026-11-21", range: "NTM" }, next),
    ).toBe(true);
  });

  it("rejects another symbol or another expiry", () => {
    expect(
      atLadderPlaceholderOk({ symbol: "AAPL", fromDate: "2026-11-18", toDate: "2026-11-18", range: "NTM" }, next),
    ).toBe(false);
    expect(
      atLadderPlaceholderOk({ symbol: "$SPX", fromDate: "2026-11-19", toDate: "2026-11-19", range: "NTM" }, next),
    ).toBe(false);
  });
});
