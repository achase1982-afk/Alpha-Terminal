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

  it("derives SPX 0DTE zones: flip ~7290, walls 7340, net ~ −$14.4B scale", () => {
    const rows = fixture().data;
    const zones = computeZonesFromUwGamma0dte(rows, { spot: 7340, asOfLabel: "4:15 PM" });
    expect(zones.callWall).toBe(7340);
    expect(zones.putWall).toBe(7340);
    expect(zones.flip).toBeGreaterThanOrEqual(7285);
    expect(zones.flip).toBeLessThanOrEqual(7295);
    expect(zones.netGexUsdPer1Pct).toBeLessThan(0);
    const netB = (zones.netGexUsdPer1Pct ?? 0) / 1e9;
    expect(netB).toBeLessThan(-10);
    expect(netB).toBeGreaterThan(-25);
  });
});