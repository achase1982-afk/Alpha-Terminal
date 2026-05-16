import type { QuoteResponse } from "@workspace/api-client-react";

/**
 * Ticker routing for AI chat: stopword list must match the API server `AI_CHAT_TICKER_STOPWORDS`.
 */
const CHAT_TICKER_STOPWORDS = new Set<string>([
  "AND",
  "ARE",
  "ATH",
  "ATL",
  "ASK",
  "BID",
  "BUT",
  "BUY",
  "CAN",
  "DAY",
  "DID",
  "DOES",
  "DOWN",
  "EPS",
  "ETF",
  "FOR",
  "GET",
  "GOT",
  "HAD",
  "HAS",
  "HER",
  "HIM",
  "HIS",
  "HOW",
  "IPO",
  "ITS",
  "IV",
  "LET",
  "LOW",
  "MAY",
  "NAV",
  "NEW",
  "NOT",
  "NOW",
  "ONE",
  "OUR",
  "OUT",
  "PUT",
  "RSI",
  "SAW",
  "SAY",
  "SELL",
  "SHE",
  "THE",
  "TOO",
  "TWO",
  "USE",
  "VIX",
  "WAS",
  "WAY",
  "WHO",
  "WHY",
  "YES",
  "YET",
  "YOU",
  "YTD",
  "OPEN",
  "HIGH",
  "CLOSE",
  "FROM",
  "INTO",
  "THAN",
  "THEN",
  "THEM",
  "WITH",
  "JUST",
  "ALSO",
  "ONLY",
  "SOME",
  "SUCH",
  "VERY",
  "WHAT",
  "WHEN",
  "WHERE",
  "WHICH",
  "YOUR",
  "ABOUT",
  "AFTER",
  "AGAIN",
  "BEING",
  "COULD",
  "FIRST",
  "GOING",
  "GOOD",
  "GREAT",
  "HEDGE",
  "HERE",
  "LAST",
  "LIKE",
  "LONG",
  "MADE",
  "MAKE",
  "MANY",
  "MORE",
  "MOST",
  "MUCH",
  "NEXT",
  "OVER",
  "PART",
  "SAME",
  "SEEN",
  "SHOW",
  "STAY",
  "TAKE",
  "THAT",
  "THESE",
  "THEY",
  "THIS",
  "TIME",
  "THOSE",
  "UNDER",
  "WELL",
  "WERE",
  "WILL",
  "WORK",
  "BACK",
  "CALL",
  "CASH",
  "COME",
  "EVEN",
  "EVER",
  "FEEL",
  "FIND",
  "FORM",
  "FULL",
  "GAVE",
  "GIVE",
  "HELP",
  "HOLD",
  "KEEP",
  "KNOW",
  "LIFE",
  "LIVE",
  "LOOK",
  "MOVE",
  "NAME",
  "NEED",
  "PLAY",
  "READ",
  "REAL",
  "RUNS",
  "SAID",
  "SEEM",
  "SIDE",
  "SURE",
  "TELL",
  "TURN",
  "USED",
  "WANT",
  "WEEK",
  "YEAR",
]);

/** Which symbol should drive Schwab quote + server tape routing for this chat turn. */
export function resolveChatContextSymbol(pageSymbol: string, routingText: string): string {
  const page = pageSymbol.trim().toUpperCase();
  const text = routingText.trim().toUpperCase();
  if (!text) return page || "";

  const dollarSyms: string[] = [];
  const reDollar = /\$([A-Z]{2,5})\b/g;
  let dm: RegExpExecArray | null;
  while ((dm = reDollar.exec(text)) !== null) {
    dollarSyms.push(dm[1]!);
  }
  if (dollarSyms.length > 0) {
    return dollarSyms[dollarSyms.length - 1]!;
  }

  const bareOrdered: string[] = [];
  const reBare = /\b([A-Z]{2,5})\b/g;
  let bm: RegExpExecArray | null;
  while ((bm = reBare.exec(text)) !== null) {
    if (bm.index > 0 && text[bm.index - 1] === "$") continue;
    const w = bm[1]!;
    if (CHAT_TICKER_STOPWORDS.has(w)) continue;
    bareOrdered.push(w);
  }
  if (bareOrdered.length === 0) return page || "";

  const last = bareOrdered[bareOrdered.length - 1]!;
  if (last === page && bareOrdered.length >= 2) {
    return bareOrdered[bareOrdered.length - 2]!;
  }
  return last;
}

export function formatAiChatMarketContext(sym: string, quote: QuoteResponse | null | undefined): string {
  if (!quote || quote.error) return `No live market context available for ${sym}.`;
  return (
    `CURRENT MARKET CONTEXT for ${sym}:\nLast: $${quote.last}\nChange: ${quote.changePct}%\n` +
    `Vol: ${quote.volume}\nRange: ${quote.low}-${quote.high}`
  );
}
