import { describe, expect, it, vi, afterEach } from "vitest";

describe("atGlanceTopEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults on unless VITE_AT_GLANCE_TOP=0", async () => {
    vi.stubEnv("VITE_AT_GLANCE_TOP", "");
    vi.resetModules();
    const { atGlanceTopEnabled } = await import("../atGlanceFeature");
    expect(atGlanceTopEnabled()).toBe(true);
    vi.stubEnv("VITE_AT_GLANCE_TOP", "0");
    vi.resetModules();
    const off = await import("../atGlanceFeature");
    expect(off.atGlanceTopEnabled()).toBe(false);
  });
});

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