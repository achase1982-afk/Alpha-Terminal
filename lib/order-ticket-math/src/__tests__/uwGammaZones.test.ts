import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeZonesFromUwGamma0dte,
  parseUwGammaAmount,
  parseUwStrikeRow,
} from "../uwGammaZones.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(readFileSync(join(here, "fixtures", "uw-spx-gamma-0dte-2026-11-17.json"), "utf8")) as {
    data: unknown[];
  };

describe("uwGammaZones", () => {
  it("parses string gamma amounts (no concat)", () => {
    expect(parseUwGammaAmount("382000000")).toBe(382_000_000);
    expect(parseUwGammaAmount("-7270000000")).toBe(-7_270_000_000);
    const row = parseUwStrikeRow({ strike: "7340", call_gamma_oi: "382000000", put_gamma_oi: "-7270000000" });
    expect(row?.callGammaOi + row!.putGammaOi).toBe(-6_888_000_000);
  });

  it("derives SPX 0DTE zones from each field, and leaves flip unset when cumulative gamma stays negative", () => {
    const rows = fixture().data;
    const zones = computeZonesFromUwGamma0dte(rows, { spot: 7340, asOfLabel: "4:15 PM" });
    expect(zones.callWall).toBe(7340);
    expect(zones.putWall).toBe(7340);
    expect(zones.flip).toBeNull();
    expect(zones.netGexUsdPer1Pct).toBeLessThan(0);
    const netB = (zones.netGexUsdPer1Pct ?? 0) / 1e9;
    expect(netB).toBeLessThan(-10);
    expect(netB).toBeGreaterThan(-25);
  });

  it("keeps the newest row per strike and ranks call and put on their own absolute gamma", () => {
    const older = "2026-11-20T16:00:00.000Z";
    const newer = "2026-11-20T17:58:00.000Z";
    const zones = computeZonesFromUwGamma0dte(
      [
        { strike: 7200, call_gamma_oi: "10", put_gamma_oi: "-999", call_gamma_vol: "1", put_gamma_vol: "1", time: older },
        { strike: 7000, call_gamma_oi: "10", put_gamma_oi: "-10", call_gamma_vol: "1", put_gamma_vol: "1", time: older },
        { strike: 6950, call_gamma_oi: "-50", put_gamma_oi: "-400", call_gamma_vol: "5", put_gamma_vol: "20", time: newer },
        { strike: 7000, call_gamma_oi: "500", put_gamma_oi: "-800", call_gamma_vol: "40", put_gamma_vol: "900", time: newer },
        { strike: 7100, call_gamma_oi: "80", put_gamma_oi: "-100", call_gamma_vol: "700", put_gamma_vol: "30", time: newer },
        { strike: 7200, call_gamma_oi: "40", put_gamma_oi: "-200", call_gamma_vol: "10", put_gamma_vol: "50", time: newer },
        { strike: 7250, call_gamma_oi: "-20", put_gamma_oi: "-150", call_gamma_vol: "8", put_gamma_vol: "40", time: newer },
        { strike: 7410, call_gamma_oi: "30", put_gamma_oi: "-5", call_gamma_vol: "3", put_gamma_vol: "2", time: newer },
        { strike: 7200, call_gamma_oi: "1", put_gamma_oi: "-5000", call_gamma_vol: "1", put_gamma_vol: "1" },
      ],
      { spot: 7100 },
    );
    expect(zones.callWall).toBe(7000);
    expect(zones.putWall).toBe(7000);
    expect(zones.callWallVol).toBe(7100);
    expect(zones.putWallVol).toBe(7000);
    expect(zones.flip).toBeNull();
  });

  it("ranks a negative call print by absolute size, on the call field only", () => {
    const zones = computeZonesFromUwGamma0dte([
      { strike: 6900, call_gamma_oi: "-900", put_gamma_oi: "-1" },
      { strike: 7000, call_gamma_oi: "100", put_gamma_oi: "-50" },
    ]);
    expect(zones.callWall).toBe(6900);
    expect(zones.putWall).toBe(7000);
    expect(zones.flip).toBeNull();
  });

  it("reports the strike where cumulative net gamma crosses zero", () => {
    const zones = computeZonesFromUwGamma0dte([
      { strike: 7000, call_gamma_oi: "10", put_gamma_oi: "-100" },
      { strike: 7100, call_gamma_oi: "200", put_gamma_oi: "-10" },
    ]);
    expect(zones.callWall).toBe(7100);
    expect(zones.putWall).toBe(7000);
    expect(zones.flip).toBe(7100);
  });
});