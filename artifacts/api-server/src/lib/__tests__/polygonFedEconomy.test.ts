import { describe, expect, it } from "vitest";
import {
  buildCpiMonthsFromFedInflation,
  monthKeyFromBlsPeriod,
  monthKeyFromFedDate,
} from "../polygonFedEconomy.js";

describe("polygonFedEconomy", () => {
  it("maps fed dates to month keys", () => {
    expect(monthKeyFromFedDate("2026-04-01")).toBe("2026-04");
    expect(monthKeyFromBlsPeriod("March", "2026")).toBe("2026-03");
  });

  it("builds CPI MoM from consecutive index levels", () => {
    const byMonth = buildCpiMonthsFromFedInflation([
      { date: "2026-04-01", cpi: 332.407, cpi_core: 335.423 },
      { date: "2026-03-01", cpi: 330.293, cpi_core: 334.165 },
      { date: "2026-02-01", cpi: 327.46, cpi_core: 333.512 },
    ]);
    const april = byMonth["2026-04"];
    expect(april?.headline?.actual).toMatch(/^\+/);
    expect(april?.headline?.source).toBe("massive");
    expect(april?.core?.source).toBe("massive");
  });
});
