/**
 * Strikes kept on the Active Trader ladder.
 * 40 = 20 above spot and 20 below. The SPX book is not loaded whole;
 * scrolling the ladder widens this window.
 */
export const AT_LADDER_STRIKE_COUNT = 40;
/** Extra strikes requested on one side when the ladder hits an edge. */
export const AT_LADDER_STRIKE_STEP = 20;
/** Chain-view hold cap, in strikes. The ladder uses atLadderWindow instead. */
export const AT_LADDER_STRIKE_CAP = 80;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function etTodayYmd(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function addIsoDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Active Trader chain query window.
 * A selected expiration is that session only. Before one is known, the next
 * few sessions are enough to pick the front expiry — not the full SPX book.
 */
export function atChainDateWindow(
  expiration: string | null | undefined,
  now = new Date(),
): { fromDate: string; toDate: string } {
  const ymd = expiration?.slice(0, 10) ?? "";
  if (ISO_DATE.test(ymd)) return { fromDate: ymd, toDate: ymd };
  const fromDate = etTodayYmd(now);
  return { fromDate, toDate: addIsoDays(fromDate, 3) };
}
