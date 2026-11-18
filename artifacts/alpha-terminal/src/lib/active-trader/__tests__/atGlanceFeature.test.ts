import { describe, expect, it, vi, afterEach } from "vitest";

describe("atGlanceFlowFixtureEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false in prod-like env without dev route", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_AT_GLANCE_FLOW_FIXTURE", "");
    vi.resetModules();
    const { atGlanceFlowFixtureEnabled } = await import("../atGlanceFeature");
    expect(atGlanceFlowFixtureEnabled()).toBe(false);
  });

  it("is true when VITE_AT_GLANCE_FLOW_FIXTURE=1", async () => {
    vi.stubEnv("VITE_AT_GLANCE_FLOW_FIXTURE", "1");
    vi.resetModules();
    const { atGlanceFlowFixtureEnabled } = await import("../atGlanceFeature");
    expect(atGlanceFlowFixtureEnabled()).toBe(true);
  });
});