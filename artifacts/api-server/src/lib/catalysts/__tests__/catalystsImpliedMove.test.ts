import { describe, expect, it } from "vitest";
import {
  impliedMovePctFromStraddle,
  pickExpiryCoveringEarnings,
} from "../catalystsImpliedMove.js";

describe("catalystsImpliedMove", () => {
  it("picks first expiry on or after earnings date", () => {
    expect(
      pickExpiryCoveringEarnings(
        ["2026-05-10", "2026-05-17", "2026-05-24"],
        "2026-05-16",
      ),
    ).toBe("2026-05-17");
    expect(
      pickExpiryCoveringEarnings(["2026-05-10"], "2026-05-16"),
    ).toBeNull();
  });

  it("computes straddle mid over spot as percent", () => {
    const pct = impliedMovePctFromStraddle(
      100,
      [
        { strike: 100, expiration: "2026-05-17", bid: 3, ask: 3.2 },
        { strike: 105, expiration: "2026-05-17", bid: 1, ask: 1.1 },
      ],
      [
        { strike: 100, expiration: "2026-05-17", bid: 2.8, ask: 3 },
        { strike: 95, expiration: "2026-05-17", bid: 1, ask: 1.1 },
      ],
      "2026-05-17",
    );
    expect(pct).toBe(6);
  });

  it("returns null for empty straddle", () => {
    expect(
      impliedMovePctFromStraddle(100, [], [], "2026-05-17"),
    ).toBeNull();
  });
});
