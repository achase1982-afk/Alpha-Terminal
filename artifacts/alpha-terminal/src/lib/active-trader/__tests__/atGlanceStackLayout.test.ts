import { describe, expect, it } from "vitest";
import { glanceStackOverlapPx, glanceStackOverlapsNext } from "../atGlanceStackLayout";

describe("glanceStackOverlapsNext", () => {
  it("allows flush stack with epsilon", () => {
    expect(glanceStackOverlapsNext(200, 200)).toBe(false);
    expect(glanceStackOverlapsNext(200.4, 200)).toBe(false);
    expect(glanceStackOverlapsNext(201, 200)).toBe(true);
  });

  it("measures overlap px", () => {
    expect(glanceStackOverlapPx(212, 200)).toBe(12);
    expect(glanceStackOverlapPx(199, 200)).toBe(0);
  });
});