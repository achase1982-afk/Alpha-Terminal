/** One eligible options print for ladder premium heat (Felix contract). */
export type AtLadderOptionPrint = {
  /** Canonical contract id (stream / OCC key). */
  contract: string;
  px: number;
  qty: number;
  ts_ms: number;
  seq: string | number;
  cancel?: boolean;
};

export const AT_LADDER_HEAT_WINDOW_MS = 30_000;

export function ladderPrintPremiumUsd(print: Pick<AtLadderOptionPrint, "px" | "qty">, multiplier: number): number {
  if (!(print.px > 0) || !(print.qty > 0) || !(multiplier > 0)) return 0;
  return print.px * print.qty * multiplier;
}