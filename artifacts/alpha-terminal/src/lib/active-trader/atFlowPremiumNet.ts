/** Classified premium net: CB − CS − PB + PS (positive = bullish premium). */
export function flowPremiumNet(cb: number, cs: number, pb: number, ps: number): number {
  return cb - cs - pb + ps;
}

export type FlowPremiumNetSign = "bullish" | "bearish" | "flat";

export function flowPremiumNetSign(net: number, epsilon = 1): FlowPremiumNetSign {
  if (Math.abs(net) < epsilon) return "flat";
  return net > 0 ? "bullish" : "bearish";
}

/** FLIP · EXPERIMENTAL — opposite signs and |15m| > 20% × |session|. */
export function detectFlowFlipExperimental(sessionNet: number, net15m: number): boolean {
  if (sessionNet === 0) return false;
  const sSign = Math.sign(sessionNet);
  const mSign = Math.sign(net15m);
  if (sSign === 0 || mSign === 0 || sSign === mSign) return false;
  return Math.abs(net15m) > 0.2 * Math.abs(sessionNet);
}