import { describe, expect, it } from "vitest";
import { pickSpotColor } from "../atSpotDirection";
import { DOWN, UP, WHITE } from "@/components/options/optionsTheme";

describe("pickSpotColor", () => {
  it("returns white when flat", () => {
    expect(pickSpotColor(100, 100, "flat")).toBe(WHITE);
  });
  it("uses hold direction", () => {
    expect(pickSpotColor(101, 100, "up")).toBe(UP);
    expect(pickSpotColor(99, 100, "down")).toBe(DOWN);
  });
});