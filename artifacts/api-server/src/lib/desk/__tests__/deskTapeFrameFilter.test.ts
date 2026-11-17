import { describe, expect, it } from "vitest";
import {
  filterDeskTapeStreamerMessage,
  messageContainsAcctActivity,
} from "../deskTapeFrameFilter.js";

describe("deskTapeFrameFilter", () => {
  it("drops ACCT_ACTIVITY entirely", () => {
    const msg = {
      data: [
        {
          service: "ACCT_ACTIVITY",
          content: [{ key: "ORDERS", msg: "secret" }],
        },
      ],
    };
    expect(messageContainsAcctActivity(msg)).toBe(true);
    expect(filterDeskTapeStreamerMessage(msg)).toBeNull();
  });

  it("keeps desk equities and SPX options only", () => {
    const msg = {
      data: [
        {
          service: "LEVELONE_EQUITIES",
          content: [{ key: "$SPX", 3: 6000 }, { key: "AAPL", 3: 200 }],
        },
        {
          service: "LEVELONE_OPTIONS",
          content: [
            { key: "SPX   251117C00600000" },
            { key: "SPY   251117C00400000" },
          ],
        },
        { service: "NASDAQ_BOOK", content: [{ key: "SPY" }] },
      ],
    };
    const out = filterDeskTapeStreamerMessage(msg);
    expect(out).not.toBeNull();
    const data = (out as { data: Array<{ service: string; content: unknown[] }> }).data;
    expect(data.map((d) => d.service)).toEqual(["LEVELONE_EQUITIES", "LEVELONE_OPTIONS"]);
    expect(data[0]!.content).toHaveLength(1);
    expect((data[0]!.content[0] as { key: string }).key).toBe("$SPX");
    expect(data[1]!.content).toHaveLength(1);
  });

  it("never passes ACCT_ACTIVITY through filter used by tape capture", () => {
    const acct = {
      data: [
        { service: "ACCT_ACTIVITY", content: [{ key: "ORDERS", 1: "fill" }] },
        {
          service: "LEVELONE_OPTIONS",
          content: [{ key: "SPXW  251117C00600000" }],
        },
      ],
    };
    const out = filterDeskTapeStreamerMessage(acct);
    expect(out).not.toBeNull();
    expect(messageContainsAcctActivity(out as Record<string, unknown>)).toBe(false);
    const services = (out as { data: Array<{ service: string }> }).data.map((d) => d.service);
    expect(services).not.toContain("ACCT_ACTIVITY");
  });

  it("returns null when nothing allowed remains", () => {
    expect(
      filterDeskTapeStreamerMessage({
        data: [{ service: "LEVELONE_FUTURES", content: [{ key: "/ES" }] }],
      }),
    ).toBeNull();
  });
});