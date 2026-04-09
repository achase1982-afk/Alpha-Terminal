import { useState, useMemo, useCallback, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { ChevronLeft, ChevronRight, X, ExternalLink, Loader2 } from "lucide-react";
import { generateMarketEvents, benzingaEarningsToEvents, type CalendarEvent, type BenzingaEarning } from "@/lib/calendarEvents";

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
  expected?: string;
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

interface NfpMonthData {
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

interface NfpFullData extends NfpMonthData {
  byMonth?: Record<string, NfpMonthData>;
}

interface FomcRateData {
  lower: number;
  upper: number;
  display: string;
  action: string;
  changeBps: number;
  changeDisplay: string;
  vote: string;
  dissenters: string;
}

interface FomcMeetingData {
  statementDate: string;
  meetingRange: string;
  year: number;
  month: number;
  hasSEP: boolean;
  statementUrl: string;
  minutesUrl: string;
  sepUrl: string | null;
  pressConferenceUrl: string;
  status: "upcoming" | "completed";
  rate: FomcRateData | null;
  keyExcerpt: string;
}

interface InflationSeriesResult {
  label: string;
  unit: string;
  actual: string;
  previous: string;
  change: string;
  changeRaw: number;
  momRaw: number;
  prevMomRaw: number;
  month: string;
  year: string;
  level?: string;
  prevLevel?: string;
  yoy?: string;
  yoyRaw?: number;
  prevYoy?: string;
  prevYoyRaw?: number;
  expected?: string;
  error?: string;
}

interface InflationMonthData {
  headline?: InflationSeriesResult;
  core?: InflationSeriesResult;
  food?: InflationSeriesResult;
  energy?: InflationSeriesResult;
  shelter?: InflationSeriesResult;
  medical?: InflationSeriesResult;
  transport?: InflationSeriesResult;
  apparel?: InflationSeriesResult;
  usedCars?: InflationSeriesResult;
  _meta?: {
    month: string;
    year: string;
    recentMom?: Array<{ month: string; value: string; raw: number }>;
    reportUrl: string;
  };
}

interface InflationFullData extends InflationMonthData {
  byMonth?: Record<string, InflationMonthData>;
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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${(m + 1).toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

function refMonthKey(eventDate: string): string {
  const d = new Date(eventDate + "T12:00:00");
  let refM = d.getMonth();
  let refY = d.getFullYear();
  if (refM === 0) { refM = 12; refY -= 1; }
  return `${refY}-${String(refM).padStart(2, "0")}`;
}

function refMonthLabel(eventDate: string): string {
  const d = new Date(eventDate + "T12:00:00");
  let refM = d.getMonth();
  let refY = d.getFullYear();
  if (refM === 0) { refM = 12; refY -= 1; }
  return `${MONTHS[refM - 1]} ${refY}`;
}

function refMonthName(eventDate: string): string {
  const d = new Date(eventDate + "T12:00:00");
  let refM = d.getMonth();
  if (refM === 0) refM = 12;
  return MONTHS[refM - 1];
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

async function fetchPpiFull(): Promise<InflationFullData | null> {
  try {
    const res = await fetch(`${apiBase}/economic/ppi-full`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchCpiFull(): Promise<InflationFullData | null> {
  try {
    const res = await fetch(`${apiBase}/economic/cpi-full`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchFomcData(): Promise<FomcMeetingData[]> {
  try {
    const res = await fetch(`${apiBase}/economic/fomc-data`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.meetings || [];
  } catch {
    return [];
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
  const [ppiData, setPpiData] = useState<InflationFullData | null>(null);
  const [ppiLoading, setPpiLoading] = useState(false);
  const [cpiData, setCpiData] = useState<InflationFullData | null>(null);
  const [cpiLoading, setCpiLoading] = useState(false);
  const [fomcMeetings, setFomcMeetings] = useState<FomcMeetingData[]>([]);
  const [fomcLoading, setFomcLoading] = useState(false);
  const [apiEarnings, setApiEarnings] = useState<CalendarEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/market/earnings-calendar`)
      .then(r => r.json())
      .then((data: { earnings?: BenzingaEarning[] }) => {
        if (!cancelled && data.earnings && data.earnings.length > 0) {
          setApiEarnings(benzingaEarningsToEvents(data.earnings));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const toggleFilter = useCallback((type: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const allEvents = useMemo(() => generateMarketEvents(year - 1, year + 2, apiEarnings), [year, apiEarnings]);

  const eventMap = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of allEvents) {
      if (activeFilters.size > 0 && !activeFilters.has(ev.type)) continue;
      if (!map[ev.date]) map[ev.date] = [];
      map[ev.date].push(ev);
    }
    return map;
  }, [allEvents, activeFilters]);

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
  const isPpiEvent = selectedEvent?.blsType === "ppi";
  const isCpiEvent = selectedEvent?.blsType === "cpi";
  const isFomcDecision = selectedEvent?.fomcType === "decision";
  const isFomcMinutes = selectedEvent?.fomcType === "minutes";
  const isFomcEvent = isFomcDecision || isFomcMinutes;

  const fomcMeeting = useMemo(() => {
    if (!isFomcEvent || !selectedEvent?.meetingDate) return null;
    return fomcMeetings.find(m => m.statementDate === selectedEvent.meetingDate) || null;
  }, [isFomcEvent, selectedEvent?.meetingDate, fomcMeetings]);

  const closeAll = useCallback(() => {
    setSelectedDate(null);
    setSelectedEvent(null);
    setShowFullBreakdown(false);
    setReportIframeUrl(null);
  }, []);

  useEffect(() => {
    fetchPpiFull().then((data) => { if (data) setPpiData(data); });
    fetchCpiFull().then((data) => { if (data) setCpiData(data); });
    fetchNfpFull().then((data) => { if (data) setNfpData(data); });
    fetchFomcData().then((data) => { if (data.length) setFomcMeetings(data); });
  }, []);

  useEffect(() => {
    if (isFomcEvent && fomcMeetings.length === 0 && !fomcLoading) {
      setFomcLoading(true);
      fetchFomcData().then((data) => {
        if (data.length) setFomcMeetings(data);
        setFomcLoading(false);
      });
    }
  }, [isFomcEvent, fomcMeetings.length, fomcLoading]);

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
    if (isPpiEvent) {
      if (ppiData) return;
      setPpiLoading(true);
      fetchPpiFull().then((data) => {
        if (data) setPpiData(data);
        setPpiLoading(false);
      });
      return;
    }
    if (isCpiEvent) {
      if (cpiData) return;
      setCpiLoading(true);
      fetchCpiFull().then((data) => {
        if (data) setCpiData(data);
        setCpiLoading(false);
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

      <div className="grid grid-cols-7 gap-0 mb-0">
        {DAYS.map((d) => (
          <div key={d} className="text-center font-mono text-[9px] text-zinc-600 tracking-wider pt-1 pb-0.5">
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
                    : "#ffffff",
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

      <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pb-1 -mt-1">
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-[6px] h-[6px] rounded-full" style={{ background: TYPE_COLORS[key] }} />
            <span className="font-mono text-[11px] text-white">{label}</span>
          </div>
        ))}
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

      {selectedEvent && !showFullBreakdown && !isNfpEvent && !isPpiEvent && !isCpiEvent && !isFomcEvent && (
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
        const nfpMonthKey = selectedEvent.date ? refMonthKey(selectedEvent.date) : "";
        const hasNfpMonth = !!(nfpMonthKey && nfpData?.byMonth?.[nfpMonthKey]);
        const nfpMonthData: NfpMonthData | undefined = hasNfpMonth ? nfpData!.byMonth![nfpMonthKey] : (nfpData || undefined);
        const nfpMonthNotAvailable = !!(nfpData && nfpMonthKey && !hasNfpMonth && nfpData?._meta?.month !== refMonthName(selectedEvent.date));
        const meta = nfpMonthData?._meta ? { ...nfpData?._meta, ...nfpMonthData._meta } : nfpData?._meta;
        const nfp = nfpMonthNotAvailable ? undefined : nfpMonthData?.nfp;
        const nfpRefLabel = selectedEvent.date ? refMonthLabel(selectedEvent.date) : (meta ? `${meta.month} ${meta.year}` : "");

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
              <span className="font-mono text-[15px] font-bold tabular-nums w-[66px] text-right shrink-0" style={{ color: c }}>{data.unit === "thousands" ? data.change : data.actual}</span>
              <span className="font-mono text-[15px] text-zinc-500 tabular-nums w-[66px] text-right shrink-0">{data.expected || "—"}</span>
              <span className="font-mono text-[15px] text-zinc-500 tabular-nums w-[66px] text-right shrink-0">{data.previous}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[66px] text-right shrink-0" style={{ color: c }}>{data.change}</span>
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

        const sectorKeys: Array<{ key: keyof NfpMonthData; label: string }> = [
          { key: "healthCare", label: "Health Care" },
          { key: "leisureHosp", label: "Leisure & Hospitality" },
          { key: "construction", label: "Construction" },
          { key: "transportWare", label: "Transport & Warehousing" },
          { key: "manufacturing", label: "Manufacturing" },
          { key: "financialAct", label: "Financial Activities" },
          { key: "fedGov", label: "Federal Government" },
        ];
        const sortedSectors = nfpMonthData ? sectorKeys
          .filter(s => {
            const d = nfpMonthData[s.key] as NfpSeriesResult | undefined;
            return d && !d.error;
          })
          .sort((a, b) => {
            const aD = nfpMonthData[a.key] as NfpSeriesResult;
            const bD = nfpMonthData[b.key] as NfpSeriesResult;
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
                Jobs Report (NFP){nfpRefLabel ? ` — ${nfpRefLabel}` : (meta ? ` — ${meta.month} ${meta.year}` : "")} 8:30 AM ET (BLS)
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

            {!nfpLoading && !nfp && nfpMonthNotAvailable && (
              <div className="flex flex-col items-center justify-center py-8 gap-3 px-4">
                <span className="font-mono text-[13px] text-zinc-400 text-center">{nfpRefLabel} data not yet available from BLS.</span>
                <span className="font-mono text-[11px] text-zinc-600 text-center">The BLS API typically updates within a few hours of the official release.</span>
                <button
                  onClick={() => setReportIframeUrl(reportUrl)}
                  className="flex items-center gap-1.5 font-mono text-[13px] font-bold tracking-wider transition-opacity hover:opacity-70 mt-2"
                  style={{ color: "#FFB800" }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View BLS Report
                </button>
              </div>
            )}

            {!nfpLoading && !nfp && !nfpMonthNotAvailable && nfpData && (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[11px] text-zinc-500">Unable to load NFP data. Please try again later.</span>
              </div>
            )}

            {!nfpLoading && !nfp && !nfpMonthNotAvailable && !nfpData && (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[11px] text-zinc-500">No jobs report data available.</span>
              </div>
            )}

            {nfp && !showFullBreakdown && (() => {
              const expectedRaw = nfp.expected ? parseInt(nfp.expected.replace(/[+,K]/g, ""), 10) * 1000 : null;
              const beatMiss = expectedRaw !== null ? (nfp.changeRaw > expectedRaw ? "BEAT" : nfp.changeRaw < expectedRaw ? "MISS" : "IN LINE") : null;
              const beatColor = beatMiss === "BEAT" ? upColor : beatMiss === "MISS" ? downColor : neutralColor;

              return (
                <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
                  <div className="flex items-end justify-center gap-6 pb-1">
                    <div className="flex flex-col items-center">
                      <span className="font-mono text-[12px] text-zinc-500 tracking-wider">ACTUAL</span>
                      <span className="font-mono text-[30px] font-extrabold tabular-nums leading-none" style={{ color: mc(nfp.changeRaw) }}>{nfp.change}</span>
                    </div>
                    {nfp.expected && (
                      <>
                        <span className="text-[18px] mb-0.5" style={{ color: beatColor }}>{beatMiss === "BEAT" ? "▶" : beatMiss === "MISS" ? "◀" : "="}</span>
                        <div className="flex flex-col items-center">
                          <span className="font-mono text-[12px] text-zinc-500 tracking-wider">CONSENSUS</span>
                          <span className="font-mono text-[30px] font-extrabold tabular-nums leading-none text-zinc-200">{nfp.expected}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {beatMiss && (
                    <div className="flex justify-center pb-3">
                      <span className="font-mono text-[11px] font-bold tracking-widest px-2 py-0.5 rounded" style={{ color: beatColor, background: `${beatColor}15` }}>
                        {beatMiss === "BEAT" ? "BEAT CONSENSUS" : beatMiss === "MISS" ? "MISSED CONSENSUS" : "IN LINE WITH CONSENSUS"}
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center pb-0.5 border-b border-[#2a2a2c] gap-2">
                      <span className="font-mono text-[11px] text-zinc-600 flex-1">METRIC</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[66px] text-right shrink-0">ACTUAL</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[66px] text-right shrink-0">EST</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[66px] text-right shrink-0">PRIOR</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[66px] text-right shrink-0">CHG</span>
                    </div>
                    <SummaryRow label="Unemployment Rate" data={nfpMonthData?.unemployment} invertColor />
                    <SummaryRow label="Avg Hourly Earnings MoM" data={nfpMonthData?.earningsMom} />
                    {nfpMonthData?.earningsYoy && <SummaryRow label="Avg Hourly Earnings YoY" data={nfpMonthData.earningsYoy} />}
                    <SummaryRow label="Private Payrolls" data={nfpMonthData?.privatePayroll} />
                    <SummaryRow label="Labor Force Part." data={nfpMonthData?.lfpr} />
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => setShowFullBreakdown(true)}
                      className="font-mono text-[14px] font-bold tracking-wider transition-opacity hover:opacity-70"
                      style={{ color: "#FFB800" }}
                    >
                      Read More
                    </button>
                  </div>
                </div>
              );
            })()}

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
                  <FullRow label="Nonfarm Payrolls" data={nfpMonthData?.nfp} />
                  <FullRow label="Unemployment Rate" data={nfpMonthData?.unemployment} invertColor />
                  <FullRow label="Hourly Earnings MoM" data={nfpMonthData?.earningsMom} />
                  {nfpMonthData?.earningsYoy && <FullRow label="Hourly Earnings YoY" data={nfpMonthData.earningsYoy} />}
                  <FullRow label="Private Payrolls" data={nfpMonthData?.privatePayroll} />
                  <FullRow label="Labor Force Part." data={nfpMonthData?.lfpr} />
                </div>

                {meta?.prevMonths && meta.prevMonths.length > 0 && (
                  <div>
                    <span className="font-mono text-[16px] font-extrabold tracking-widest block mb-1.5" style={{ color: "#FFB800" }}>REVISIONS</span>
                    <div className="rounded-md border border-[#2a2a2c] p-2.5 space-y-1.5">
                      {meta.prevMonths.map((pm, i) => {
                        const revColor = pm.changeRaw === 0 ? "#a1a1aa" : pm.changeRaw > 0 ? "#00e676" : "#ff1744";
                        return (
                          <div key={i} className="flex items-center justify-between">
                            <span className="font-mono text-[15px] text-zinc-400">{pm.month} (revised)</span>
                            <span className="font-mono text-[21px] font-extrabold tabular-nums" style={{ color: revColor }}>{pm.change}</span>
                          </div>
                        );
                      })}
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
                        const d = nfpMonthData![s.key] as NfpSeriesResult;
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
                    {nfpMonthData?.employed && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Employed</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: mc(nfpMonthData.employed.changeRaw) }}>{nfpMonthData.employed.change}</span>
                      </div>
                    )}
                    {nfpMonthData?.unemployed && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Unemployed</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: mc(nfpMonthData.unemployed.changeRaw, true) }}>{nfpMonthData.unemployed.change}</span>
                      </div>
                    )}
                    {nfpMonthData?.laborForce && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Labor Force</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums" style={{ color: mc(nfpMonthData.laborForce.changeRaw) }}>{nfpMonthData.laborForce.change}</span>
                      </div>
                    )}
                    {nfpMonthData?.empPopRatio && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">Emp-Pop Ratio</span>
                        <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{nfpMonthData.empPopRatio.actual}</span>
                      </div>
                    )}
                    {nfpMonthData?.u6 && (
                      <div className="flex items-center justify-between py-1">
                        <span className="font-mono text-[15px] text-zinc-400">U-6 Rate</span>
                        <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{nfpMonthData.u6.actual}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">OTHER KEY DETAILS</span>
                  <div className="flex items-center gap-6">
                    {nfpMonthData?.weeklyHours && (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-[15px] text-zinc-400">Avg Workweek:</span>
                        <span className="font-mono text-[15px] font-bold text-zinc-300 tabular-nums">{nfpMonthData.weeklyHours.actual}h</span>
                        <span className="font-mono text-[14px] tabular-nums" style={{ color: mc(nfpMonthData.weeklyHours.changeRaw) }}>({nfpMonthData.weeklyHours.change})</span>
                      </div>
                    )}
                  </div>
                  {(nfpMonthData?.privatePayroll || nfpMonthData?.govPayroll) && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="font-mono text-[15px] text-zinc-400">Split:</span>
                      {nfpMonthData?.privatePayroll && <span className="font-mono text-[15px] text-zinc-300 tabular-nums">Private {nfpMonthData.privatePayroll.change}</span>}
                      {nfpMonthData?.privatePayroll && nfpMonthData?.govPayroll && <span className="font-mono text-[15px] text-zinc-600">|</span>}
                      {nfpMonthData?.govPayroll && <span className="font-mono text-[15px] text-zinc-300 tabular-nums">Gov {nfpMonthData.govPayroll.change}</span>}
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

      {selectedEvent && (isPpiEvent || isCpiEvent) && (() => {
        const upColor = "#26a69a";
        const downColor = "#f23645";
        const neutralColor = "#a1a1aa";
        const isPpi = isPpiEvent;
        const inflDataFull = isPpi ? ppiData : cpiData;
        const inflLoading = isPpi ? ppiLoading : cpiLoading;
        const monthKey = selectedEvent.date ? refMonthKey(selectedEvent.date) : "";
        const hasMonthData = !!(monthKey && inflDataFull?.byMonth?.[monthKey]);
        const inflData: InflationMonthData | undefined = hasMonthData ? inflDataFull!.byMonth![monthKey] : (inflDataFull || undefined);
        const monthNotYetAvailable = !!(inflDataFull && monthKey && !hasMonthData && inflData?._meta?.month !== refMonthName(selectedEvent.date));
        const headline = monthNotYetAvailable ? undefined : inflData?.headline;
        const meta = inflData?._meta;
        const reportUrl = isPpi ? "https://www.bls.gov/news.release/ppi.nr0.htm" : "https://www.bls.gov/news.release/cpi.nr0.htm";
        const refLabel = selectedEvent.date ? refMonthLabel(selectedEvent.date) : (meta ? `${meta.month} ${meta.year}` : "");
        const titleLabel = isPpi ? "PPI Report" : "CPI Report";
        const timeStr = isPpi ? "8:30 AM ET (BLS)" : "8:30 AM ET (BLS)";

        const mc = (val: number) => {
          if (val === 0) return neutralColor;
          return val >= 0 ? upColor : downColor;
        };

        const InflRow = ({ label, data }: { label: string; data?: InflationSeriesResult }) => {
          if (!data || data.error) return null;
          const c = mc(data.changeRaw);
          return (
            <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
              <span className="font-mono text-[15px] text-zinc-400 flex-1 min-w-0 truncate">{label}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[76px] text-right shrink-0" style={{ color: mc(data.momRaw) }}>{data.actual}</span>
              <span className="font-mono text-[15px] text-zinc-500 tabular-nums w-[76px] text-right shrink-0">{data.previous}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[76px] text-right shrink-0" style={{ color: c }}>{data.change}</span>
            </div>
          );
        };

        const YoyRow = ({ label, data }: { label: string; data?: InflationSeriesResult }) => {
          if (!data || data.error || !data.yoy) return null;
          const yoyDiff = (data.yoyRaw || 0) - (data.prevYoyRaw || 0);
          const c = mc(yoyDiff);
          return (
            <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
              <span className="font-mono text-[15px] text-zinc-400 flex-1 min-w-0 truncate">{label}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[76px] text-right shrink-0" style={{ color: mc(data.yoyRaw || 0) }}>{data.yoy}</span>
              <span className="font-mono text-[15px] text-zinc-500 tabular-nums w-[76px] text-right shrink-0">{data.prevYoy || "—"}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums w-[76px] text-right shrink-0" style={{ color: c }}>{`${yoyDiff >= 0 ? "+" : ""}${yoyDiff.toFixed(1)} pts`}</span>
            </div>
          );
        };

        const cpiComponentKeys: Array<{ key: keyof InflationMonthData; label: string }> = [
          { key: "food", label: "Food" },
          { key: "energy", label: "Energy" },
          { key: "shelter", label: "Shelter" },
          { key: "medical", label: "Medical Care" },
          { key: "transport", label: "Transportation" },
          { key: "apparel", label: "Apparel" },
          { key: "usedCars", label: "Used Cars & Trucks" },
        ];

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
                {titleLabel}{refLabel ? ` — ${refLabel}` : (meta ? ` — ${meta.month} ${meta.year}` : "")} {timeStr}
              </span>
              <button onClick={closeAll} className="p-1 shrink-0">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
            <div className="border-b border-[#1a1a1c]" />

            {inflLoading && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                <span className="font-mono text-[11px] text-zinc-500">Loading {isPpi ? "PPI" : "CPI"} report...</span>
              </div>
            )}

            {!inflLoading && !headline && monthNotYetAvailable && (
              <div className="flex flex-col items-center justify-center py-8 gap-3 px-4">
                <span className="font-mono text-[13px] text-zinc-400 text-center">{refLabel} data not yet available from BLS.</span>
                <span className="font-mono text-[11px] text-zinc-600 text-center">The BLS API typically updates within a few hours of the official release.</span>
                <button
                  onClick={() => setReportIframeUrl(reportUrl)}
                  className="flex items-center gap-1.5 font-mono text-[13px] font-bold tracking-wider transition-opacity hover:opacity-70 mt-2"
                  style={{ color: "#FFB800" }}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View BLS Report
                </button>
              </div>
            )}

            {!inflLoading && !headline && !monthNotYetAvailable && (
              <div className="flex items-center justify-center py-8">
                <span className="font-mono text-[11px] text-zinc-500">No {isPpi ? "PPI" : "CPI"} data available.</span>
              </div>
            )}

            {headline && !showFullBreakdown && (() => {
              const expNum = headline.expected ? parseFloat(headline.expected.replace(/[+%]/g, "")) : null;
              const actNum = headline.momRaw;
              const beatMiss = expNum !== null ? (actNum < expNum ? "BEAT" : actNum > expNum ? "MISS" : "IN LINE") : null;
              const beatColor = beatMiss === "BEAT" ? upColor : beatMiss === "MISS" ? downColor : neutralColor;

              return (
                <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
                  <div className="flex items-end justify-center gap-6 pb-1">
                    <div className="flex flex-col items-center">
                      <span className="font-mono text-[12px] text-zinc-500 tracking-wider">ACTUAL</span>
                      <span className="font-mono text-[30px] font-extrabold tabular-nums leading-none" style={{ color: mc(headline.momRaw) }}>{headline.actual}</span>
                    </div>
                    {headline.expected && (
                      <>
                        <span className="text-[18px] mb-0.5" style={{ color: beatColor }}>{beatMiss === "BEAT" ? "◀" : beatMiss === "MISS" ? "▶" : "="}</span>
                        <div className="flex flex-col items-center">
                          <span className="font-mono text-[12px] text-zinc-500 tracking-wider">CONSENSUS</span>
                          <span className="font-mono text-[30px] font-extrabold tabular-nums leading-none text-zinc-200">{headline.expected}</span>
                        </div>
                      </>
                    )}
                  </div>
                  {beatMiss && (
                    <div className="flex justify-center pb-3">
                      <span className="font-mono text-[11px] font-bold tracking-widest px-2 py-0.5 rounded" style={{ color: beatColor, background: `${beatColor}15` }}>
                        {beatMiss === "BEAT" ? "COOLER THAN EXPECTED" : beatMiss === "MISS" ? "HOTTER THAN EXPECTED" : "IN LINE WITH CONSENSUS"}
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center pb-0.5 border-b border-[#2a2a2c] gap-2">
                      <span className="font-mono text-[11px] text-zinc-600 flex-1">METRIC</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">ACTUAL</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">PRIOR</span>
                      <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">CHANGE</span>
                    </div>
                    <InflRow label={isPpi ? "Core PPI MoM" : "Core CPI MoM"} data={inflData?.core} />
                    <YoyRow label={isPpi ? "PPI YoY" : "CPI YoY"} data={headline} />
                    <YoyRow label={isPpi ? "Core PPI YoY" : "Core CPI YoY"} data={inflData?.core} />
                    {!isPpi && <InflRow label="Food MoM" data={inflData?.food} />}
                    {!isPpi && <InflRow label="Energy MoM" data={inflData?.energy} />}
                  </div>

                  <div className="flex items-center justify-end">
                    <button
                      onClick={() => setShowFullBreakdown(true)}
                      className="font-mono text-[14px] font-bold tracking-wider transition-opacity hover:opacity-70"
                      style={{ color: "#FFB800" }}
                    >
                      Read More
                    </button>
                  </div>
                </div>
              );
            })()}

            {headline && showFullBreakdown && (
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">EXPANDED KEY METRICS</span>
                  <div className="flex items-center pb-1 border-b border-[#2a2a2c] gap-2">
                    <span className="font-mono text-[11px] text-zinc-600 flex-1">METRIC</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">ACTUAL</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">PRIOR</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[76px] text-right shrink-0">CHANGE</span>
                  </div>
                  <InflRow label={isPpi ? "PPI Final Demand MoM" : "CPI All Items MoM"} data={headline} />
                  <InflRow label={isPpi ? "Core PPI MoM" : "Core CPI MoM"} data={inflData?.core} />
                  <YoyRow label={isPpi ? "PPI Final Demand YoY" : "CPI All Items YoY"} data={headline} />
                  <YoyRow label={isPpi ? "Core PPI YoY" : "Core CPI YoY"} data={inflData?.core} />
                </div>

                {!isPpi && (
                  <div>
                    <span className="font-mono text-[16px] font-extrabold tracking-widest block mb-1.5" style={{ color: "#FFB800" }}>COMPONENT BREAKDOWN</span>
                    <div className="space-y-0">
                      {cpiComponentKeys.map((comp) => {
                        const d = inflData?.[comp.key] as InflationSeriesResult | undefined;
                        if (!d || d.error) return null;
                        return (
                          <div key={comp.key} className="flex items-center justify-between py-1 border-b border-[#1a1a1c]">
                            <span className="font-mono text-[15px] text-zinc-400">{comp.label}</span>
                            <span className="font-mono text-[16px] font-bold tabular-nums" style={{ color: mc(d.momRaw) }}>{d.actual}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">INDEX LEVELS</span>
                  <div className="flex gap-6">
                    <div>
                      <span className="font-mono text-[9px] text-zinc-600 block tracking-wider mb-1">CURRENT</span>
                      <span className="font-mono text-base font-bold text-white">{headline.level}</span>
                    </div>
                    <div>
                      <span className="font-mono text-[9px] text-zinc-600 block tracking-wider mb-1">PREVIOUS</span>
                      <span className="font-mono text-base font-semibold text-zinc-400">{headline.prevLevel}</span>
                    </div>
                  </div>
                </div>

                {meta?.recentMom && meta.recentMom.length > 0 && (
                  <div>
                    <span className="font-mono text-[16px] font-extrabold tracking-widest block mb-1.5" style={{ color: "#FFB800" }}>RECENT MONTHS (MoM%)</span>
                    <div className="rounded-md border border-[#2a2a2c] p-2.5 space-y-1.5">
                      {meta.recentMom.map((m, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="font-mono text-[15px] text-zinc-400">{m.month}</span>
                          <span className="font-mono text-[21px] font-extrabold tabular-nums" style={{ color: mc(m.raw) }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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

      {selectedEvent && isFomcEvent && (() => {
        const meeting = fomcMeeting;
        const isDecision = isFomcDecision;
        const rate = meeting?.rate;
        const isPast = meeting?.status === "completed";
        const upColor = "#26a69a";
        const downColor = "#f23645";
        const neutralColor = "#a1a1aa";
        const fomcPurple = "#a855f7";

        const recentHistory = fomcMeetings
          .filter(m => m.rate && m.status === "completed")
          .slice(-6);

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
                {isDecision
                  ? `FOMC Decision${meeting ? ` — ${meeting.meetingRange}` : ""} 2:00 PM ET`
                  : `FOMC Minutes${selectedEvent?.date ? ` — ${new Date(selectedEvent.date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""} 2:00 PM ET`
                }
              </span>
              <button onClick={closeAll} className="p-1 shrink-0">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </div>
            <div className="border-b border-[#1a1a1c]" />

            {fomcLoading && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                <span className="font-mono text-[11px] text-zinc-500">Loading FOMC data...</span>
              </div>
            )}

            {!fomcLoading && !meeting && (
              <div className="flex items-center justify-center py-8 px-4">
                <span className="font-mono text-[11px] text-zinc-500 text-center">
                  {fomcMeetings.length > 0 ? "Meeting data not found for this date." : "Unable to load FOMC data."}
                </span>
              </div>
            )}

            {!fomcLoading && meeting && !isPast && !showFullBreakdown && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#a855f720", border: "2px solid #a855f7" }}>
                    <span className="font-mono text-lg font-bold" style={{ color: fomcPurple }}>F</span>
                  </div>
                  <span className="font-mono text-[20px] font-extrabold text-white text-center">UPCOMING</span>
                  <span className="font-mono text-[14px] text-zinc-400 text-center">{meeting.meetingRange}</span>
                  {meeting.hasSEP && (
                    <span className="font-mono text-[11px] px-2 py-0.5 rounded-full" style={{ color: "#FFB800", background: "#FFB80015", border: "1px solid #FFB80030" }}>
                      INCLUDES DOT PLOT / SEP
                    </span>
                  )}
                </div>

                {recentHistory.length > 0 && (
                  <div>
                    <span className="font-mono text-[11px] text-zinc-600 tracking-widest block mb-2">CURRENT RATE</span>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[26px] font-extrabold text-white">{recentHistory[recentHistory.length - 1].rate!.display}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setShowFullBreakdown(true)}
                    className="font-mono text-[14px] font-bold tracking-wider transition-opacity hover:opacity-70"
                    style={{ color: "#FFB800" }}
                  >
                    Rate History
                  </button>
                </div>
              </div>
            )}

            {!fomcLoading && meeting && isPast && isDecision && !showFullBreakdown && (
              <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
                <div className="flex items-end justify-center gap-6 pb-4">
                  <div className="flex flex-col items-center">
                    <span className="font-mono text-[12px] text-zinc-500 tracking-wider">FED FUNDS RATE</span>
                    <span className="font-mono text-[28px] font-extrabold tabular-nums leading-none text-white">
                      {rate ? rate.display : "—"}
                    </span>
                  </div>
                  {rate && rate.changeDisplay && (
                    <div className="flex flex-col items-center">
                      <span className="font-mono text-[12px] text-zinc-500 tracking-wider">CHANGE</span>
                      <span
                        className="font-mono text-[28px] font-extrabold tabular-nums leading-none"
                        style={{ color: rate.changeBps === 0 ? neutralColor : rate.changeBps < 0 ? downColor : upColor }}
                      >
                        {rate.changeDisplay}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center pb-0.5 border-b border-[#2a2a2c] gap-2">
                    <span className="font-mono text-[11px] text-zinc-600 flex-1">DETAIL</span>
                    <span className="font-mono text-[11px] text-zinc-600 w-[120px] text-right shrink-0">VALUE</span>
                  </div>

                  {rate && (
                    <>
                      <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
                        <span className="font-mono text-[15px] text-zinc-400 flex-1">Target Range</span>
                        <span className="font-mono text-[15px] font-bold text-white w-[120px] text-right shrink-0">{rate.display}</span>
                      </div>
                      <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
                        <span className="font-mono text-[15px] text-zinc-400 flex-1">Action</span>
                        <span className="font-mono text-[15px] font-bold w-[120px] text-right shrink-0" style={{ color: rate.action === "maintained" ? neutralColor : rate.action === "lowered" ? downColor : upColor }}>
                          {rate.action === "maintained" ? "Maintained" : rate.action === "lowered" ? "Lowered" : "Raised"}
                        </span>
                      </div>
                      {rate.vote && (
                        <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
                          <span className="font-mono text-[15px] text-zinc-400 flex-1">Vote</span>
                          <span className="font-mono text-[15px] font-bold text-white w-[120px] text-right shrink-0">{rate.vote}</span>
                        </div>
                      )}
                      {meeting.hasSEP && (
                        <div className="flex items-center py-1.5 border-b border-[#1a1a1c] gap-2">
                          <span className="font-mono text-[15px] text-zinc-400 flex-1">Dot Plot / SEP</span>
                          <span className="font-mono text-[15px] font-bold w-[120px] text-right shrink-0" style={{ color: "#FFB800" }}>Released</span>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex items-center justify-end">
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

            {!fomcLoading && meeting && isPast && isFomcMinutes && !showFullBreakdown && (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <div className="flex flex-col items-center gap-3">
                  <span className="font-mono text-[18px] font-extrabold text-white text-center">FOMC Minutes</span>
                  <span className="font-mono text-[11px] text-zinc-500 text-center tracking-wider">
                    RELEASED {selectedEvent?.date ? new Date(selectedEvent.date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase() : ""}
                  </span>
                  <div className="rounded-md border border-[#2a2a2c] px-3 py-2 w-full mt-1">
                    <span className="font-mono text-[11px] text-zinc-600 tracking-wider block mb-1">MEETING COVERED</span>
                    <span className="font-mono text-[14px] text-zinc-300">{meeting.meetingRange}</span>
                  </div>
                  {rate && (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="font-mono text-[13px] text-zinc-500">Rate at meeting:</span>
                      <span className="font-mono text-[16px] font-bold text-white">{rate.display}</span>
                      {rate.changeDisplay && (
                        <span className="font-mono text-[13px] font-bold" style={{ color: rate.changeBps === 0 ? neutralColor : rate.changeBps < 0 ? downColor : upColor }}>
                          ({rate.changeDisplay})
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <a
                    href={meeting.minutesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 w-full p-3 rounded-lg transition-colors hover:bg-[#1a1a1c] border border-[#2a2a2c]"
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" style={{ color: fomcPurple }} />
                    <span className="font-mono text-[14px] text-white font-bold">Read Full Minutes</span>
                    <span className="font-mono text-[11px] text-zinc-500 ml-auto">federalreserve.gov</span>
                  </a>
                  <a
                    href={meeting.statementUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 w-full p-3 rounded-lg transition-colors hover:bg-[#1a1a1c] border border-[#2a2a2c]"
                  >
                    <ExternalLink className="w-4 h-4 text-zinc-500 shrink-0" />
                    <span className="font-mono text-[14px] text-zinc-300">Original Statement</span>
                    <span className="font-mono text-[11px] text-zinc-500 ml-auto">federalreserve.gov</span>
                  </a>
                </div>

                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setShowFullBreakdown(true)}
                    className="font-mono text-[14px] font-bold tracking-wider transition-opacity hover:opacity-70"
                    style={{ color: "#FFB800" }}
                  >
                    Rate History
                  </button>
                </div>
              </div>
            )}

            {showFullBreakdown && meeting && (
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-4">
                {rate && rate.dissenters && (
                  <div>
                    <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">DISSENTING VOTES</span>
                    <div className="rounded-md border border-[#2a2a2c] p-2.5">
                      <span className="font-mono text-[13px] text-zinc-400 leading-relaxed">{rate.dissenters}</span>
                    </div>
                  </div>
                )}

                {meeting.keyExcerpt && (
                  <div>
                    <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">KEY EXCERPT</span>
                    <div className="rounded-md border border-[#2a2a2c] p-2.5">
                      <span className="font-mono text-[13px] text-zinc-400 leading-relaxed italic">"{meeting.keyExcerpt}"</span>
                    </div>
                  </div>
                )}

                <div>
                  <span className="font-mono text-[16px] font-extrabold tracking-widest block mb-1.5" style={{ color: "#FFB800" }}>RATE HISTORY</span>
                  <div className="rounded-md border border-[#2a2a2c] p-2.5 space-y-1.5">
                    {recentHistory.map((m, i) => {
                      const r = m.rate!;
                      const chgColor = !r.changeDisplay ? neutralColor : r.changeBps === 0 ? neutralColor : r.changeBps < 0 ? downColor : upColor;
                      return (
                        <div key={i} className="flex items-center justify-between py-1 border-b border-[#1a1a1c] last:border-b-0">
                          <span className="font-mono text-[13px] text-zinc-400">{m.meetingRange.split(",")[0]}</span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-[15px] font-bold text-white tabular-nums">{r.display}</span>
                            <span className="font-mono text-[13px] font-bold tabular-nums w-[90px] text-right" style={{ color: chgColor }}>
                              {r.changeDisplay || "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <span className="font-mono text-[14px] text-zinc-600 tracking-widest block mb-1.5">RESOURCES</span>
                  <div className="space-y-1.5">
                    <a
                      href={meeting.statementUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 w-full p-2.5 rounded-lg transition-colors hover:bg-[#1a1a1c] border border-[#2a2a2c]"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: fomcPurple }} />
                      <span className="font-mono text-[13px] text-white">FOMC Statement</span>
                    </a>
                    <a
                      href={meeting.minutesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 w-full p-2.5 rounded-lg transition-colors hover:bg-[#1a1a1c] border border-[#2a2a2c]"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: fomcPurple }} />
                      <span className="font-mono text-[13px] text-white">Meeting Minutes</span>
                    </a>
                    <a
                      href={meeting.pressConferenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 w-full p-2.5 rounded-lg transition-colors hover:bg-[#1a1a1c] border border-[#2a2a2c]"
                    >
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: fomcPurple }} />
                      <span className="font-mono text-[13px] text-white">Press Conference</span>
                    </a>
                    {meeting.hasSEP && meeting.sepUrl && (
                      <a
                        href={meeting.sepUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 w-full p-2.5 rounded-lg transition-colors hover:bg-[#1a1a1c] border border-[#2a2a2c]"
                      >
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: "#FFB800" }} />
                        <span className="font-mono text-[13px] font-bold" style={{ color: "#FFB800" }}>Dot Plot / SEP Projections</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showFullBreakdown && selectedEvent?.blsType && !isNfpEvent && !isPpiEvent && !isCpiEvent && blsData[selectedEvent.blsType]?.change && (() => {
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
        const todayEvents = allEvents.filter((ev) => ev.date === todayKey && filterFn(ev));
        const upcomingEvents = allEvents.filter((ev) => ev.date > todayKey && filterFn(ev)).slice(0, 10);

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
