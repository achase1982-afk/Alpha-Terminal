import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FmpMoverRow } from "../fmpMoversClient.js";
import { stripMover } from "../stripMover.js";
import { applyStage1Strip } from "../buildMoversFeed.js";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "__fixtures__",
  "biggest-gainers.json",
);

function loadFixture(): FmpMoverRow[] {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>[];
  return raw.map((row) => ({
    symbol: String(row["symbol"]).toUpperCase(),
    name: String(row["name"]),
    price: Number(row["price"]),
    change: Number(row["change"] ?? 0),
    changesPercentage: Number(row["changesPercentage"] ?? 0),
    exchange: String(row["exchange"] ?? ""),
  }));
}

describe("stripMover", () => {
  it("strips leveraged ETFs, sub-$5 names, and keeps survivors on the 49-row gainers fixture", () => {
    const rows = loadFixture();
    expect(rows).toHaveLength(49);

    let leveraged = 0;
    let sub5 = 0;
    let kept = 0;

    for (const row of rows) {
      const verdict = stripMover({ name: row.name, price: row.price });
      if (verdict.reason === "LEVERAGED_ETF") leveraged += 1;
      else if (verdict.reason === "SUB_5") sub5 += 1;
      else if (verdict.keep) kept += 1;
    }

    expect(leveraged).toBe(4);
    expect(sub5).toBe(29);
    expect(kept).toBe(16);
    expect(leveraged + sub5 + kept).toBe(49);
  });

  it("classifies known leveraged issuers and tokens", () => {
    expect(stripMover({ name: "GraniteShares 2x Long DELL Daily ETF", price: 100 })).toEqual({
      keep: false,
      reason: "LEVERAGED_ETF",
    });
    expect(stripMover({ name: "Daily Target 2X Long RGTI ETF", price: 40 })).toEqual({
      keep: false,
      reason: "LEVERAGED_ETF",
    });
    expect(stripMover({ name: "Hyliion Holdings Corp.", price: 5.99 })).toEqual({ keep: true });
    expect(stripMover({ name: "Penny Co", price: 4.99 })).toEqual({ keep: false, reason: "SUB_5" });
  });

  it("applyStage1Strip counts survivors before enrichment", () => {
    const { survivors, filtered } = applyStage1Strip(loadFixture());
    expect(survivors).toHaveLength(16);
    expect(filtered).toHaveLength(33);
  });
});
