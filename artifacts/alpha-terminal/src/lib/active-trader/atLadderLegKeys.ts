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

export function quoteSideFromTap(side: "BUY" | "SELL"): "bid" | "ask" {
  return side === "SELL" ? "bid" : "ask";
}