import { describe, expect, it } from "vitest";
import { buildAtLadderGroups, buildExpirationGroups, type OptionsContract } from "@/components/OptionsTab";
import { atLadderLegKey } from "@/lib/active-trader/atLadderLegKeys";
import {
  formatAtExpiryPickerButton,
  formatAtExpiryPickerListRow,
  formatAtExpiryPill,
} from "@/lib/active-trader/atExpiryPill";
import { legsFromChainSelection } from "@/components/OptionsChainOrderSheet";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

const EXP = "2026-11-20";
const AM = "SPX   261120C07325000";
const PM = "SPXW  261120C07325000";

function call(symbol: string, bid: number, ask: number): OptionsContract {
  return { strike: 7325, expiration: EXP, dte: 1, bid, ask, schwabSymbol: symbol };
}

function expectBothSeries(calls: OptionsContract[]) {
  const chain = buildExpirationGroups(calls, [], 7320);
  const ladder = buildAtLadderGroups(calls, []);
  const keys = ["2026-11-20~SPX", "2026-11-20~SPXW"];
  expect(chain.map((g) => g.expiration)).toEqual(keys);
  expect(ladder.map((g) => g.expiration)).toEqual(keys);
  expect(chain.map((g) => g.dateLabel)).toEqual(["20 NOV 26 AM", "20 NOV 26 PM"]);

  const am = ladder[0]!;
  const pm = ladder[1]!;
  expect(am.rows[0]?.call?.schwabSymbol).toBe(AM);
  expect(pm.rows[0]?.call?.schwabSymbol).toBe(PM);
  expect(am.rows[0]?.call?.bid).toBe(calls.find((c) => c.schwabSymbol === AM)?.bid);
  expect(pm.rows[0]?.call?.ask).toBe(calls.find((c) => c.schwabSymbol === PM)?.ask);
  expect(formatAtExpiryPickerButton(am.expiration)).toBe("20 NOV AM ▾");
  expect(formatAtExpiryPickerButton(pm.expiration)).toBe("20 NOV PM \u25be");
  expect(formatAtExpiryPickerListRow(am.expiration, 1)).toBe("20 NOV 2026 · 1DTE · AM");
  expect(formatAtExpiryPickerListRow(pm.expiration, 1)).toBe("20 NOV 2026 · 1DTE · PM");
  expect(formatAtExpiryPill(am.expiration, 1)).toBe("20 NOV · 1D AM");
  expect(atLadderLegKey(am.rows[0]!.call!, "CALL")).toBe("2026-11-20~SPX|7325|CALL");
  expect(atLadderLegKey(pm.rows[0]!.call!, "CALL")).toBe("2026-11-20~SPXW|7325|CALL");
  return { am, pm };
}

describe("SPX AM and SPXW PM stay distinct", () => {
  it("keeps both contracts when the AM row is fed first", () => {
    const { pm } = expectBothSeries([call(AM, 1.25, 1.35), call(PM, 9.5, 9.7)]);
    const legs = legsFromChainSelection(
      [{
        key: atLadderLegKey(pm.rows[0]!.call!, "CALL"),
        contract: pm.rows[0]!.call!,
        type: "CALL",
        side: "ask",
      }],
      "SPX",
      [],
      buildSchwabOptionKey,
      null,
    );
    expect(legs[0]?.id).toBe("2026-11-20~SPXW|7325|CALL");
    expect(legs[0]?.schwabSymbol).toBe(PM);
    const rebuilt = legsFromChainSelection(
      [{
        key: "2026-11-20~SPXW|7325|CALL",
        contract: { strike: 7325, expiration: "2026-11-20~SPXW", bid: 9.5, ask: 9.7 },
        type: "CALL",
        side: "ask",
      }],
      "SPX",
      [],
      buildSchwabOptionKey,
      null,
    );
    expect(rebuilt[0]?.schwabSymbol).toBe(PM);
  });

  it("keeps both contracts when the PM row is fed first", () => {
    const { am } = expectBothSeries([call(PM, 9.5, 9.7), call(AM, 1.25, 1.35)]);
    const legs = legsFromChainSelection(
      [{
        key: atLadderLegKey(am.rows[0]!.call!, "CALL"),
        contract: am.rows[0]!.call!,
        type: "CALL",
        side: "ask",
      }],
      "SPX",
      [],
      buildSchwabOptionKey,
      null,
    );
    expect(legs[0]?.id).toBe("2026-11-20~SPX|7325|CALL");
    expect(legs[0]?.schwabSymbol).toBe(AM);
    expect(legs[0]?.ask).toBe(1.35);
  });

  it("omits AM/PM when the contract root is not known", () => {
    const groups = buildAtLadderGroups([{ strike: 7325, expiration: EXP, dte: 1, bid: 1, ask: 1.1 }], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.expiration).toBe(EXP);
    expect(groups[0]?.dateLabel).toBe("20 NOV 26");
    expect(formatAtExpiryPickerButton(groups[0]!.expiration)).toBe("20 NOV \u25be");
    expect(formatAtExpiryPickerListRow(EXP, 1)).toBe("20 NOV 2026 · 1DTE");
  });
});
