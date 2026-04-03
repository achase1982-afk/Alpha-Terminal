import { useState, useMemo, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { ChevronLeft, ChevronRight, X, ExternalLink, Loader2 } from "lucide-react";

interface CalendarEvent {
  date: string;
  type: "holiday" | "fomc" | "economic" | "earnings" | "opex" | "witching";
  title: string;
  ticker?: string;
  detail?: string;
  time?: string;
  blsType?: string;
  reportUrl?: string;
}

interface BlsReportData {
  reportType: string;
  series: string;
  unit: string;
  latest: { month: string; year: string; value: string; isLatest: boolean };
  change: {
    actual: string;
    actualRaw: number;
    currentLevel?: string;
    previousLevel: string;
    previousMonth: string;
    currentMonth: string;
    currentYear: string;
  } | null;
  summary?: string;
  recentHistory: Array<{ month: string; year: string; value: string }>;
  reportUrl: string;
}

interface NfpSeriesResult {
  label: string;
  unit: string;
  actual: string;
  previous: string;
  change: string;
  changeRaw: number;
  month: string;
  year: string;
  threeMonthAvg?: string;
  error?: string;
}

interface NfpMeta {
  month: string;
  year: string;
  earningsYoy?: NfpSeriesResult;
  threeMonthNfpAvg?: string;
  sixMonthNfpAvg?: string;
  prevMonths?: Array<{ month: string; change: string; changeRaw: number }>;
  narrative?: string;
}

interface NfpFullData {
  nfp?: NfpSeriesResult;
  unemployment?: NfpSeriesResult;
  earningsMom?: NfpSeriesResult;
  earningsYoy?: NfpSeriesResult;
  lfpr?: NfpSeriesResult;
  weeklyHours?: NfpSeriesResult;
  privatePayroll?: NfpSeriesResult;
  govPayroll?: NfpSeriesResult;
  manufacturing?: NfpSeriesResult;
  leisureHosp?: NfpSeriesResult;
  healthCare?: NfpSeriesResult;
  construction?: NfpSeriesResult;
  transportWare?: NfpSeriesResult;
  financialAct?: NfpSeriesResult;
  fedGov?: NfpSeriesResult;
  employed?: NfpSeriesResult;
  unemployed?: NfpSeriesResult;
  laborForce?: NfpSeriesResult;
  empPopRatio?: NfpSeriesResult;
  u6?: NfpSeriesResult;
  _meta?: NfpMeta;
}

const TYPE_COLORS: Record<string, string> = {
  holiday: "#f23645",
  fomc: "#a855f7",
  economic: "#3b82f6",
  earnings: "#FFB800",
  opex: "#f97316",
  witching: "#ec4899",
};

const TYPE_LABELS: Record<string, string> = {
  holiday: "Holiday",
  fomc: "FOMC",
  economic: "Economic",
  earnings: "Earnings",
  opex: "OpEx",
  witching: "Quad Witching",
};

const MARKET_EVENTS: CalendarEvent[] = [
  { date: "2025-01-01", type: "holiday", title: "New Year's Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-01-09", type: "holiday", title: "National Day of Mourning", detail: "NYSE & NASDAQ closed in honor of President Carter." },
  { date: "2025-01-14", type: "economic", title: "PPI Report", detail: "Producer Price Index — measures wholesale inflation. Higher than expected = hawkish for rates.", time: "8:30 AM ET", blsType: "ppi", reportUrl: "https://www.bls.gov/news.release/ppi.nr0.htm" },
  { date: "2025-01-15", type: "economic", title: "CPI Report", detail: "Consumer Price Index — key inflation gauge watched by the Fed.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-01-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration. Expect increased volatility and volume." },
  { date: "2025-01-20", type: "holiday", title: "MLK Jr. Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-01-29", type: "fomc", title: "FOMC Decision", detail: "Federal Open Market Committee rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-01-30", type: "earnings", title: "Earnings", ticker: "AAPL", detail: "Apple Q1 FY25 earnings report.", time: "After Close" },
  { date: "2025-01-30", type: "earnings", title: "Earnings", ticker: "MSFT", detail: "Microsoft Q2 FY25 earnings report.", time: "After Close" },
  { date: "2025-02-05", type: "earnings", title: "Earnings", ticker: "GOOG", detail: "Alphabet Q4 2024 earnings report.", time: "After Close" },
  { date: "2025-02-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls — monthly employment data.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-02-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index — key inflation gauge.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-02-17", type: "holiday", title: "Presidents' Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-02-21", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-03-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-03-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-03-19", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + economic projections.", time: "2:00 PM ET" },
  { date: "2025-03-21", type: "witching", title: "Quad Witching", detail: "Quarterly expiration of stock options, index options, index futures, and single stock futures." },
  { date: "2025-04-02", type: "economic", title: "ADP Employment", detail: "Private sector employment change.", time: "8:15 AM ET" },
  { date: "2025-04-04", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-04-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-04-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-04-18", type: "holiday", title: "Good Friday", detail: "NYSE & NASDAQ closed." },
  { date: "2025-05-02", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-05-07", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-05-13", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-05-16", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-05-26", type: "holiday", title: "Memorial Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-06-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-06-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-06-18", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2025-06-19", type: "holiday", title: "Juneteenth", detail: "NYSE & NASDAQ closed." },
  { date: "2025-06-20", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2025-07-03", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET ahead of Independence Day." },
  { date: "2025-07-04", type: "holiday", title: "Independence Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-07-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-07-18", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-07-30", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-08-01", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-08-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-08-15", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-09-01", type: "holiday", title: "Labor Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-09-05", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-09-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-09-17", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2025-09-19", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2025-10-03", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-10-14", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-10-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-10-29", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-11-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-11-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-11-21", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-11-27", type: "holiday", title: "Thanksgiving Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-11-28", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET." },
  { date: "2025-12-05", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2025-12-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2025-12-17", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2025-12-19", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2025-12-24", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET ahead of Christmas." },
  { date: "2025-12-25", type: "holiday", title: "Christmas Day", detail: "NYSE & NASDAQ closed." },

  { date: "2026-01-01", type: "holiday", title: "New Year's Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-01-09", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-01-14", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-01-16", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-01-19", type: "holiday", title: "MLK Jr. Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-01-28", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-01-29", type: "earnings", title: "Earnings", ticker: "AAPL", detail: "Apple Q1 FY26 earnings report.", time: "After Close" },
  { date: "2026-01-29", type: "earnings", title: "Earnings", ticker: "MSFT", detail: "Microsoft Q2 FY26 earnings report.", time: "After Close" },
  { date: "2026-02-04", type: "earnings", title: "Earnings", ticker: "AMZN", detail: "Amazon Q4 2025 earnings report.", time: "After Close" },
  { date: "2026-02-04", type: "earnings", title: "Earnings", ticker: "GOOG", detail: "Alphabet Q4 2025 earnings report.", time: "After Close" },
  { date: "2026-02-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-02-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-02-16", type: "holiday", title: "Presidents' Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-02-20", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-03-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-03-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-03-18", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-03-20", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-04-03", type: "holiday", title: "Good Friday", detail: "NYSE & NASDAQ closed." },
  { date: "2026-04-03", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls — monthly employment data released by BLS. Measures total number of paid U.S. workers excluding farm, government, private household, and nonprofit employees. A key indicator of economic health.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-04-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-04-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-04-23", type: "earnings", title: "Earnings", ticker: "TSLA", detail: "Tesla Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-04-24", type: "earnings", title: "Earnings", ticker: "GOOG", detail: "Alphabet Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-04-28", type: "earnings", title: "Earnings", ticker: "META", detail: "Meta Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-04-29", type: "earnings", title: "Earnings", ticker: "MSFT", detail: "Microsoft Q3 FY26 earnings report.", time: "After Close" },
  { date: "2026-04-30", type: "earnings", title: "Earnings", ticker: "AAPL", detail: "Apple Q2 FY26 earnings report.", time: "After Close" },
  { date: "2026-04-30", type: "earnings", title: "Earnings", ticker: "AMZN", detail: "Amazon Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-05-01", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-05-06", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-05-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-05-15", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-05-25", type: "holiday", title: "Memorial Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-06-05", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-06-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-06-17", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-06-19", type: "holiday", title: "Juneteenth", detail: "NYSE & NASDAQ closed." },
  { date: "2026-06-19", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-07-02", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-07-03", type: "holiday", title: "Independence Day (Observed)", detail: "NYSE & NASDAQ closed." },
  { date: "2026-07-14", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-07-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-07-22", type: "earnings", title: "Earnings", ticker: "TSLA", detail: "Tesla Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-07-23", type: "earnings", title: "Earnings", ticker: "GOOG", detail: "Alphabet Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-07-28", type: "earnings", title: "Earnings", ticker: "META", detail: "Meta Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-07-29", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-07-29", type: "earnings", title: "Earnings", ticker: "MSFT", detail: "Microsoft Q4 FY26 earnings report.", time: "After Close" },
  { date: "2026-07-30", type: "earnings", title: "Earnings", ticker: "AAPL", detail: "Apple Q3 FY26 earnings report.", time: "After Close" },
  { date: "2026-07-30", type: "earnings", title: "Earnings", ticker: "AMZN", detail: "Amazon Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-08-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-08-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-08-21", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-09-04", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-09-07", type: "holiday", title: "Labor Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-09-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-09-16", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-09-18", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-10-02", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-10-13", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-10-16", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-10-22", type: "earnings", title: "Earnings", ticker: "TSLA", detail: "Tesla Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-10-27", type: "earnings", title: "Earnings", ticker: "GOOG", detail: "Alphabet Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-10-28", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-10-28", type: "earnings", title: "Earnings", ticker: "META", detail: "Meta Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-10-28", type: "earnings", title: "Earnings", ticker: "MSFT", detail: "Microsoft Q1 FY27 earnings report.", time: "After Close" },
  { date: "2026-10-29", type: "earnings", title: "Earnings", ticker: "AAPL", detail: "Apple Q4 FY26 earnings report.", time: "After Close" },
  { date: "2026-10-29", type: "earnings", title: "Earnings", ticker: "AMZN", detail: "Amazon Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-11-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-11-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-11-20", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-11-26", type: "holiday", title: "Thanksgiving Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-11-27", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET." },
  { date: "2026-12-04", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET", blsType: "nfp", reportUrl: "https://www.bls.gov/news.release/empsit.nr0.htm" },
  { date: "2026-12-09", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET", blsType: "cpi", reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm" },
  { date: "2026-12-16", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-12-18", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-12-24", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET ahead of Christmas." },
  { date: "2026-12-25", type: "holiday", title: "Christmas Day", detail: "NYSE & NASDAQ closed." },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${(m + 1).toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

interface Props {
  onClose: () => void;
}

const BASE = import.meta.env.BASE_URL ?? "/";
const apiBase = `${BASE}api`;

function ReportViewer({ url, onClose, onCloseAll }: { url: string; onClose: () => void; onCloseAll?: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const blsType = url.includes("empsit") ? "nfp" : url.includes("cpi") ? "cpi" : url.includes("ppi") ? "ppi" : "nfp";
    fetch(`${apiBase}/economic/bls-report?type=${blsType}`)
      .then(async (res) => {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) {
          const html = await res.text();
          setContent(html);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [url]);

  if (error) {
    return (
      <div className="fixed left-0 right-0 bottom-0 z-[200] flex flex-col" style={{ top: "80px", background: "#0a0a0a" }}>
        <div className="flex items-center px-2 py-1 border-b border-[#2a2a2c]">
          <button onClick={onClose} className="p-1 shrink-0">
            <ChevronLeft className="w-4 h-4 text-zinc-500" />
          </button>
          <span className="font-mono text-[13px] text-zinc-400 flex-1 text-center">BLS Report</span>
          <button onClick={onCloseAll || onClose} className="p-1 shrink-0">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <p className="font-mono text-sm text-zinc-400 mb-4">Report could not be loaded in-app.</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm font-bold px-4 py-2 rounded-lg"
            style={{ color: "#FFB800", border: "1px solid #FFB800" }}
          >
            Open Report on BLS.gov
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed left-0 right-0 bottom-0 z-[200] flex flex-col" style={{ top: "80px", background: "#0a0a0a" }}>
      <div className="flex items-center px-2 py-1 border-b border-[#2a2a2c]">
        <button onClick={onClose} className="p-1 shrink-0">
          <ChevronLeft className="w-4 h-4 text-zinc-500" />
        </button>
        <span className="font-mono text-[13px] text-zinc-400 tracking-wider flex-1 text-center">BLS Report</span>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-lg transition-colors"
          >
            <ExternalLink className="w-4 h-4 text-zinc-500" />
          </a>
          <button onClick={onCloseAll || onClose} className="p-1 rounded-lg transition-colors">
            <X className="w-4 h-4 text-zinc-500" />
          </button>
        </div>
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-zinc-500 animate-spin" />
        </div>
      ) : content ? (
        <iframe
          srcDoc={content}
          className="flex-1 w-full"
          style={{ border: "none", background: "#ffffff" }}
          title="BLS Report"
          sandbox="allow-same-origin"
        />
      ) : null}
    </div>
  );
}

async function fetchBlsReport(blsType: string): Promise<BlsReportData | null> {
  try {
    const res = await fetch(`${apiBase}/economic/report?type=${blsType}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchNfpFull(): Promise<NfpFullData | null> {
  try {
    const res = await fetch(`${apiBase}/economic/nfp-full`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function MarketCalendar({ onClose }: Props) {
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [blsData, setBlsData] = useState<Record<string, BlsReportData>>({});
  const [blsLoading, setBlsLoading] = useState<string | null>(null);
  const [reportIframeUrl, setReportIframeUrl] = useState<string | null>(null);
  const [showFullBreakdown, setShowFullBreakdown] = useState(false);
  const [nfpData, setNfpData] = useState<NfpFullData | null>(null);
  const [nfpLoading, setNfpLoading] = useState(false);

  const toggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const eventMap = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of MARKET_EVENTS) {
      if (activeFilters.size > 0 && !activeFilters.has(ev.type)) continue;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [activeFilters]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const cells: { day: number; inMonth: boolean; key: string }[] = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      cells.push({ day: d, inMonth: false, key: dateKey(y, m, d) });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, inMonth: true, key: dateKey(year, month, d) });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      const m = month === 11 ? 0 : month + 1;
      const y = month === 11 ? year + 1 : year;
      cells.push({ day: d, inMonth: false, key: dateKey(y, m, d) });
    }
    return cells;
  }, [year, month]);

  const prevMonth = useCallback(() => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  }, [month, year]);

  const nextMonth = useCallback(() => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  }, [month, year]);

  const todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());

  const selectedEvents = selectedDate ? (eventMap[selectedDate] || []) : [];

  const handleTickerClick = useCallback((ticker: string) => {
    setSymbol(ticker);
    onClose();
  }, [setSymbol, onClose]);

  const isNfpEvent = selectedEvent?.blsType === "nfp";

  const closeAll = useCallback(() => {
    setSelectedDate(null);
    setSelectedEvent(null);
    setShowFullBreakdown(false);
    setReportIframeUrl(null);
  }, []);

  useEffect(() => {
    if (!selectedEvent?.blsType) return;
    if (isNfpEvent) {
      if (nfpData) return;
      setNfpLoading(true);
      fetchNfpFull().then((data) => {
        if (data) setNfpData(data);
        setNfpLoading(false);
      });
      return;
    }
    if (blsData[selectedEvent.blsType]) return;
    setBlsLoading(selectedEvent.blsType);
    fetchBlsReport(selectedEvent.blsType).then((data) => {
      if (data) {
        setBlsData((prev) => ({ ...prev, [selectedEvent.blsType!]: data }));
      }
      setBlsLoading(null);
    });
  }, [selectedEvent?.blsType]);

  const [filterOpen, setFilterOpen] = useState(false);

  return (
    <div className="flex flex-col h-full max-w-xl mx-auto" onClick={() => filterOpen && setFilterOpen(false)}>
      <div className="flex items-center justify-between mb-1">
        <div className="relative">
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className="font-mono font-bold text-[13px] tracking-wider px-2 py-1 rounded-md transition-colors hover:bg-[#1a1a1c]"
            style={{ color: activeFilters.size > 0 ? "#FFB800" : "#a1a1aa" }}
          >
            Filter{activeFilters.size > 0 ? ` (${activeFilters.size})` : ""}
          </button>
          {filterOpen && (
            <div className="absolute top-full left-0 mt-1 bg-[#1a1a1c] border border-[#2a2a2c] rounded-lg py-1 z-50 min-w-[180px] shadow-xl" onClick={(e) => e.stopPropagation()}>
              {Object.entries(TYPE_LABELS).map(([type, label]) => {
                const isOn = activeFilters.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleFilter(type)}
                    className="w-full text-left px-3 py-2 font-mono text-[11px] tracking-wider transition-colors hover:bg-[#252528] flex items-center gap-2"
                  >
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[type] }} />
                    <span className="flex-1" style={{ color: isOn ? TYPE_COLORS[type] : "#a1a1aa" }}>{label}</span>
                    <div
                      className="w-7 h-4 rounded-full relative transition-colors shrink-0"
                      style={{ background: isOn ? TYPE_COLORS[type] : "#3a3a3c" }}
                    >
                      <div
                        className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                        style={{ left: isOn ? "14px" : "2px" }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-0">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-[#1a1a1c] transition-colors">
            <ChevronLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <span className="font-mono font-bold text-sm text-white tracking-wider mx-1">
            {MONTHS[month]} {year}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-[#1a1a1c] transition-colors">
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          </button>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-[#1a1a1c] transition-colors">
          <X className="w-5 h-5 text-zinc-400" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center font-mono text-[9px] text-zinc-600 tracking-wider py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0 flex-shrink-0">
        {calendarDays.map((cell) => {
          const events = eventMap[cell.key] || [];
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selectedDate;
          const isWeekend = new Date(cell.key).getDay() === 0 || new Date(cell.key).getDay() === 6;
          const hasHoliday = events.some((e) => e.type === "holiday");

          return (
            <button
              key={cell.key}
              onClick={() => {
                setSelectedDate(cell.key === selectedDate ? null : cell.key);
                setSelectedEvent(null);
                setShowFullBreakdown(false);
              }}
              className="relative flex flex-col items-center py-1 min-h-[48px] rounded-md transition-all justify-center"
              style={{
                background: "transparent",
                border: isSelected ? "1px solid #FFB80060" : isToday ? "1px solid #ffffff20" : "1px solid transparent",
              }}
            >
              <span
                className={`font-mono ${cell.inMonth ? "text-[22px] font-extrabold" : "text-[12px] font-normal"}`}
                style={{
                  color: !cell.inMonth ? "#2a2a2c"
                    : hasHoliday ? "#f23645"
                    : isToday ? "#FFB800"
                    : isWeekend ? "#a1a1aa"
                    : "#e4e4e7",
                }}
              >
                {cell.day}
              </span>
              {events.length > 0 && cell.inMonth && (
                <div className="flex gap-0.5 mt-0.5 flex-wrap justify-center max-w-full">
                  {events.slice(0, 3).map((ev, i) => (
                    <div
                      key={i}
                      className="w-[5px] h-[5px] rounded-full"
                      style={{ background: TYPE_COLORS[ev.type] }}
                    />
                  ))}
                  {events.length > 3 && (
                    <span className="font-mono text-[7px] text-zinc-500">+{events.length - 3}</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && !selectedEvent && (
        <div className="mt-1 border-t border-[#2a2a2c] pt-1 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => setSelectedDate(null)} className="p-1">
              <ChevronLeft className="w-4 h-4 text-zinc-500" />
            </button>
            <span className="font-mono text-[10px] text-zinc-500 tracking-wider flex-1 text-center">
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </span>
            <button onClick={closeAll} className="p-1">
              <X className="w-3.5 h-3.5 text-zinc-600" />
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="font-mono text-[11px] text-zinc-600 py-4 text-center">No events scheduled</p>
          ) : (
            <div className="space-y-1.5 flex-1">
              {selectedEvents.map((ev, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedEvent(ev)}
                  className="w-full text-left rounded-lg p-3 transition-all hover:bg-[#1a1a1c]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[ev.type] }} />
                    <span className="font-mono text-[10px] tracking-wider" style={{ color: TYPE_COLORS[ev.type] }}>
                      {TYPE_LABELS[ev.type]}
                    </span>
                    {ev.time && (
                      <span className="font-mono text-[9px] text-zinc-600 ml-auto">{ev.time}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.ticker && (
                      <span className="font-mono font-bold text-sm" style={{ color: "#FFB800" }}>
                        {ev.ticker}
                      </span>
                    )}
                    <span className="font-mono text-[12px] text-white font-semibold">{ev.title}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedEvent && !showFullBreakdown && !isNfpEvent && (
        <div className="mt-1 flex-1 flex flex-col relative" style={{ borderTop: `1px solid ${TYPE_COLORS[selectedEvent.type]}30` }}>
          <div className="flex items-center justify-between px-2 py-1 border-b border-[#1a1a1c]">
            <button onClick={() => setSelectedEvent(null)} className="p-1">
              <ChevronLeft className="w-4 h-4 text-zinc-500" />
            </button>
            <span className="font-mono text-[12px] font-bold text-white flex-1 text-center truncate px-2">{selectedEvent.title}</span>
            <button onClick={closeAll} className="p-1">
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center px-4">
            {selectedEvent.type === "holiday" ? (
              <div className="flex flex-col items-center justify-center">
                <span className="font-mono text-xl font-extrabold text-white mb-2">{selectedEvent.title}</span>
                <span className="font-mono text-[11px] text-zinc-500 tracking-wider">Holiday · Markets Closed</span>
              </div>
            ) : (
              <div className="w-full">
                {selectedEvent.blsType && blsLoading === selectedEvent.blsType && (
                  <div className="flex items-center justify-center gap-2 py-4">
                    <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                    <span className="font-mono text-[11px] text-zinc-500">Loading...</span>
                  </div>
                )}

                {selectedEvent.blsType && blsData[selectedEvent.blsType]?.change && (() => {
                  const d = blsData[selectedEvent.blsType]!;
                  const c = d.change!;
                  const raw = c.actualRaw;
                  const isPositive = raw >= 0;
                  const color = isPositive ? "#26a69a" : "#f23645";
                  const arrow = isPositive ? "▲" : "▼";
                  const fullNum = d.unit === "thousands"
                    ? Math.abs(raw).toLocaleString()
                    : c.actual;
                  const sign = d.unit === "thousands" && isPositive ? "+" : d.unit === "thousands" ? "-" : "";
                  return (
                    <div className="flex flex-col gap-2">
                      <span className="font-mono text-[13px] font-bold text-white">{selectedEvent.title}</span>
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-2xl font-extrabold" style={{ color }}>{sign}{fullNum}</span>
                        <span className="text-sm" style={{ color }}>{arrow}</span>
                      </div>
                      {d.summary && (
                        <p className="font-mono text-[11px] text-zinc-400 leading-relaxed">{d.summary}</p>
                      )}
                    </div>
                  );
                })()}

                {selectedEvent.detail && (!selectedEvent.blsType || !blsData[selectedEvent.blsType]?.change) && !blsLoading && (
                  <p className="font-mono text-[11px] text-zinc-400 leading-relaxed">{selectedEvent.detail}</p>
                )}
              </div>
            )}
          </div>

          {selectedEvent.blsType && blsData[selectedEvent.blsType]?.change && (
            <button
              onClick={() => setShowFullBreakdown(true)}
              className="absolute bottom-2 right-3 font-mono text-[10px] text-white tracking-wider transition-opacity hover:opacity-70"
            >
              Read More
            </button>
          )}
        </div>
      )}

      {selectedEvent && isNfpEvent && (() => {
        const upColor = "#26a69a";
        const downColor = "#f23645";
        const neutralColor = "#a1a1aa";
        const reportUrl = "https://www.bls.gov/news.release/empsit.nr0.htm";
        const meta = nfpData?._meta;
        const nfp = nfpData?.nfp;

        const mc = (val: number, invert = false) => {
          if (val === 0) return neutralColor;
          return invert ? (val > 0 ? downColor : upColor) : (val >= 0 ? upColor : downColor);
        };

        const SummaryRow = ({ label, data, invertColor }: { label: string; data?: NfpSeriesResult; invertColor?: boolean }) => {
          if (!data || data.error) return null;
          const c = mc(data.changeRaw, invertColor);
          return (
            <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
              <span className="font-mono text-[15px] text-zinc-400 flex-1 min-w-0 truncate">{label}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[76px] text-right shrink-0" style={{ color: c }}>{data.unit === "thousands" ? data.change : data.actual}</span>
              <span className="font-mono text-[15px] text-zinc-500 tabular-nums w-[76px] text-right shrink-0">{data.previous}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[76px] text-right shrink-0" style={{ color: c }}>{data.change}</span>
            </div>
          );
        };

        const FullRow = ({ label, data, invertColor }: { label: string; data?: NfpSeriesResult; invertColor?: boolean }) => {
          if (!data || data.error) return null;
          const c = mc(data.changeRaw, invertColor);
          return (
            <div className="flex items-center py-1 border-b border-[#1a1a1c] gap-1">
              <span className="font-mono text-[15px] text-zinc-400 flex-1 min-w-0 truncate">{label}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[72px] text-right shrink-0" style={{ color: c }}>{data.unit === "thousands" ? data.change : data.actual}</span>
              <span className="font-mono text-[15px] text-zinc-500 tabular-nums w-[64px] text-right shrink-0">{data.previous}</span>
              <span className="font-mono text-[14px] text-zinc-600 tabular-nums w-[60px] text-right shrink-0">{data.threeMonthAvg || "—"}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[72px] text-right shrink-0" style={{ color: c }}>{data.change}</span>
            </div>
          );
        };

        const sectorKeys: Array<{ key: keyof NfpFullData; label: string }> = [
          { key: "healthCare", label: "Health Care" },
          { key: "leisureHosp", label: "Leisure & Hospitality" },
          { key: "construction", label: "Construction" },
          { key: "transportWare", label: "Transport & Warehousing" },
          { key: "manufacturing", label: "Manufacturing" },
          { key: "financialAct", label: "Financial Activities" },
          { key: "fedGov", label: "Federal Government" },
        ];
        const sortedSectors = nfpData ? sectorKeys
          .filter(s => {
            const d = nfpData[s.key] as NfpSeriesResult | undefined;
            return d && !d.error;
          })
          .sort((a, b) => {
            const aD = nfpData[a.key] as NfpSeriesResult;
            const bD = nfpData[b.key] as NfpSeriesResult;
            return (bD?.changeRaw || 0) - (aD?.changeRaw || 0);
          }) : [];

        return (
          <div
            className={showFullBreakdown
              ? "fixed left-0 right-0 bottom-0 z-[150] flex flex-col bg-[#0c0c0c] border-t border-[#2a2a2c] animate-in slide-in-from-bottom duration-300"
              : "flex flex-col bg-[#0c0c0c] border-t border-[#2a2a2c] flex-1 mt-1 overflow-hidden"
            }
            style={showFullBreakdown ? { top: "80px" } : undefined}
          >
            <div className="flex items-center px-2 py-1 shrink-0">
              <button onClick={() => { if (showFullBreakdown) setShowFullBreakdown(false); else setSelectedEvent(null); }} className="p-1 shrink-0">
                <ChevronLeft className="w-4 h-4 text-zinc-500" />
              </button>
              <span className="font-mono text-[13px] font-bold text-white flex-1 text-center truncate px-1">
                Jobs Report (NFP){meta ? ` — ${meta.month} ${meta.year}` : ""} 8:30 AM ET (BLS)
              </span>
              <button onClick={closeAll} className="p-1 shrink-0">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
            <div className="border-b border-[#1a1a1c]" />

            {nfpLoading && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                <span className="font-mono text-[11px] text-zinc-500">Loading jobs report...</span>
              </div>
            )}

            {!nfpLoading && !nfp && nfpData && (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[11px] text-zinc-500">Unable to load NFP data. Please try again later.</span>
              </div>
            )}

            {!nfpLoading && !nfp && !nfpData && !nfpLoading && (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[11px] text-zinc-500">No jobs report data available.</span>
              </div>
            )}

            {nfp && !showFullBreakdown && (
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[33px] font-extrabold tabular-nums leading-tight" style={{ color: mc(nfp.changeRaw) }}>{nfp.change}</span>
                  <span className="text-[21px]" style={{ color: mc(nfp.changeRaw) }}>{nfp.changeRaw >= 0 ? "↑" : "↓"}</span>
                  {nfp.expected && (
                    <span className="font-mono text-[14px] text-zinc-500 ml-1">vs {nfp.expected}</span>
                  )}
                </div>

                <div>
                  <div className="flex items-center pb-1 border-b border-[#2a2a2c] gap-2">
                    <span className="font-mono text-[11px] text-zinc-600 flex-1">METRIC</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">ACTUAL</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">PRIOR</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">CHANGE</span>
                  </div>
                  <SummaryRow label="Unemployment Rate" data={nfpData.unemployment} invertColor />
                  <SummaryRow label="Avg Hourly Earnings MoM" data={nfpData.earningsMom} />
                  {nfpData.earningsYoy && <SummaryRow label="Avg Hourly Earnings YoY" data={nfpData.earningsYoy} />}
                  <SummaryRow label="Private Payrolls" data={nfpData.privatePayroll} />
                  <SummaryRow label="Labor Force Part." data={nfpData.lfpr} />
                </div>

                <div className="flex items-center justify-end pt-1">
                  <button
                    onClick={() => setShowFullBreakdown(true)}
                    className="font-mono text-[14px] font-bold tracking-wider transition-opacity hover:opacity-70"
                    style={{ color: "#FFB800" }}
                  >
                    Read More
                  </button>
                </div>
              </div>
            )}

            {nfp && showFullBreakdown && (
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">EXPANDED KEY METRICS</span>
                  <div className="flex items-center pb-1 border-b border-[#2a2a2c] gap-1">
                    <span className="font-mono text-[11px] text-zinc-600 flex-1">METRIC</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[72px] text-right shrink-0">ACTUAL</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[64px] text-right shrink-0">PREV</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[60px] text-right shrink-0">3-MO</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[72px] text-right shrink-0">CHG</span>
                  </div>
                  <FullRow label="Nonfarm Payrolls" data={nfpData.nfp} />
                  <FullRow label="Unemployment Rate" data={nfpData.unemployment} invertColor />
                  <FullRow label="Hourly Earnings MoM" data={nfpData.earningsMom} />
                  {nfpData.earningsYoy && <FullRow label="Hourly Earnings YoY" data={nfpData.earningsYoy} />}
                  <FullRow label="Private Payrolls" data={nfpData.privatePayroll} />
                  <FullRow label="Labor Force Part." data={nfpData.lfpr} />
                </div>

                {meta?.prevMonths && meta.prevMonths.length > 0 && (
                  <div>
                    <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">REVISIONS</span>
                    <div className="rounded-md border border-[#2a2a2c] p-2.5 space-y-1.5">
                      {meta.prevMonths.map((pm, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="font-mono text-[15px] text-zinc-400">{pm.month} (revised)</span>
                          <span className="font-mono text-[16px] font-bold tabular-nums" style={{ color: mc(pm.changeRaw) }}>{pm.change}</span>
                        </div>
                      ))}
                      <div className="border-t border-[#1a1a1c] pt-1.5 mt-1.5 flex items-center gap-4">
                        {meta.threeMonthNfpAvg && (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[14px] text-zinc-600">3-Mo Avg:</span>
                            <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{meta.threeMonthNfpAvg}</span>
                          </div>
                        )}
                        {meta.sixMonthNfpAvg && (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[14px] text-zinc-600">6-Mo Avg:</span>
                            <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{meta.sixMonthNfpAvg}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {sortedSectors.length > 0 && (
                  <div>
                    <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">SECTOR JOB GAINS / LOSSES</span>
                    <div className="space-y-0">
                      {sortedSectors.map(s => {
                        const d = nfpData[s.key] as NfpSeriesResult;
                        return (
                          <div key={s.key} className="flex items-center justify-between py-1 border-b border-[#1a1a1c]">
                            <span className="font-mono text-[15px] text-zinc-400">{s.label}</span>
                            <span className="font-mono text-[16px] font-bold tabular-nums" style={{ color: mc(d.changeRaw) }}>{d.change}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">HOUSEHOLD SURVEY SNAPSHOT</span>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {nfpData.employed && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Employed</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: mc(nfpData.employed.changeRaw) }}>{nfpData.employed.change}</span>
                      </div>
                    )}
                    {nfpData.unemployed && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Unemployed</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: mc(nfpData.unemployed.changeRaw, true) }}>{nfpData.unemployed.change}</span>
                      </div>
                    )}
                    {nfpData.laborForce && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Labor Force</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: mc(nfpData.laborForce.changeRaw) }}>{nfpData.laborForce.change}</span>
                      </div>
                    )}
                    {nfpData.empPopRatio && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Emp-Pop Ratio</span>
                        <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{nfpData.empPopRatio.actual}</span>
                      </div>
                    )}
                    {nfpData.u6 && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">U-6 Rate</span>
                        <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{nfpData.u6.actual}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">OTHER KEY DETAILS</span>
                  <div className="flex items-center gap-6">
                    {nfpData.weeklyHours && (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[15px] text-zinc-400">Avg Workweek:</span>
                        <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{nfpData.weeklyHours.actual}h</span>
                        <span className="font-mono text-[14px] tabular-nums" style={{ color: mc(nfpData.weeklyHours.changeRaw) }}>({nfpData.weeklyHours.change})</span>
                      </div>
                    )}
                  </div>
                  {(nfpData.privatePayroll || nfpData.govPayroll) && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="font-mono text-[15px] text-zinc-400">Split:</span>
                      {nfpData.privatePayroll && <span className="font-mono text-[15px] text-zinc-300 tabular-nums">Private {nfpData.privatePayroll.change}</span>}
                      {nfpData.privatePayroll && nfpData.govPayroll && <span className="font-mono text-[15px] text-zinc-600">|</span>}
                      {nfpData.govPayroll && <span className="font-mono text-[15px] text-zinc-300 tabular-nums">Gov {nfpData.govPayroll.change}</span>}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end pb-4 -mt-2">
                  <button
                    onClick={() => setReportIframeUrl(reportUrl)}
                    className="flex items-center gap-1.5 font-mono text-[14px] font-bold tracking-wider transition-opacity hover:opacity-70 pr-6 pl-2"
                    style={{ color: "#FFB800" }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Read Full Report
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showFullBreakdown && selectedEvent?.blsType && !isNfpEvent && blsData[selectedEvent.blsType]?.change && (() => {
        const d = blsData[selectedEvent.blsType]!;
        const c = d.change!;
        const raw = c.actualRaw;
        const isPositive = raw >= 0;
        const upColor = "#26a69a";
        const downColor = "#f23645";
        const mainColor = isPositive ? upColor : downColor;
        const arrow = isPositive ? "▲" : "▼";
        const fullNum = d.unit === "thousands" ? Math.abs(raw).toLocaleString() : c.actual;
        const sign = d.unit === "thousands" && isPositive ? "+" : d.unit === "thousands" ? "-" : "";
        const reportUrl = selectedEvent.reportUrl || d.reportUrl;

        return (
          <div
            className="fixed left-0 right-0 bottom-0 z-[150] flex flex-col bg-[#0c0c0c] border-t animate-in slide-in-from-bottom duration-300"
            style={{ top: "80px", borderColor: `${mainColor}40` }}
          >
            <div className="flex items-center px-2 py-1 border-b border-[#1a1a1c]">
              <button onClick={() => setShowFullBreakdown(false)} className="p-1 shrink-0">
                <ChevronLeft className="w-4 h-4 text-zinc-500" />
              </button>
              <span className="font-mono text-[13px] font-bold text-white flex-1 text-center truncate px-2">{selectedEvent.title}</span>
              <button onClick={closeAll} className="p-1 shrink-0">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>

            <div className="flex-1 flex flex-col justify-center px-5 py-4 gap-5 relative">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-3xl font-extrabold" style={{ color: mainColor }}>{sign}{fullNum}</span>
                <span className="text-lg" style={{ color: mainColor }}>{arrow}</span>
                <span className="font-mono text-[10px] text-zinc-600 ml-1">{c.currentMonth} {c.currentYear}</span>
              </div>

              <div className="flex gap-6">
                <div>
                  <span className="font-mono text-[9px] text-zinc-600 block tracking-wider mb-1">CURRENT</span>
                  <span className="font-mono text-base font-bold text-white">{c.currentLevel || d.latest.value}</span>
                </div>
                <div>
                  <span className="font-mono text-[9px] text-zinc-600 block tracking-wider mb-1">PREVIOUS</span>
                  <span className="font-mono text-base font-semibold text-zinc-400">{c.previousLevel}</span>
                </div>
                <div>
                  <span className="font-mono text-[9px] text-zinc-600 block tracking-wider mb-1">CHANGE</span>
                  <span className="font-mono text-base font-bold" style={{ color: mainColor }}>{c.actual}</span>
                </div>
              </div>

              {d.recentHistory.length > 0 && (
                <div>
                  <span className="font-mono text-[9px] text-zinc-600 tracking-wider block mb-2">RECENT MONTHS</span>
                  <div className="flex gap-3">
                    {d.recentHistory.slice(0, 6).map((h, hi) => {
                      const val = parseFloat(h.value);
                      const prevVal = d.recentHistory[hi + 1] ? parseFloat(d.recentHistory[hi + 1].value) : val;
                      let barColor = "#3a3a3c";
                      if (d.unit === "thousands") {
                        barColor = val > prevVal ? upColor : val < prevVal ? downColor : "#3a3a3c";
                      } else if (d.unit === "percent") {
                        barColor = val < prevVal ? upColor : val > prevVal ? downColor : "#3a3a3c";
                      } else {
                        const pct = ((val - prevVal) / prevVal) * 100;
                        barColor = pct >= 0 ? upColor : downColor;
                      }
                      return (
                        <div key={hi} className="flex flex-col items-center gap-1 flex-1">
                          <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color: barColor }}>
                            {d.unit === "thousands" ? `${((val - prevVal) * 1000) >= 0 ? "+" : ""}${Math.round((val - prevVal) * 1000).toLocaleString()}` : h.value}
                          </span>
                          <div className="w-full h-1 rounded-full" style={{ background: barColor }} />
                          <span className="font-mono text-[8px] text-zinc-600">{h.month.slice(0, 3)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {d.summary && (
                <p className="font-mono text-[11px] text-zinc-500 leading-relaxed">{d.summary}</p>
              )}

              {reportUrl && (
                <button
                  onClick={() => setReportIframeUrl(reportUrl)}
                  className="absolute bottom-4 right-5 font-mono text-[10px] text-white tracking-wider transition-opacity hover:opacity-70"
                >
                  Read Full Report
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {!selectedDate && (() => {
        const filterFn = (ev: CalendarEvent) => activeFilters.size === 0 || activeFilters.has(ev.type);
        const todayEvents = MARKET_EVENTS.filter((ev) => ev.date === todayKey && filterFn(ev));
        const upcomingEvents = MARKET_EVENTS.filter((ev) => ev.date > todayKey && filterFn(ev)).slice(0, 10);

        const renderRow = (ev: CalendarEvent, i: number, showDate: boolean) => (
          <button
            key={i}
            onClick={() => { setSelectedDate(ev.date); setSelectedEvent(ev); }}
            className="w-full text-left flex items-center gap-2 px-2 py-1 rounded-lg transition-colors hover:bg-[#1a1a1c]"
          >
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[ev.type] }} />
            {showDate && (
              <span className="font-mono text-[13px] text-zinc-500 w-[75px] shrink-0">
                {new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            )}
            {ev.ticker && (
              <span
                onClick={(e) => { e.stopPropagation(); handleTickerClick(ev.ticker!); }}
                className="font-mono font-bold text-[13px] shrink-0"
                style={{ color: "#FFB800" }}
              >
                {ev.ticker}
              </span>
            )}
            <span className="font-mono text-[14px] text-zinc-300 truncate">{ev.title}</span>
            {ev.time && <span className="font-mono text-[11px] text-zinc-500 ml-auto shrink-0">{ev.time}</span>}
          </button>
        );

        return (
          <div className="mt-1 border-t border-[#2a2a2c] pt-1 flex-1 overflow-y-auto">
            {todayEvents.length > 0 && (
              <>
                <span className="font-mono text-[10px] text-zinc-600 tracking-widest block mb-1 mt-1">TODAY</span>
                <div>
                  {todayEvents.map((ev, i) => renderRow(ev, i, false))}
                </div>
              </>
            )}
            {upcomingEvents.length > 0 && (
              <>
                <span className="font-mono text-[10px] text-zinc-600 tracking-widest block mb-1 mt-1">UPCOMING</span>
                <div>
                  {upcomingEvents.map((ev, i) => renderRow(ev, i, true))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {reportIframeUrl && (
        <ReportViewer url={reportIframeUrl} onClose={() => setReportIframeUrl(null)} onCloseAll={closeAll} />
      )}
    </div>
  );
}
