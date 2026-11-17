import { describe, expect, it } from "vitest";
import {
  wireCommandsForDeskOptions,
  wireCommandsForDeskOptionsBook,
  wireCommandsReplayDeskEquities,
  wireCommandsReplayAllDesk,
} from "../deskStreamerDeskWire.js";

describe("deskStreamerDeskWire", () => {
  it("app holds symbol: no UNSUBS for overlap; desk plan excludes app keys", () => {
    const app = new Set(["SHARED", "APP_ONLY"]);
    const desk = new Set(["SHARED", "DESK_ONLY"]);
    const { commands, nextDesk } = wireCommandsForDeskOptions(
      ["SHARED", "APP_ONLY", "DESK_ONLY", "NEW"],
      desk,
      app,
      10,
    );
    const unsubs = commands.filter((c) => c.command === "UNSUBS").flatMap((c) => c.keys);
    expect(unsubs).not.toContain("SHARED");
    expect(unsubs).not.toContain("APP_ONLY");
    expect(nextDesk).not.toContain("SHARED");
    expect(nextDesk).not.toContain("APP_ONLY");
    expect(commands.some((c) => c.command === "ADD" && c.keys.includes("NEW"))).toBe(true);
  });

  it("universe roll: UNSUBS rolled desk symbol not held by app", () => {
    const app = new Set<string>();
    const desk = new Set(["OLD", "KEEP"]);
    const { commands } = wireCommandsForDeskOptions(["KEEP", "FRESH"], desk, app, 10);
    expect(commands).toContainEqual({
      service: "LEVELONE_OPTIONS",
      command: "UNSUBS",
      keys: ["OLD"],
    });
  });

  it("app adds symbol desk held: overlap case yields without UNSUB", () => {
    const app = new Set(["TAKEN"]);
    const desk = new Set(["TAKEN", "OTHER"]);
    const { commands } = wireCommandsForDeskOptionsBook(["OTHER", "B_NEW"], desk, app, 5);
    expect(commands.filter((c) => c.command === "UNSUBS")).toHaveLength(0);
  });

  it("after app re-sends SUBS: equity replay ADD restores desk set", () => {
    const replay = wireCommandsReplayDeskEquities(["$SPX", "SPY"]);
    expect(replay).toEqual([
      { service: "LEVELONE_EQUITIES", command: "ADD", keys: ["$SPX", "SPY"] },
    ]);
  });

  it("login replay emits one ADD per desk service", () => {
    const all = wireCommandsReplayAllDesk({
      equities: ["$SPX"],
      leveloneOptions: ["O1"],
      optionsBook: ["B1"],
    });
    expect(all).toHaveLength(3);
    expect(all.every((c) => c.command === "ADD")).toBe(true);
  });
});
