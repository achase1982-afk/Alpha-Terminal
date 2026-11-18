import { describe, expect, it } from "vitest";
import { atChainDateWindow, AT_LADDER_STRIKE_COUNT } from "./atLadderStrikeCount";

describe("atChainDateWindow", () => {
  it("starts the ladder at 20 strikes each side of spot", () => {
    expect(AT_LADDER_STRIKE_COUNT).toBe(40);
  });

  it("asks for a single expiration once the ladder has one", () => {
    expect(atChainDateWindow("2026-11-20T21:00:00.000Z")).toEqual({
      fromDate: "2026-11-20",
      toDate: "2026-11-20",
    });
  });

  it("uses a few sessions when the front expiry is not known yet", () => {
    const w = atChainDateWindow(null, new Date("2026-11-18T16:30:00Z"));
    expect(w.fromDate).toBe("2026-11-18");
    expect(w.toDate).toBe("2026-11-21");
  });
});
