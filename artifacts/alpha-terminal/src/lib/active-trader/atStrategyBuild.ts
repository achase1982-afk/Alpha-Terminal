import type { OptionsContract } from "@/components/OptionsTab";
import type { AtStrategyBuild, AtVerticalWidth } from "./activeTraderPrefs";
import { atLadderLegKey, type AtLadderLegPick } from "./atLadderLegKeys";

type StrikeRow = {
  strike: number;
  call: OptionsContract | null;
  put: OptionsContract | null;
};

export type AtStrategyTap = {
  contract: OptionsContract;
  type: "CALL" | "PUT";
  side: "BUY" | "SELL";
  strike: number;
};

function rowForStrike(rows: Map<number, StrikeRow>, strike: number): StrikeRow | null {
  const direct = rows.get(strike);
  if (direct) return direct;
  let best: StrikeRow | null = null;
  let bestDist = 0.02;
  for (const row of rows.values()) {
    const dist = Math.abs(row.strike - strike);
    if (dist < bestDist) {
      best = row;
      bestDist = dist;
    }
  }
  return best;
}

function contractAt(
  rows: Map<number, StrikeRow>,
  strike: number,
  type: "CALL" | "PUT",
  anchorStrike: number,
  anchorType: "CALL" | "PUT",
  anchor: OptionsContract,
): OptionsContract | null {
  if (Math.abs(strike - anchorStrike) < 0.02 && type === anchorType) return anchor;
  const row = rowForStrike(rows, strike);
  if (!row) return null;
  return type === "CALL" ? row.call : row.put;
}

/**
 * Legs for one tap while a strategy default is on.
 * Returns null when a wing is not on the loaded ladder, so the tap can fall
 * back to selecting that single cell.
 */
export function buildAtStrategyLegs(args: {
  strategy: Exclude<AtStrategyBuild, "off">;
  anchorStrike: number;
  type: "CALL" | "PUT";
  width: AtVerticalWidth | number;
  nearContract: OptionsContract;
  rowByStrike: Map<number, StrikeRow>;
  prevQty: Map<string, number>;
}): { legs: Map<string, AtLadderLegPick>; qty: Map<string, number> } | null {
  const { strategy, anchorStrike, type, width, nearContract, rowByStrike, prevQty } = args;
  const slots: { strike: number; type: "CALL" | "PUT"; side: "bid" | "ask" }[] = [];

  if (strategy === "credit-spread" || strategy === "debit-spread") {
    const farStrike = type === "CALL" ? anchorStrike + width : anchorStrike - width;
    const credit = strategy === "credit-spread";
    slots.push(
      { strike: anchorStrike, type, side: credit ? "bid" : "ask" },
      { strike: farStrike, type, side: credit ? "ask" : "bid" },
    );
  } else if (type === "CALL") {
    slots.push(
      { strike: anchorStrike - width * 2, type: "PUT", side: "ask" },
      { strike: anchorStrike - width, type: "PUT", side: "bid" },
      { strike: anchorStrike, type: "CALL", side: "bid" },
      { strike: anchorStrike + width, type: "CALL", side: "ask" },
    );
  } else {
    slots.push(
      { strike: anchorStrike - width, type: "PUT", side: "ask" },
      { strike: anchorStrike, type: "PUT", side: "bid" },
      { strike: anchorStrike + width, type: "CALL", side: "bid" },
      { strike: anchorStrike + width * 2, type: "CALL", side: "ask" },
    );
  }

  const legs = new Map<string, AtLadderLegPick>();
  const qty = new Map<string, number>();
  for (const slot of slots) {
    const contract = contractAt(rowByStrike, slot.strike, slot.type, anchorStrike, type, nearContract);
    if (!contract) return null;
    const key = atLadderLegKey(contract, slot.type);
    legs.set(key, {
      contract,
      type: slot.type,
      expiration: contract.expiration,
      side: slot.side,
    });
    qty.set(key, prevQty.get(key) ?? 1);
  }
  return legs.size > 0 ? { legs, qty } : null;
}
