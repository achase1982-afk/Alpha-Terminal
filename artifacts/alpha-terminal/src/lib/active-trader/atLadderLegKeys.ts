import type { OptionsContract } from "@/components/OptionsTab";

export const AT_MAX_LADDER_LEGS = 4;

export type AtLadderLegPick = {
  contract: OptionsContract;
  type: "CALL" | "PUT";
  expiration: string;
  side: "bid" | "ask";
};

export function atLadderLegKey(contract: OptionsContract, type: "CALL" | "PUT"): string {
  return `${contract.expiration}|${contract.strike}|${type}`;
}

export function atLadderQuoteCellKey(
  contract: OptionsContract,
  type: "CALL" | "PUT",
  quoteSide: "bid" | "ask",
): string {
  return `${atLadderLegKey(contract, type)}|${quoteSide}`;
}

/** Signed display qty for ladder cell: +N buy / −N sell (open). */
export function atSignedLegQty(side: "bid" | "ask", qty: number): string {
  const n = Math.max(1, qty);
  return side === "ask" ? `+${n}` : `−${n}`;
}

export function quoteSideFromTap(side: "BUY" | "SELL"): "bid" | "ask" {
  return side === "SELL" ? "bid" : "ask";
}