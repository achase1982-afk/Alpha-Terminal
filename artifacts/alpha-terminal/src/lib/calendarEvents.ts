export interface CalendarEvent {
  date: string;
  type: "holiday" | "fomc" | "economic" | "earnings" | "opex" | "witching";
  title: string;
  ticker?: string;
  detail?: string;
  time?: string;
  blsType?: string;
  reportUrl?: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function ds(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function dow(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getDay();
}

function dim(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function nthDow(y: number, m: number, n: number, wd: number): number {
  const first = dow(y, m, 1);
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
}

function lastDow(y: number, m: number, wd: number): number {
  const last = dim(y, m);
  const lastWd = dow(y, m, last);
  return last - ((lastWd - wd + 7) % 7);
}

function nthBizDay(y: number, m: number, n: number): number {
  let count = 0;
  const days = dim(y, m);
  for (let d = 1; d <= days; d++) {
    const w = dow(y, m, d);
    if (w >= 1 && w <= 5) {
      count++;
      if (count === n) return d;
    }
  }
  return 1;
}

function observed(y: number, m: number, d: number): [number, number, number] {
  const w = dow(y, m, d);
  if (w === 6) {
    const [py, pm, pd] = addDays(y, m, d, -1);
    return [py, pm, pd];
  }
  if (w === 0) {
    const [ny, nm, nd] = addDays(y, m, d, 1);
    return [ny, nm, nd];
  }
  return [y, m, d];
}

function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const dt = new Date(y, m - 1, d + days);
  return [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
}

function easter(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * mm + 114) / 31);
  const da = ((h + l - 7 * mm + 114) % 31) + 1;
  return [mo, da];
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const FOMC_KNOWN: Record<number, string[]> = {
  2025: ["01-29", "03-19", "05-07", "06-18", "07-30", "09-17", "10-29", "12-17"],
  2026: ["01-28", "03-18", "05-06", "06-17", "07-29", "09-16", "10-28", "12-16"],
  2027: ["01-27", "03-17", "05-05", "06-16", "07-28", "09-22", "10-27", "12-15"],
};

function fomcDates(y: number): string[] {
  if (FOMC_KNOWN[y]) return FOMC_KNOWN[y];
  return [
    `01-${pad2(lastDow(y, 1, 3))}`,
    `03-${pad2(nthDow(y, 3, 3, 3))}`,
    `05-${pad2(nthDow(y, 5, 1, 3))}`,
    `06-${pad2(nthDow(y, 6, 3, 3))}`,
    `07-${pad2(lastDow(y, 7, 3))}`,
    `09-${pad2(nthDow(y, 9, 3, 3))}`,
    `10-${pad2(lastDow(y, 10, 3))}`,
    `12-${pad2(nthDow(y, 12, 3, 3))}`,
  ];
}

const SEP_INDICES = new Set([1, 3, 5, 7]);

function generateHolidays(y: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];
  const h = (hy: number, m: number, d: number, title: string) => {
    ev.push({ date: ds(hy, m, d), type: "holiday", title, detail: "NYSE & NASDAQ closed." });
  };
  const [nyY, nyM, nyD] = observed(y, 1, 1);
  h(nyY, nyM, nyD, "New Year's Day");
  h(y, 1, nthDow(y, 1, 3, 1), "MLK Jr. Day");
  h(y, 2, nthDow(y, 2, 3, 1), "Presidents' Day");
  const [em, ed] = easter(y);
  const [, gfm, gfd] = addDays(y, em, ed, -2);
  h(y, gfm, gfd, "Good Friday");
  h(y, 5, lastDow(y, 5, 1), "Memorial Day");
  const [jnY, jnM, jnD] = observed(y, 6, 19);
  h(jnY, jnM, jnD, "Juneteenth");
  const [j4Y, j4M, j4D] = observed(y, 7, 4);
  h(j4Y, j4M, j4D, "Independence Day");
  h(y, 9, nthDow(y, 9, 1, 1), "Labor Day");
  h(y, 11, nthDow(y, 11, 4, 4), "Thanksgiving Day");
  const [xmY, xmM, xmD] = observed(y, 12, 25);
  h(xmY, xmM, xmD, "Christmas Day");
  return ev;
}

function generateEarlyCloses(y: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];
  const ec = (ey: number, m: number, d: number, detail: string) => {
    ev.push({ date: ds(ey, m, d), type: "economic", title: "Early Close (1 PM)", detail });
  };

  const [, j4M, j4D] = observed(y, 7, 4);
  const [ecY, ecM, ecD] = addDays(y, j4M, j4D, -1);
  const ecDow = dow(ecY, ecM, ecD);
  if (ecDow >= 1 && ecDow <= 5) {
    ec(ecY, ecM, ecD, "Markets close at 1:00 PM ET ahead of Independence Day.");
  }

  const thxDay = nthDow(y, 11, 4, 4);
  ec(y, 11, thxDay + 1, "Markets close at 1:00 PM ET.");

  const [xmY, xmM, xmD] = observed(y, 12, 25);
  const [xecY, xecM, xecD] = addDays(xmY, xmM, xmD, -1);
  const xecDow = dow(xecY, xecM, xecD);
  if (xecDow >= 1 && xecDow <= 5 && !(xecM === xmM && xecD === xmD)) {
    ec(xecY, xecM, xecD, "Markets close at 1:00 PM ET ahead of Christmas.");
  }

  return ev;
}

function generateFomc(y: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];
  const dates = fomcDates(y);
  dates.forEach((md, idx) => {
    const isSep = SEP_INDICES.has(idx);
    ev.push({
      date: `${y}-${md}`,
      type: "fomc",
      title: "FOMC Decision",
      detail: isSep ? "Rate decision + dot plot + projections." : "Rate decision and statement.",
      time: "2:00 PM ET",
    });

    const mNum = parseInt(md.split("-")[0]);
    const dNum = parseInt(md.split("-")[1]);
    const [minY, minM, minD] = addDays(y, mNum, dNum, 21);
    ev.push({
      date: ds(minY, minM, minD),
      type: "fomc",
      title: "FOMC Minutes",
      detail: `Minutes from the ${MONTH_NAMES[mNum]} FOMC meeting.`,
      time: "2:00 PM ET",
    });
  });
  return ev;
}

function getHolidayDates(y: number): Set<string> {
  const holidays = generateHolidays(y);
  return new Set(holidays.map(h => h.date));
}

function generateEconomic(y: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];
  const holidays = getHolidayDates(y);

  for (let m = 1; m <= 12; m++) {
    const nfpDay = nthDow(y, m, 1, 5);
    ev.push({
      date: ds(y, m, nfpDay),
      type: "economic",
      title: "Jobs Report (NFP)",
      detail: "Non-Farm Payrolls — monthly employment data.",
      time: "8:30 AM ET",
      blsType: "nfp",
      reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm",
    });

    const [adpY, adpM, adpD] = addDays(y, m, nfpDay, -2);
    ev.push({
      date: ds(adpY, adpM, adpD),
      type: "economic",
      title: "ADP Employment",
      detail: "ADP private sector employment change — preview of NFP.",
      time: "8:15 AM ET",
    });

    const cpiDay = nthDow(y, m, 2, 3);
    ev.push({
      date: ds(y, m, cpiDay),
      type: "economic",
      title: "CPI Report",
      detail: "Consumer Price Index — key inflation gauge watched by the Fed.",
      time: "8:30 AM ET",
      blsType: "cpi",
      reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
    });

    const [ppiY, ppiM, ppiD] = addDays(y, m, cpiDay, -1);
    ev.push({
      date: ds(ppiY, ppiM, ppiD),
      type: "economic",
      title: "PPI Report",
      detail: "Producer Price Index — measures wholesale inflation.",
      time: "8:30 AM ET",
      blsType: "ppi",
      reportUrl: "https://www.bls.gov/news.release/ppi.nr0.htm",
    });

    const pceDay = lastDow(y, m, 5);
    ev.push({
      date: ds(y, m, pceDay),
      type: "economic",
      title: "PCE Price Index",
      detail: "Personal Consumption Expenditures — the Fed's preferred inflation measure.",
      time: "8:30 AM ET",
    });

    let retailDay = 15;
    const retailDw = dow(y, m, 15);
    if (retailDw === 6) retailDay = 14;
    if (retailDw === 0) retailDay = 16;
    ev.push({
      date: ds(y, m, retailDay),
      type: "economic",
      title: "Retail Sales",
      detail: "Monthly retail sales — measures consumer spending strength.",
      time: "8:30 AM ET",
    });

    const ismMfgDay = nthBizDay(y, m, 1);
    ev.push({
      date: ds(y, m, ismMfgDay),
      type: "economic",
      title: "ISM Manufacturing",
      detail: "ISM Manufacturing PMI — above 50 signals expansion.",
      time: "10:00 AM ET",
    });

    const ismSvcDay = nthBizDay(y, m, 3);
    ev.push({
      date: ds(y, m, ismSvcDay),
      type: "economic",
      title: "ISM Services",
      detail: "ISM Services PMI — measures service sector activity.",
      time: "10:00 AM ET",
    });

    const ccDay = lastDow(y, m, 2);
    ev.push({
      date: ds(y, m, ccDay),
      type: "economic",
      title: "Consumer Confidence",
      detail: "Conference Board Consumer Confidence Index.",
      time: "10:00 AM ET",
    });

    let thirdFriday = nthDow(y, m, 3, 5);
    if (holidays.has(ds(y, m, thirdFriday))) {
      const [, , shifted] = addDays(y, m, thirdFriday, -1);
      thirdFriday = shifted;
    }
    if (m === 3 || m === 6 || m === 9 || m === 12) {
      ev.push({
        date: ds(y, m, thirdFriday),
        type: "witching",
        title: "Quad Witching",
        detail: "Quarterly expiration of stock options, index options, index futures, and single stock futures.",
      });
    } else {
      ev.push({
        date: ds(y, m, thirdFriday),
        type: "opex",
        title: "Monthly OpEx",
        detail: "Monthly options expiration. Expect increased volatility and volume.",
      });
    }
  }

  const gdpMonths = [1, 4, 7, 10];
  const gdpQuarters = ["Q4", "Q1", "Q2", "Q3"];
  gdpMonths.forEach((m, idx) => {
    const gdpDay = lastDow(y, m, 4);
    ev.push({
      date: ds(y, m, gdpDay),
      type: "economic",
      title: `GDP ${gdpQuarters[idx]} (Advance)`,
      detail: `${gdpQuarters[idx]} GDP advance estimate — broadest measure of economic output.`,
      time: "8:30 AM ET",
    });
  });

  const jhDay = lastDow(y, 8, 5);
  ev.push({
    date: ds(y, 8, jhDay),
    type: "economic",
    title: "Jackson Hole Symposium",
    detail: "Fed Chair speech at Kansas City Fed's annual symposium — major policy signals.",
    time: "10:00 AM ET",
  });

  return ev;
}

function generateEarnings(y: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];

  const companies: Array<{ ticker: string; name: string; qs: Array<{ m: number; w: number }> }> = [
    { ticker: "AAPL", name: "Apple", qs: [
      { m: 1, w: 4 }, { m: 4, w: 5 }, { m: 7, w: 5 }, { m: 10, w: 5 },
    ]},
    { ticker: "MSFT", name: "Microsoft", qs: [
      { m: 1, w: 4 }, { m: 4, w: 4 }, { m: 7, w: 4 }, { m: 10, w: 4 },
    ]},
    { ticker: "GOOG", name: "Alphabet", qs: [
      { m: 2, w: 1 }, { m: 4, w: 4 }, { m: 7, w: 4 }, { m: 10, w: 4 },
    ]},
    { ticker: "AMZN", name: "Amazon", qs: [
      { m: 2, w: 1 }, { m: 5, w: 1 }, { m: 8, w: 1 }, { m: 10, w: 5 },
    ]},
    { ticker: "META", name: "Meta", qs: [
      { m: 2, w: 1 }, { m: 4, w: 4 }, { m: 7, w: 4 }, { m: 10, w: 4 },
    ]},
    { ticker: "TSLA", name: "Tesla", qs: [
      { m: 1, w: 4 }, { m: 4, w: 4 }, { m: 7, w: 4 }, { m: 10, w: 4 },
    ]},
    { ticker: "NVDA", name: "NVIDIA", qs: [
      { m: 2, w: 4 }, { m: 5, w: 4 }, { m: 8, w: 4 }, { m: 11, w: 3 },
    ]},
  ];

  const qLabels = ["Q4", "Q1", "Q2", "Q3"];

  for (const co of companies) {
    co.qs.forEach((q, idx) => {
      const day = q.w <= 4 ? nthDow(y, q.m, q.w, 4) : lastDow(y, q.m, 4);
      const validDay = Math.min(day, dim(y, q.m));
      ev.push({
        date: ds(y, q.m, validDay),
        type: "earnings",
        title: "Earnings",
        ticker: co.ticker,
        detail: `${co.name} ${qLabels[idx]} ${y} earnings report.`,
        time: "After Close",
      });
    });
  }

  return ev;
}

export function generateMarketEvents(startYear: number, endYear: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (let y = startYear; y <= endYear; y++) {
    events.push(...generateHolidays(y));
    events.push(...generateEarlyCloses(y));
    events.push(...generateFomc(y));
    events.push(...generateEconomic(y));
    events.push(...generateEarnings(y));
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
