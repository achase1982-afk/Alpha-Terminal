import { describe, expect, it } from "vitest";
import {
  sortChainKeysNearTheMoneyInterleaved,
  sortOptionKeysNearTheMoney,
} from "../streamerSubPlanSort.js";

function occSpy(strike: number, exp = "251121", type: "C" | "P" = "C"): string {
  const root = "SPY   ";
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${root}${exp}${type}${strikePadded}`;
}

describe("streamerSubPlanSort", () => {
  it("orders SPY chain at spot 600 with 600 ATM first", () => {
    const keys = [occSpy(610), occSpy(590), occSpy(600), occSpy(605), occSpy(595)];
    const ordered = sortOptionKeysNearTheMoney(keys, 600);
    expect(ordered[0]).toBe(occSpy(600));
    expect(ordered.slice(0, 3)).toEqual(
      expect.arrayContaining([occSpy(600), occSpy(595), occSpy(605)].map(String)),
    );
  });

  it("interleaves nearest expiries after strike sort", () => {
    const keys = [occSpy(600, "251121"), occSpy(600, "251128"), occSpy(590, "251121")];
    const ordered = sortChainKeysNearTheMoneyInterleaved(keys, 600);
    expect(ordered[0]).toBe(occSpy(600, "251121"));
    expect(ordered.length).toBe(3);
  });
});
