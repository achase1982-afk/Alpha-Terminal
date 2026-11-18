const MONTH_CODES = "FGHJKMNQUVXZ";

/** Streamer field 34 / explicit active contract per futures root (e.g. `/ES` → `/ESZ25`). */
const futuresActiveByRoot = new Map<string, string>();

export function setFuturesActiveSymbolForRoot(rootDisplay: string, activeContract: string): void {
  const root = rootDisplay.toUpperCase().trim();
  const contract = activeContract.toUpperCase().trim();
  if (!root.startsWith("/") || !contract.startsWith("/")) return;
  futuresActiveByRoot.set(root, contract);
}

export function getFuturesActiveSymbolForRoot(rootDisplay: string): string | undefined {
  return futuresActiveByRoot.get(rootDisplay.toUpperCase().trim());
}

export function clearFuturesActiveSymbolCache(): void {
  futuresActiveByRoot.clear();
}

type EtYmd = { year: number; month: number; day: number };

function etYmdFromDate(date: Date): EtYmd {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  let day = date.getDate();
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    if (p.type === "month") month = Number(p.value);
    if (p.type === "day") day = Number(p.value);
  }
  return { year, month, day };
}

export function thirdFridayEtYearMonth(year: number, month1: number): EtYmd {
  const first = new Date(Date.UTC(year, month1 - 1, 1, 12, 0, 0));
  const dow = first.getUTCDay();
  const daysToFirstFriday = (5 - dow + 7) % 7;
  const day = 1 + daysToFirstFriday + 14;
  return { year, month: month1, day };
}

function etYmdToCompare(v: EtYmd): number {
  return v.year * 10_000 + v.month * 100 + v.day;
}

/** True when NY calendar date is on/after roll cutoff (8 calendar days before 3rd Friday). */
export function shouldRollQuarterlyContract(year: number, month1: number, asOf: Date): boolean {
  const third = thirdFridayEtYearMonth(year, month1);
  const cutoffDay = third.day - 8;
  let cy = third.year;
  let cm = third.month;
  let cd = cutoffDay;
  if (cd < 1) {
    cm -= 1;
    if (cm < 1) {
      cm = 12;
      cy -= 1;
    }
    const prevMonthDays = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
    cd = prevMonthDays + cd;
  }
  const now = etYmdFromDate(asOf);
  return etYmdToCompare(now) >= etYmdToCompare({ year: cy, month: cm, day: cd });
}

export function quarterlyContractSymbol(bare: string, monthIndex0: number, y2: number): string {
  return `/${bare}${MONTH_CODES[monthIndex0]}${y2}`;
}

const EARLY_ROLL_MONTHS_AHEAD = new Set(["BZ"]);

export function futuresRootFromContract(contract: string): string | null {
  const m = contract.toUpperCase().trim().match(/^\/([A-Z0-9]{1,4})[FGHJKMNQUVXZ]\d{2}$/);
  return m ? `/${m[1]}` : null;
}

export function resolveMonthlyFrontMonth(bare: string, asOf: Date): string {
  const et = etYmdFromDate(asOf);
  const rollAhead = EARLY_ROLL_MONTHS_AHEAD.has(bare) ? 2 : 1;
  let month0 = et.month - 1 + rollAhead;
  let year = et.year;
  while (month0 > 11) {
    month0 -= 12;
    year += 1;
  }
  for (let guard = 0; guard < 24; guard++) {
    if (shouldRollQuarterlyContract(year, month0 + 1, asOf)) {
      month0 += 1;
      if (month0 > 11) {
        month0 = 0;
        year += 1;
      }
      continue;
    }
    break;
  }
  return quarterlyContractSymbol(bare, month0, year % 100);
}

export function resolveQuarterlyFrontMonth(
  bare: string,
  quarterMonthIndices: number[],
  asOf: Date,
): string {
  const et = etYmdFromDate(asOf);
  const y2 = et.year % 100;
  const candidates: { month0: number; y2: number; year: number }[] = [];
  for (let yOff = 0; yOff <= 1; yOff++) {
    const year = et.year + yOff;
    const yy2 = year % 100;
    for (const q of quarterMonthIndices) {
      candidates.push({ month0: q, y2: yy2, year });
    }
  }
  candidates.sort((a, b) => a.year - b.year || a.month0 - b.month0);
  for (const c of candidates) {
    if (shouldRollQuarterlyContract(c.year, c.month0 + 1, asOf)) continue;
    return quarterlyContractSymbol(bare, c.month0, c.y2);
  }
  const last = candidates[candidates.length - 1]!;
  return quarterlyContractSymbol(bare, last.month0, last.y2);
}