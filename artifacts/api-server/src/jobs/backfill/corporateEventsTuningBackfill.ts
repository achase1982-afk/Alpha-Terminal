import { syncCorporateEventsForTuningSymbol } from "../../lib/fmpBackfill.js";

export async function backfillCorporateEventsForTuningSymbol(symbol: string): Promise<{
  calendarUpserts: number;
  surpriseUpserts: number;
  splitUpserts: number;
  fmpPremiumHistoricalUnavailable: boolean;
}> {
  return syncCorporateEventsForTuningSymbol(symbol);
}
