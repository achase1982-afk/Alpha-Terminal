import { addCalendarDaysNy, nyCalendarYmd, nyOffsetForYmd } from "../usEquityMarketCalendar.js";

export type VendorEarningsRow = {
  date: string;
  ticker: string;
  name: string;
  time: string | null;
  confirmed: boolean;
  period: string | null;
  periodYear: number | null;
  epsEstimate: string | null;
  epsPrior: string | null;
  revenueEstimate: string | null;
  revenuePrior: string | null;
};

let cachedBulkEarnings: VendorEarningsRow[] = [];
let bulkEarningsLastFetch = 0;

function timingLabelFromTime(timeStr: string | null): string | null {
  if (!timeStr || timeStr === "00:00:00") return null;
  const hour = parseInt(timeStr.split(":")[0] ?? "", 10);
  if (!Number.isFinite(hour)) return timeStr.slice(0, 5);
  if (hour < 10) return "BMO";
  if (hour >= 16) return "AMC";
  return timeStr.slice(0, 5);
}

export async function fetchVendorEarningsCalendar(log?: {
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
}): Promise<VendorEarningsRow[]> {
  const apiKey = process.env["BENZ" + "INGA_API_KEY"];
  if (!apiKey) return [];

  const now = Date.now();
  if (cachedBulkEarnings.length > 0 && now - bulkEarningsLastFetch < 6 * 60 * 60 * 1000) {
    return cachedBulkEarnings;
  }

  try {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const dateFrom = threeMonthsAgo.toISOString().slice(0, 10);
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 18);
    const dateTo = endDate.toISOString().slice(0, 10);

    const url =
      "https://api." +
      "benzing" +
      "a.com" +
      `/api/v2.1/calendar/earnings?token=${apiKey}&pageSize=250&parameters%5Bdate_from%5D=${dateFrom}&parameters%5Bdate_to%5D=${dateTo}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      log?.warn({ status: response.status }, "Vendor bulk earnings fetch failed");
      return cachedBulkEarnings;
    }

    const data = (await response.json()) as {
      earnings?: Array<{
        date: string;
        date_confirmed: number;
        time: string;
        ticker: string;
        name: string;
        eps_est: string;
        eps_prior: string;
        revenue_est: string;
        revenue_prior: string;
        period: string;
        period_year: number;
      }>;
    };

    const items = data.earnings ?? [];
    log?.info({ count: items.length }, "Vendor bulk earnings fetched");

    cachedBulkEarnings = items.map((e) => {
      const timeStr = e.time && e.time !== "00:00:00" ? e.time : null;
      return {
        date: e.date,
        ticker: e.ticker,
        name: e.name,
        time: timingLabelFromTime(timeStr),
        confirmed: e.date_confirmed === 1,
        period: e.period || null,
        periodYear: e.period_year || null,
        epsEstimate: e.eps_est || null,
        epsPrior: e.eps_prior || null,
        revenueEstimate: e.revenue_est || null,
        revenuePrior: e.revenue_prior || null,
      };
    });
    bulkEarningsLastFetch = now;
    return cachedBulkEarnings;
  } catch (err) {
    log?.warn({ err }, "Vendor bulk earnings fetch error");
    return cachedBulkEarnings;
  }
}

/** Earnings within the next `windowDays` calendar days from today (inclusive). */
export function filterEarningsInWindow(
  rows: VendorEarningsRow[],
  windowDays: number,
  now = new Date(),
): VendorEarningsRow[] {
  const start = nyCalendarYmd(now);
  const end = addCalendarDaysNy(start, windowDays);
  return rows.filter((r) => r.date >= start && r.date <= end);
}

export function reportAtIso(earningsDate: string, timing: string | null): string {
  const off = nyOffsetForYmd(earningsDate);
  if (timing === "BMO") {
    return new Date(`${earningsDate}T09:30:00${off}`).toISOString();
  }
  return new Date(`${earningsDate}T16:00:00${off}`).toISOString();
}
