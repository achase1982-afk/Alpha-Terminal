import { getQuoteBySymbol, normalizeEquityKey } from "../schwabStreamer.js";
import { deskFetchSchwabQuotes } from "./deskSchwabQuotes.js";

/** LEVELONE_EQUITIES field 3 (last), then Schwab REST $SPX quote. */
export async function deskResolveSpxSpot(): Promise<number | null> {
  for (const key of ["$SPX", "SPX"].map(normalizeEquityKey)) {
    const q = getQuoteBySymbol(key);
    const last = q?.last ?? q?.regularLast;
    if (last != null && Number.isFinite(last)) return last;
  }

  try {
    const { quotes } = await deskFetchSchwabQuotes(["$SPX", "SPX"]);
    for (const row of quotes) {
      const sym = row.symbol.toUpperCase();
      if (sym === "$SPX" || sym === "SPX") {
        if (row.last != null && Number.isFinite(row.last)) return row.last;
      }
    }
  } catch {
    /* REST fallback failed */
  }
  return null;
}