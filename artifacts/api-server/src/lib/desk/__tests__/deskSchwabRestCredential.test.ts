import { describe, expect, it } from "vitest";
import { deskSchwabRestAppFromDeskSource } from "../deskSchwabRestApp.js";

describe("deskSchwabRestAppFromDeskSource", () => {
  it("uses app1 only for source=schwab", () => {
    expect(deskSchwabRestAppFromDeskSource("schwab")).toBe("app1");
  });

  it("uses app2 for schwab2 and other desk schwab sources", () => {
    expect(deskSchwabRestAppFromDeskSource("schwab2")).toBe("app2");
  });
});