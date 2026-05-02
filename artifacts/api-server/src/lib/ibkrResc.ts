/**
 * Stub for IBKR Gateway reqFundamentalData reportType "RESC" (analyst estimates).
 * Phase 2: wire to IBKR Gateway and merge into catalyst forward estimates.
 */

export async function fetchRescForwardEstimates(_ticker: string): Promise<{
  eps_high: number | null;
  eps_low: number | null;
  revenue_high: number | null;
  revenue_low: number | null;
  analyst_count: number | null;
  data_source_gap: string | null;
} | null> {
  // Phase 2: Wire to IBKR Gateway reqFundamentalData with reportType="RESC"
  // Currently not implemented - returns null
  return null;
}
