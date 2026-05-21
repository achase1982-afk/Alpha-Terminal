import { describe, expect, it } from "vitest";
import {
  derivePolygonSnapshotSessionDateNy,
  resolveFlowRowSessionDateNy,
} from "../polygonSnapshotSessionDate.js";
import { parsePolygonSnapshotResultToFlowRow } from "../polygonSnapshotFlowIngest.js";

function etNs(y: number, m: number, d: number, hour: number, minute: number): bigint {
  const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isDst = m >= 3 && m <= 10;
  const off = isDst ? "-04:00" : "-05:00";
  const ms = new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`).getTime();
  return BigInt(ms) * 1_000_000n;
}

function minimalSnapshot(sipNs: bigint) {
  return {
    details: { contract_type: "call", strike_price: 100, expiration_date: "2026-06-20" },
    day: { volume: 1200, vwap: 4.5 },
    last_quote: { bid: 4.9, ask: 5.1, sip_timestamp: sipNs },
    last_trade: { price: 5, sip_timestamp: sipNs },
    open_interest: 800,
    implied_volatility: 0.35,
    greeks: { delta: 0.5 },
  };
}

describe("derivePolygonSnapshotSessionDateNy", () => {
  it("returns prior NY session date from last trade/quote SIP (not request day)", () => {
    const priorNs = etNs(2026, 5, 20, 16, 0);
    expect(derivePolygonSnapshotSessionDateNy(minimalSnapshot(priorNs))).toBe("2026-05-20");
  });

  it("returns current session date during regular hours", () => {
    const openNs = etNs(2026, 5, 21, 11, 0);
    expect(derivePolygonSnapshotSessionDateNy(minimalSnapshot(openNs))).toBe("2026-05-21");
  });

  it("returns null when no SIP timestamps are present", () => {
    expect(
      derivePolygonSnapshotSessionDateNy({
        details: { contract_type: "call", strike_price: 100, expiration_date: "2026-06-20" },
        day: { volume: 10 },
      }),
    ).toBeNull();
  });
});

describe("parsePolygonSnapshotResultToFlowRow", () => {
  it("stamps prior-session date when dateStr omitted (premarket prior-day snapshot)", () => {
    const priorNs = etNs(2026, 5, 20, 16, 0);
    const row = parsePolygonSnapshotResultToFlowRow(minimalSnapshot(priorNs), "AAPL", null);
    expect(row).not.toBeNull();
    expect(row!.date).toBe("2026-05-20");
    expect(row!.date).not.toBe("2026-05-21");
  });

  it("stamps open-session date when SIP is from the current trading day", () => {
    const openNs = etNs(2026, 5, 21, 10, 30);
    const row = parsePolygonSnapshotResultToFlowRow(minimalSnapshot(openNs), "AAPL", null);
    expect(row?.date).toBe("2026-05-21");
  });

  it("returns null when dateStr omitted and payload has no derivable SIP", () => {
    const row = parsePolygonSnapshotResultToFlowRow(
      {
        details: { contract_type: "put", strike_price: 50, expiration_date: "2026-07-18" },
        day: { volume: 5 },
      },
      "AAPL",
      null,
    );
    expect(row).toBeNull();
  });

  it("honors explicit dateStr override when scheduler passes a target session", () => {
    const priorNs = etNs(2026, 5, 20, 16, 0);
    const row = parsePolygonSnapshotResultToFlowRow(minimalSnapshot(priorNs), "AAPL", "2026-05-19");
    expect(row?.date).toBe("2026-05-19");
  });
});

describe("resolveFlowRowSessionDateNy", () => {
  it("prefers explicit session date over payload SIP", () => {
    const priorNs = etNs(2026, 5, 20, 16, 0);
    expect(resolveFlowRowSessionDateNy(minimalSnapshot(priorNs), "2026-05-18")).toBe("2026-05-18");
  });
});
