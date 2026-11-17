import { describe, expect, it } from "vitest";
import { deskStreamerSyncDeskSymbols } from "../deskStreamerDeskSync.js";

describe("deskStreamerSyncDeskSymbols (streamer wiring)", () => {
  it("excludes app SPX chain symbols from desk candidates and never UNSUBS them", () => {
    const app = new Set(["OPT_A", "OPT_B"]);
    const currentDesk = new Set(["OPT_A", "DESK_1", "DESK_2"]);
    const sync = deskStreamerSyncDeskSymbols(
      currentDesk,
      ["OPT_A", "OPT_B", "DESK_1", "DESK_3"],
      10,
      app,
    );
    expect(sync.yieldToApp).toEqual(["OPT_A"]);
    expect(sync.unsub).not.toContain("OPT_A");
    expect(sync.unsub).not.toContain("OPT_B");
    expect(sync.next).toEqual(["DESK_1", "DESK_3"]);
    expect(sync.unsub.sort()).toEqual(["DESK_2"]);
    expect(sync.add).toEqual(["DESK_3"]);
  });

  it("when app adds a symbol desk already held, desk yields without UNSUB", () => {
    const app = new Set<string>();
    let currentDesk = new Set(["ROLL_OLD", "KEEP"]);
    let sync = deskStreamerSyncDeskSymbols(currentDesk, ["KEEP", "ROLL_NEW"], 10, app);
    expect(sync.unsub).toEqual(["ROLL_OLD"]);
    expect(sync.add).toEqual(["ROLL_NEW"]);

    app.add("ROLL_OLD");
    currentDesk = new Set(["ROLL_OLD", "KEEP"]);
    sync = deskStreamerSyncDeskSymbols(currentDesk, ["KEEP", "ROLL_NEW"], 10, app);
    expect(sync.unsub).toEqual([]);
    expect(sync.yieldToApp).toContain("ROLL_OLD");
    expect(sync.next).toEqual(["KEEP", "ROLL_NEW"]);
  });

  it("shrinks desk when budget drops because app claimed book slots", () => {
    const app = new Set(["APP_B1", "APP_B2", "APP_B3"]);
    const current = new Set(["D1", "D2", "D3", "D4"]);
    const sync = deskStreamerSyncDeskSymbols(current, ["D1", "D2", "D3", "D4"], 2, app);
    expect(sync.next).toEqual(["D1", "D2"]);
    expect(sync.unsub.sort()).toEqual(["D3", "D4"]);
  });
});