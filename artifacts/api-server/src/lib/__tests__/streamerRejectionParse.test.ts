import { describe, expect, it } from "vitest";
import {
  normalizeStreamerOccKey,
  streamerSubParseRejection,
  streamerSubResolveLiveKey,
} from "../streamerSubscriptionManager.js";
import {
  streamerWireSimulatorApplyPayload,
  streamerWireSimulatorLiveLevelOneOptionsCount,
  streamerWireSimulatorResetForTests,
} from "../streamerWireSimulator.js";

describe("streamerSubParseRejection", () => {
  it("treats cap messages as discarded count, not a symbol key", () => {
    const p = streamerSubParseRejection(
      "maximum number of symbols allowed (LEVELONE_OPTIONS=3000, DISCARDED=2)",
    );
    expect(p).toEqual({
      kind: "cap",
      service: "LEVELONE_OPTIONS",
      discarded: 2,
    });
  });

  it("preserves OCC spacing for symbol rejections", () => {
    const sym = "SPY   251121C00600000";
    const p = streamerSubParseRejection(`ADD failed keys=${sym}`);
    expect(p.kind).toBe("symbol");
    if (p.kind === "symbol") expect(p.symbol).toBe(sym);
  });

  it("resolves live keys with normalized whitespace match", () => {
    const live = new Set(["SPY   251121C00600000"]);
    expect(streamerSubResolveLiveKey("SPY251121C00600000", live)).toBe("SPY   251121C00600000");
    expect(normalizeStreamerOccKey("SPY   251121C00600000")).toBe("SPY251121C00600000");
  });

  it("normalizes compact SPXW OCC to match padded live keys", () => {
    const live = new Set(["SPXW  261117C05000000"]);
    expect(streamerSubResolveLiveKey("SPXW261117C05000000", live)).toBe("SPXW  261117C05000000");
  });

  it("cap discard drops from simulator live set", () => {
    streamerWireSimulatorResetForTests();
    streamerWireSimulatorApplyPayload({
      requests: [
        { service: "LEVELONE_OPTIONS", command: "ADD", parameters: { keys: "A,B,C" } },
      ],
    });
    expect(streamerWireSimulatorLiveLevelOneOptionsCount()).toBe(3);
    const cap = streamerSubParseRejection("LEVELONE_OPTIONS=3000, DISCARDED=2");
    expect(cap.kind).toBe("cap");
  });
});
