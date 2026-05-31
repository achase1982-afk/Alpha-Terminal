import { describe, it, expect } from "vitest";
import { fetchStrategistSympathyPeers } from "../strategistSectorPeersService.js";

describe("fetchStrategistSympathyPeers", () => {
  it("returns FMP peer tickers for a liquid symbol when API key is set", async () => {
    if (!process.env.FMP_API_KEY?.trim()) {
      return;
    }
    const peers = await fetchStrategistSympathyPeers("DELL");
    expect(peers.length).toBeGreaterThan(0);
    expect(peers.every((p) => /^[A-Z]{1,5}$/.test(p))).toBe(true);
    expect(peers).not.toContain("DELL");
    expect(peers).not.toContain("MSTR");
    expect(peers.some((p) => ["HPQ", "HPE", "STX", "WDC", "SMCI"].includes(p))).toBe(true);
  });
});
