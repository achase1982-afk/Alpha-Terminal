import { describe, expect, it } from "vitest";
import { buildOptionsFlowDatasetTag, classifyOrigin } from "../datasetFreshness.js";
import { getMarketContext, US_EQUITY_SESSION_TIME_ZONE } from "../getMarketContext.js";

function etInstant(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
): Date {
  const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isDst = m >= 3 && m <= 10;
  const off = isDst ? "-04:00" : "-05:00";
  return new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`);
}

describe("getMarketContext", () => {
  it("resolves PREMARKET at 7:54 AM ET with optionsLive false", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 21, 7, 54));
    expect(ctx.session).toBe("PREMARKET");
    expect(ctx.optionsLive).toBe(false);
    expect(ctx.tradingDate).toBe("2026-05-21");
    expect(ctx.localLabel).toMatch(/May 21, 2026/i);
    expect(ctx.localLabel).toMatch(/7:54/);
  });

  it("resolves OPEN during regular hours", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 21, 10, 30));
    expect(ctx.session).toBe("OPEN");
    expect(ctx.optionsLive).toBe(true);
  });

  it("resolves AFTERHOURS", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 21, 17, 0));
    expect(ctx.session).toBe("AFTERHOURS");
    expect(ctx.optionsLive).toBe(false);
  });

  it("resolves CLOSED overnight", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 21, 22, 0));
    expect(ctx.session).toBe("CLOSED");
    expect(ctx.optionsLive).toBe(false);
  });

  it("resolves CLOSED on weekend", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 23, 12, 0));
    expect(ctx.session).toBe("CLOSED");
  });

  it("resolves CLOSED on NYSE holiday", () => {
    const ctx = getMarketContext(etInstant(2026, 1, 1, 12, 0));
    expect(ctx.session).toBe("CLOSED");
  });

  it("uses EST in January and EDT in July for the same clock time", () => {
    const est = getMarketContext(etInstant(2026, 1, 15, 10, 0));
    const edt = getMarketContext(etInstant(2026, 7, 15, 10, 0));
    expect(est.session).toBe("OPEN");
    expect(edt.session).toBe("OPEN");
    expect(est.localLabel).toMatch(/Jan 15, 2026/i);
    expect(edt.localLabel).toMatch(/Jul 15, 2026/i);
  });

  it("early-close day: OPEN ends 13:00 ET, optionsLive false while cash OPEN", () => {
    const open = getMarketContext(etInstant(2026, 11, 27, 12, 0));
    expect(open.session).toBe("OPEN");
    expect(open.optionsLive).toBe(false);
    const after = getMarketContext(etInstant(2026, 11, 27, 14, 0));
    expect(after.session).toBe("AFTERHOURS");
  });
});

describe("classifyOrigin", () => {
  it("labels prior-session flow before today's open", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 21, 7, 54));
    expect(classifyOrigin("2026-05-20", ctx)).toBe("PRIOR_SESSION");
  });

  it("labels stale data older than prior trading day", () => {
    const ctx = getMarketContext(etInstant(2026, 5, 21, 7, 54));
    expect(classifyOrigin("2026-05-10", ctx)).toBe("STALE");
  });
});

describe("buildOptionsFlowDatasetTag", () => {
  it("tags PRIOR_SESSION when provider asOf is the prior trading day", () => {
    const now = etInstant(2026, 5, 21, 7, 54);
    const ctx = getMarketContext(now);
    const tag = buildOptionsFlowDatasetTag("2026-05-20", ctx);
    expect(tag).toContain("origin: PRIOR_SESSION");
    expect(tag).toContain("asOf: 2026-05-20");
    expect(tag).not.toContain(ctx.now.slice(0, 10));
  });
});

describe("getMarketContext client display zone", () => {
  it("uses hardcoded NY for session math; client timeZone affects display label only", () => {
    const now = etInstant(2026, 5, 21, 7, 54);
    const ny = getMarketContext(now, US_EQUITY_SESSION_TIME_ZONE);
    const tokyo = getMarketContext(now, "Asia/Tokyo");

    expect(ny.session).toBe(tokyo.session);
    expect(ny.tradingDate).toBe(tokyo.tradingDate);
    expect(ny.optionsLive).toBe(tokyo.optionsLive);
    expect(tokyo.localLabel).not.toBe(ny.localLabel);
  });
});
