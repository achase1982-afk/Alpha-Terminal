import { useTerminalStore } from "@/lib/store";

const TIMEFRAMES = [
  { label: "1D", period: "1D", interval: "5m" },
  { label: "1W", period: "5D", interval: "15m" },
  { label: "1M", period: "1M", interval: "daily" },
  { label: "3M", period: "3M", interval: "daily" },
  { label: "YTD", period: "YTD", interval: "daily" },
  { label: "1Y", period: "1Y", interval: "daily" },
  { label: "MAX", period: "MAX", interval: "weekly" },
];

export function chartParamsFromStore(period: string, interval: string) {
  const periodMap: Record<string, { periodType: string; period: number }> = {
    "1D": { periodType: "day", period: 1 },
    "5D": { periodType: "day", period: 5 },
    "1M": { periodType: "month", period: 1 },
    "3M": { periodType: "month", period: 3 },
    "YTD": { periodType: "month", period: Math.max(1, new Date().getMonth() + 1) },
    "1Y": { periodType: "year", period: 1 },
    "MAX": { periodType: "year", period: 20 },
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

  const activeTf = TIMEFRAMES.find(t => t.period === chartPeriod && t.interval === chartInterval)
    ?? TIMEFRAMES.find(t => t.period === chartPeriod);

  const handleSelect = (tf: typeof TIMEFRAMES[number]) => {
    setChartPeriod(tf.period);
    setChartInterval(tf.interval);
  };

  return (
    <div className="flex items-center gap-1 mb-2 shrink-0">
      {TIMEFRAMES.map(tf => {
        const isActive = activeTf?.label === tf.label;
        return (
          <button
            key={tf.label}
            onClick={() => handleSelect(tf)}
            className={`
              px-3 py-1.5 font-mono text-[10px] sm:text-[11px] font-semibold tracking-wider transition-all duration-150 relative
              ${isActive
                ? "text-white"
                : "text-muted-foreground hover:text-foreground"
              }
            `}
          >
            {tf.label}
            {isActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4/5 h-[2px] bg-primary rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
