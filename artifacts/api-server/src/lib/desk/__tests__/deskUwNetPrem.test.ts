import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deskFilterTicksSince,
  deskParseTapeTimeMs,
  deskRefreshNetPremTicks,
  deskResetNetPremCacheForTests,
} from "../deskUwNetPrem.js";
import { deskParseSinceMs } from "../deskUwInput.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = () =>
  JSON.parse(readFileSync(join(here, "fixtures", "uw-net-prem-ticks.json"), "utf8")) as {
    data: unknown[];
  };

vi.mock("../deskUwHttp.js", () => ({
  deskUwGet: vi.fn(),
}));

vi.mock("../deskUnusualWhales.js", () => ({
  getUwApiKey: () => "test-key",
}));

describe("deskUwNetPrem", () => {
  beforeEach(() => {
    deskResetNetPremCacheForTests();
    vi.resetAllMocks();
  });

  it("parses UW tape_time strings", () => {
    expect(deskParseTapeTimeMs("2025-03-21 19:58:00+00:00")).toBe(
      Date.parse("2025-03-21T19:58:00+00:00"),
    );
  });

  it("deskParseSinceMs rejects garbage and out-of-range values", () => {
    expect(deskParseSinceMs("not-a-date").ok).toBe(false);
    expect(deskParseSinceMs("1700000000000").ok).toBe(true);
    expect(deskParseSinceMs("631152000000").ok).toBe(false);
  });

  it("fetches with date= only and filters since locally", async () => {
    const { deskUwGet } = await import("../deskUwHttp.js");
    vi.mocked(deskUwGet).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: fixture(),
      asOfMs: 1_700_000_000_100,
    });
    await deskRefreshNetPremTicks("SPX", "2025-03-21");
    const url = vi.mocked(deskUwGet).mock.calls[0]?.[0] ?? "";
    expect(url).toContain("net-prem-ticks?date=2025-03-21");
    expect(url).not.toContain("since=");
    const sinceMs = Date.parse("2025-03-21T19:58:30.000000Z");
    const rows = fixture().data;
    expect(deskFilterTicksSince(rows, sinceMs)).toHaveLength(1);
  });
});