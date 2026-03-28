import { useTerminalStore } from "@/lib/store";

const PERIODS = [
  { label: "1 Day", value: "1D" },
  { label: "5 Day", value: "5D" },
  { label: "1 Month", value: "1M" },
  { label: "3 Month", value: "3M" },
  { label: "1 Year", value: "1Y" },
];

const INTRADAY_INTERVALS = [
  { label: "1 Min", value: "1m" },
  { label: "5 Min", value: "5m" },
  { label: "15 Min", value: "15m" },
  { label: "30 Min", value: "30m" },
];

const DAILY_INTERVALS = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
];

export function chartParamsFromStore(period: string, interval: string) {
  const periodMap: Record<string, { periodType: string; period: number }> = {
    "1D": { periodType: "day", period: 1 },
    "5D": { periodType: "day", period: 5 },
    "1M": { periodType: "month", period: 1 },
    "3M": { periodType: "month", period: 3 },
    "1Y": { periodType: "year", period: 1 },
  };

  const intervalMap: Record<string, { frequencyType: string; frequency: number }> = {
    "1m": { frequencyType: "minute", frequency: 1 },
    "5m": { frequencyType: "minute", frequency: 5 },
    "15m": { frequencyType: "minute", frequency: 15 },
    "30m": { frequencyType: "minute", frequency: 30 },
    daily: { frequencyType: "daily", frequency: 1 },
    weekly: { frequencyType: "weekly", frequency: 1 },
  };

  const p = periodMap[period] ?? periodMap["3M"];
  const i = intervalMap[interval] ?? intervalMap["daily"];
  return { ...p, ...i };
}

export function isIntradayInterval(interval: string) {
  return ["1m", "5m", "15m", "30m"].includes(interval);
}

export function ChartControls() {
  const { chartPeriod, setChartPeriod, chartInterval, setChartInterval } = useTerminalStore();
  const isIntraday = chartPeriod === "1D" || chartPeriod === "5D";
  const intervals = isIntraday ? INTRADAY_INTERVALS : DAILY_INTERVALS;

  return (
    <div className="flex items-center gap-2 mb-2 shrink-0">
      <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">Period</label>
      <select
        value={chartPeriod}
        onChange={(e) => setChartPeriod(e.target.value)}
        className="h-7 px-2 rounded bg-[#1a1a1a] border border-card-border text-foreground font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer appearance-none"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23808080'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center", paddingRight: "20px" }}
      >
        {PERIODS.map((p) => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>

      <label className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider ml-2">Interval</label>
      <select
        value={chartInterval}
        onChange={(e) => setChartInterval(e.target.value)}
        className="h-7 px-2 rounded bg-[#1a1a1a] border border-card-border text-foreground font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer appearance-none"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23808080'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center", paddingRight: "20px" }}
      >
        {intervals.map((i) => (
          <option key={i.value} value={i.value}>{i.label}</option>
        ))}
      </select>
    </div>
  );
}
