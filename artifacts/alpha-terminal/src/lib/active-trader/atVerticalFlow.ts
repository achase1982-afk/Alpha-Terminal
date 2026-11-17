import type { FlowLaneCounts } from "./flowClassifier";

const EMPTY: FlowLaneCounts = { buy: 0, sell: 0, even: 0, unknown: 0 };

/** Aggregate classified flow for spread ladder rows (no spread-tape yet → leg sum). */
export function aggregateVerticalFlow(
  nearKey: string | undefined,
  farKey: string | undefined,
  flowByKey: Record<string, FlowLaneCounts>,
): { counts: FlowLaneCounts; tooltip: string } {
  const a = nearKey ? flowByKey[nearKey] : undefined;
  const b = farKey ? flowByKey[farKey] : undefined;
  if (!a && !b) {
    return { counts: EMPTY, tooltip: "Flow: leg-sum (awaiting multi-leg tape)" };
  }
  return {
    counts: {
      buy: (a?.buy ?? 0) + (b?.buy ?? 0),
      sell: (a?.sell ?? 0) + (b?.sell ?? 0),
      even: (a?.even ?? 0) + (b?.even ?? 0),
      unknown: (a?.unknown ?? 0) + (b?.unknown ?? 0),
    },
    tooltip: "Flow: leg-sum (near + far classified prints)",
  };
}