/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

describe("getStreamClientId", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    sessionStorage.clear();
  });

  it("returns the same id when sessionStorage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("sessionStorage blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("sessionStorage blocked");
    });

    const { getStreamClientId } = await import("../streamClientId");
    const first = getStreamClientId();
    const second = getStreamClientId();
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(8);
  });
});
