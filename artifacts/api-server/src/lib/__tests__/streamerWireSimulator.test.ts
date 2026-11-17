import { describe, expect, it, beforeEach } from "vitest";
import {
  streamerWireSimulatorApplyPayload,
  streamerWireSimulatorDeskLevelOneKeysOnWire,
  streamerWireSimulatorLiveLevelOneOptionsCount,
  streamerWireSimulatorResetForTests,
} from "../streamerWireSimulator.js";

describe("streamerWireSimulator", () => {
  beforeEach(() => streamerWireSimulatorResetForTests());

  it("SUBS replaces app list and clears desk until ADD", () => {
    streamerWireSimulatorApplyPayload({
      requests: [{ service: "LEVELONE_OPTIONS", command: "ADD", parameters: { keys: "D1,D2" } }],
    });
    expect(streamerWireSimulatorDeskLevelOneKeysOnWire().size).toBe(2);
    streamerWireSimulatorApplyPayload({
      requests: [{ service: "LEVELONE_OPTIONS", command: "SUBS", parameters: { keys: "A1,A2" } }],
    });
    expect(streamerWireSimulatorDeskLevelOneKeysOnWire().size).toBe(0);
    expect(streamerWireSimulatorLiveLevelOneOptionsCount()).toBe(2);
    streamerWireSimulatorApplyPayload({
      requests: [{ service: "LEVELONE_OPTIONS", command: "ADD", parameters: { keys: "D1,D2" } }],
    });
    expect(streamerWireSimulatorLiveLevelOneOptionsCount()).toBe(4);
    expect(streamerWireSimulatorDeskLevelOneKeysOnWire().has("D1")).toBe(true);
  });
});