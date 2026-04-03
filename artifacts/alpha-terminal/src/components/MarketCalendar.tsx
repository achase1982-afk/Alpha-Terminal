import { useState, useMemo, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface CalendarEvent {
  date: string;
  type: "holiday" | "fomc" | "economic" | "earnings" | "opex" | "witching";
  title: string;
  ticker?: string;
  detail?: string;
  time?: string;
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
  { date: "2025-01-14", type: "economic", title: "PPI Report", detail: "Producer Price Index measures wholesale inflation. Higher than expected = hawkish." },
  { date: "2025-01-15", type: "economic", title: "CPI Report", detail: "Consumer Price Index — key inflation gauge watched by the Fed.", time: "8:30 AM ET" },
  { date: "2025-01-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration. Expect increased volatility and volume." },
  { date: "2025-01-20", type: "holiday", title: "MLK Jr. Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-01-29", type: "fomc", title: "FOMC Decision", detail: "Federal Open Market Committee rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-01-30", type: "earnings", title: "AAPL Earnings", ticker: "AAPL", detail: "Apple Q1 FY25 earnings report.", time: "After Close" },
  { date: "2025-01-30", type: "earnings", title: "MSFT Earnings", ticker: "MSFT", detail: "Microsoft Q2 FY25 earnings report.", time: "After Close" },
  { date: "2025-02-05", type: "earnings", title: "GOOG Earnings", ticker: "GOOG", detail: "Alphabet Q4 2024 earnings report.", time: "After Close" },
  { date: "2025-02-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls — monthly employment data.", time: "8:30 AM ET" },
  { date: "2025-02-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index — key inflation gauge.", time: "8:30 AM ET" },
  { date: "2025-02-17", type: "holiday", title: "Presidents' Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-02-21", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-03-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-03-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-03-19", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + economic projections.", time: "2:00 PM ET" },
  { date: "2025-03-21", type: "witching", title: "Quad Witching", detail: "Quarterly expiration of stock options, index options, index futures, and single stock futures." },
  { date: "2025-04-02", type: "economic", title: "ADP Employment", detail: "Private sector employment change.", time: "8:15 AM ET" },
  { date: "2025-04-04", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-04-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-04-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-04-18", type: "holiday", title: "Good Friday", detail: "NYSE & NASDAQ closed." },
  { date: "2025-05-02", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-05-07", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-05-13", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-05-16", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-05-26", type: "holiday", title: "Memorial Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-06-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-06-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-06-18", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2025-06-19", type: "holiday", title: "Juneteenth", detail: "NYSE & NASDAQ closed." },
  { date: "2025-06-20", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2025-07-03", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET ahead of Independence Day." },
  { date: "2025-07-04", type: "holiday", title: "Independence Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-07-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-07-18", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-07-30", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-08-01", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-08-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-08-15", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-09-01", type: "holiday", title: "Labor Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-09-05", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-09-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-09-17", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2025-09-19", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2025-10-03", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-10-14", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-10-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-10-29", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2025-11-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-11-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-11-21", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2025-11-27", type: "holiday", title: "Thanksgiving Day", detail: "NYSE & NASDAQ closed." },
  { date: "2025-11-28", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET." },
  { date: "2025-12-05", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2025-12-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2025-12-17", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2025-12-19", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2025-12-24", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET ahead of Christmas." },
  { date: "2025-12-25", type: "holiday", title: "Christmas Day", detail: "NYSE & NASDAQ closed." },

  { date: "2026-01-01", type: "holiday", title: "New Year's Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-01-09", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-01-14", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-01-16", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-01-19", type: "holiday", title: "MLK Jr. Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-01-28", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-01-29", type: "earnings", title: "AAPL Earnings", ticker: "AAPL", detail: "Apple Q1 FY26 earnings report.", time: "After Close" },
  { date: "2026-01-29", type: "earnings", title: "MSFT Earnings", ticker: "MSFT", detail: "Microsoft Q2 FY26 earnings report.", time: "After Close" },
  { date: "2026-02-04", type: "earnings", title: "AMZN Earnings", ticker: "AMZN", detail: "Amazon Q4 2025 earnings report.", time: "After Close" },
  { date: "2026-02-04", type: "earnings", title: "GOOG Earnings", ticker: "GOOG", detail: "Alphabet Q4 2025 earnings report.", time: "After Close" },
  { date: "2026-02-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-02-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-02-16", type: "holiday", title: "Presidents' Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-02-20", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-03-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-03-11", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-03-18", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-03-20", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-04-03", type: "holiday", title: "Good Friday", detail: "NYSE & NASDAQ closed." },
  { date: "2026-04-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-04-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-04-23", type: "earnings", title: "TSLA Earnings", ticker: "TSLA", detail: "Tesla Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-04-24", type: "earnings", title: "GOOG Earnings", ticker: "GOOG", detail: "Alphabet Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-04-28", type: "earnings", title: "META Earnings", ticker: "META", detail: "Meta Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-04-29", type: "earnings", title: "MSFT Earnings", ticker: "MSFT", detail: "Microsoft Q3 FY26 earnings report.", time: "After Close" },
  { date: "2026-04-30", type: "earnings", title: "AAPL Earnings", ticker: "AAPL", detail: "Apple Q2 FY26 earnings report.", time: "After Close" },
  { date: "2026-04-30", type: "earnings", title: "AMZN Earnings", ticker: "AMZN", detail: "Amazon Q1 2026 earnings report.", time: "After Close" },
  { date: "2026-05-01", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-05-06", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-05-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-05-15", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-05-25", type: "holiday", title: "Memorial Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-06-05", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-06-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-06-17", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-06-19", type: "holiday", title: "Juneteenth", detail: "NYSE & NASDAQ closed." },
  { date: "2026-06-19", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-07-02", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-07-03", type: "holiday", title: "Independence Day (Observed)", detail: "NYSE & NASDAQ closed." },
  { date: "2026-07-14", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-07-17", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-07-22", type: "earnings", title: "TSLA Earnings", ticker: "TSLA", detail: "Tesla Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-07-23", type: "earnings", title: "GOOG Earnings", ticker: "GOOG", detail: "Alphabet Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-07-28", type: "earnings", title: "META Earnings", ticker: "META", detail: "Meta Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-07-29", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-07-29", type: "earnings", title: "MSFT Earnings", ticker: "MSFT", detail: "Microsoft Q4 FY26 earnings report.", time: "After Close" },
  { date: "2026-07-30", type: "earnings", title: "AAPL Earnings", ticker: "AAPL", detail: "Apple Q3 FY26 earnings report.", time: "After Close" },
  { date: "2026-07-30", type: "earnings", title: "AMZN Earnings", ticker: "AMZN", detail: "Amazon Q2 2026 earnings report.", time: "After Close" },
  { date: "2026-08-07", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-08-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-08-21", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-09-04", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-09-07", type: "holiday", title: "Labor Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-09-10", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-09-16", type: "fomc", title: "FOMC Decision", detail: "Rate decision + dot plot + projections.", time: "2:00 PM ET" },
  { date: "2026-09-18", type: "witching", title: "Quad Witching", detail: "Quarterly options/futures expiration." },
  { date: "2026-10-02", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-10-13", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-10-16", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-10-22", type: "earnings", title: "TSLA Earnings", ticker: "TSLA", detail: "Tesla Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-10-27", type: "earnings", title: "GOOG Earnings", ticker: "GOOG", detail: "Alphabet Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-10-28", type: "fomc", title: "FOMC Decision", detail: "Rate decision and statement.", time: "2:00 PM ET" },
  { date: "2026-10-28", type: "earnings", title: "META Earnings", ticker: "META", detail: "Meta Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-10-28", type: "earnings", title: "MSFT Earnings", ticker: "MSFT", detail: "Microsoft Q1 FY27 earnings report.", time: "After Close" },
  { date: "2026-10-29", type: "earnings", title: "AAPL Earnings", ticker: "AAPL", detail: "Apple Q4 FY26 earnings report.", time: "After Close" },
  { date: "2026-10-29", type: "earnings", title: "AMZN Earnings", ticker: "AMZN", detail: "Amazon Q3 2026 earnings report.", time: "After Close" },
  { date: "2026-11-06", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-11-12", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
  { date: "2026-11-20", type: "opex", title: "Monthly OpEx", detail: "Monthly options expiration." },
  { date: "2026-11-26", type: "holiday", title: "Thanksgiving Day", detail: "NYSE & NASDAQ closed." },
  { date: "2026-11-27", type: "economic", title: "Early Close (1 PM)", detail: "Markets close at 1:00 PM ET." },
  { date: "2026-12-04", type: "economic", title: "Jobs Report (NFP)", detail: "Non-Farm Payrolls.", time: "8:30 AM ET" },
  { date: "2026-12-09", type: "economic", title: "CPI Report", detail: "Consumer Price Index.", time: "8:30 AM ET" },
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

export function MarketCalendar({ onClose }: Props) {
  const setSymbol = useTerminalStore((s) => s.setSymbol);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  const eventMap = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of MARKET_EVENTS) {
      if (filterType && ev.type !== filterType) continue;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [filterType]);

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

  return (
    <div className="flex flex-col h-full max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-[#1a1a1c] transition-colors">
          <ChevronLeft className="w-5 h-5 text-zinc-400" />
        </button>
        <div className="flex flex-col items-center">
          <span className="font-mono font-bold text-sm text-white tracking-wider">
            {MONTHS[month]} {year}
          </span>
        </div>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-[#1a1a1c] transition-colors">
          <ChevronRight className="w-5 h-5 text-zinc-400" />
        </button>
      </div>

      <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
        <button
          onClick={() => setFilterType(null)}
          className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[9px] tracking-wider transition-all"
          style={{
            background: filterType === null ? "#FFB80020" : "transparent",
            border: `1px solid ${filterType === null ? "#FFB80050" : "#2a2a2c"}`,
            color: filterType === null ? "#FFB800" : "#71717a",
          }}
        >
          All
        </button>
        {Object.entries(TYPE_LABELS).map(([type, label]) => (
          <button
            key={type}
            onClick={() => setFilterType(filterType === type ? null : type)}
            className="shrink-0 px-2.5 py-1 rounded-full font-mono text-[9px] tracking-wider transition-all"
            style={{
              background: filterType === type ? `${TYPE_COLORS[type]}20` : "transparent",
              border: `1px solid ${filterType === type ? `${TYPE_COLORS[type]}50` : "#2a2a2c"}`,
              color: filterType === type ? TYPE_COLORS[type] : "#71717a",
            }}
          >
            {label}
          </button>
        ))}
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
              }}
              className="relative flex flex-col items-center py-1.5 min-h-[48px] rounded-md transition-all"
              style={{
                background: isSelected ? "#FFB80015" : isToday ? "#ffffff08" : "transparent",
                border: isSelected ? "1px solid #FFB80040" : isToday ? "1px solid #ffffff15" : "1px solid transparent",
              }}
            >
              <span
                className="font-mono text-[11px] font-semibold"
                style={{
                  color: !cell.inMonth ? "#2a2a2c"
                    : hasHoliday ? "#f23645"
                    : isToday ? "#FFB800"
                    : isWeekend ? "#3a3a3c"
                    : "#a1a1aa",
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

      <div className="flex gap-2 flex-wrap mt-3 mb-2">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="font-mono text-[8px] text-zinc-600 tracking-wider">{TYPE_LABELS[type]}</span>
          </div>
        ))}
      </div>

      {selectedDate && (
        <div className="mt-2 border-t border-[#2a2a2c] pt-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] text-zinc-500 tracking-wider">
              {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </span>
            <button onClick={() => { setSelectedDate(null); setSelectedEvent(null); }} className="p-1">
              <X className="w-3.5 h-3.5 text-zinc-600" />
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="font-mono text-[11px] text-zinc-600 py-4 text-center">No events scheduled</p>
          ) : (
            <div className="space-y-1.5">
              {selectedEvents.map((ev, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedEvent(selectedEvent === ev ? null : ev)}
                  className="w-full text-left rounded-lg p-3 transition-all"
                  style={{
                    background: selectedEvent === ev ? `${TYPE_COLORS[ev.type]}10` : "#111113",
                    border: `1px solid ${selectedEvent === ev ? `${TYPE_COLORS[ev.type]}30` : "#1a1a1c"}`,
                  }}
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
                      <span
                        onClick={(e) => { e.stopPropagation(); handleTickerClick(ev.ticker!); }}
                        className="font-mono font-bold text-sm px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                        style={{
                          color: "#FFB800",
                          background: "#FFB80015",
                          border: "1px solid #FFB80030",
                        }}
                      >
                        {ev.ticker}
                      </span>
                    )}
                    <span className="font-mono text-[12px] text-white font-semibold">{ev.title}</span>
                  </div>
                  {selectedEvent === ev && ev.detail && (
                    <p className="font-mono text-[10px] text-zinc-400 mt-2 leading-relaxed">
                      {ev.detail}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!selectedDate && (
        <div className="mt-3 border-t border-[#2a2a2c] pt-3 flex-1 overflow-y-auto">
          <span className="font-mono text-[9px] text-zinc-600 tracking-widest block mb-2">UPCOMING</span>
          <div className="space-y-1">
            {MARKET_EVENTS
              .filter((ev) => ev.date >= todayKey && (!filterType || ev.type === filterType))
              .slice(0, 12)
              .map((ev, i) => (
                <button
                  key={i}
                  onClick={() => { setSelectedDate(ev.date); setSelectedEvent(ev); }}
                  className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#111113] transition-colors"
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: TYPE_COLORS[ev.type] }} />
                  <span className="font-mono text-[10px] text-zinc-500 w-[70px] shrink-0">
                    {new Date(ev.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  {ev.ticker && (
                    <span
                      onClick={(e) => { e.stopPropagation(); handleTickerClick(ev.ticker!); }}
                      className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      style={{ color: "#FFB800", background: "#FFB80015" }}
                    >
                      {ev.ticker}
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-zinc-300 truncate">{ev.title}</span>
                  {ev.time && <span className="font-mono text-[8px] text-zinc-600 ml-auto shrink-0">{ev.time}</span>}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
