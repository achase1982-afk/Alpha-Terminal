import { describe, expect, it } from "vitest";
import { parseLevelsQuery } from "../runtimeLogsQuery.js";

describe("parseLevelsQuery", () => {
  it("defaults to ERROR and WARN", () => {
    expect(parseLevelsQuery()).toEqual(["ERROR", "WARN"]);
  });

  it("parses custom levels and drops invalid entries", () => {
    expect(parseLevelsQuery("ERROR,INFO,BOGUS")).toEqual(["ERROR", "INFO"]);
  });

  it("falls back when filter would be empty", () => {
    expect(parseLevelsQuery("bogus")).toEqual(["ERROR", "WARN"]);
  });
});