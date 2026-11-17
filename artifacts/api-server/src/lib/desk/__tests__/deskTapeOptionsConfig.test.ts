import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { deskTapeOptionsMax, deskTapeOptionsExpiries, deskCalendarDaysFromSession } from "../deskTapeOptionsConfig.js";

describe("deskTapeOptionsConfig", () => {
  const prevMax = process.env.DESK_TAPE_OPTIONS_MAX;
  const prevExp = process.env.DESK_TAPE_OPTIONS_EXPIRIES;

  beforeEach(() => {
    delete process.env.DESK_TAPE_OPTIONS_MAX;
    delete process.env.DESK_TAPE_OPTIONS_EXPIRIES;
  });

  afterEach(() => {
    if (prevMax === undefined) delete process.env.DESK_TAPE_OPTIONS_MAX;
    else process.env.DESK_TAPE_OPTIONS_MAX = prevMax;
    if (prevExp === undefined) delete process.env.DESK_TAPE_OPTIONS_EXPIRIES;
    else process.env.DESK_TAPE_OPTIONS_EXPIRIES = prevExp;
  });

  it("defaults max to 15000", () => {
    expect(deskTapeOptionsMax()).toBe(15_000);
  });

  it("parses explicit expiry list", () => {
    process.env.DESK_TAPE_OPTIONS_EXPIRIES = "2026-11-17,2026-11-18";
    expect(deskTapeOptionsExpiries()).toEqual(["2026-11-17", "2026-11-18"]);
  });

  it("returns 7 calendar days by default", () => {
    const days = deskTapeOptionsExpiries();
    expect(days.length).toBe(7);
    expect(days[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("deskCalendarDaysFromSession advances dates", () => {
    const anchor = new Date("2026-11-17T15:00:00.000Z");
    const list = deskCalendarDaysFromSession(3, anchor);
    expect(list).toHaveLength(3);
  });
});