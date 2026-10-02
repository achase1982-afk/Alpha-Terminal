import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  Time,
  CandlestickSeries,
  CandlestickData,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type { Candle } from "@workspace/api-client-react";
import { useTerminalStore } from '@/lib/store';
import { calculateSMA, calculateBollingerBands } from '@/lib/chart-utils';
import { useShallow } from "zustand/react/shallow";

interface TradingChartProps {
  symbol?: string;
  data: Candle[];
  isLoading?: boolean;
  error?: string;
  timedOut?: boolean;
  tokenExpired?: boolean;
  intraday?: boolean;
  /** Current period/interval. A change refits the view; refetches under the
   *  same timeframe keep the user's zoom. */
  timeframe?: string;
}

function isNotFoundError(error?: string): boolean {
  if (!error) return false;
  return (
    error === "no_data" ||
    error === "internal_error" ||
    error.startsWith("api_error_4") ||
    error.startsWith("api_error_5")
  );
}

export function TradingChart({ symbol, data, isLoading, error, timedOut, tokenExpired, intraday, timeframe }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lastCandleTimeRef = useRef<number>(0);
  const fitKeyRef = useRef<string | undefined>(undefined);
  const fitDoneRef = useRef(false);
  const { overlays } = useTerminalStore(useShallow((s) => ({ overlays: s.overlays })));

  const toTime = (d: string | number) => (new Date(d).getTime() / 1000) as Time;

  // Create the chart and every series exactly once. Data pushes and overlay
  // toggles below update the live series in place — no teardown, no flicker,
  // and the user's zoom/scroll position survives updates.
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#808080',
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(38, 38, 38, 0.5)' },
        horzLines: { color: 'rgba(38, 38, 38, 0.5)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#ffb800', width: 1, style: 3 },
        horzLine: { color: '#ffb800', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#262626',
      },
      timeScale: {
        borderColor: '#262626',
        timeVisible: !!intraday,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      autoSize: true,
    });

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#00d166',
      downColor: '#f23645',
      borderVisible: false,
      wickUpColor: '#00d166',
      wickDownColor: '#f23645',
    });

    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      color: '#00d166',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    sma20SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#ffb800',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    sma50SeriesRef.current = chart.addSeries(LineSeries, {
      color: '#ffffff',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    bbUpperSeriesRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(187, 134, 252, 0.5)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    bbLowerSeriesRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(187, 134, 252, 0.5)',
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    // A fresh chart has nothing drawn or fitted yet (also covers StrictMode's
    // dev-only remount, which would otherwise skip the first fit).
    lastCandleTimeRef.current = 0;
    fitDoneRef.current = false;
    return () => {
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      sma20SeriesRef.current = null;
      sma50SeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
      try { chart.remove(); } catch { /* already disposed */ }
    };
  }, []);

  // Intraday toggle only flips a time-scale option — no rebuild.
  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: !!intraday });
  }, [intraday]);

  // Overlay toggles flip series visibility in place — zoom/scroll preserved.
  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: !!overlays.volume });
    sma20SeriesRef.current?.applyOptions({ visible: !!overlays.sma20 });
    sma50SeriesRef.current?.applyOptions({ visible: !!overlays.sma50 });
    bbUpperSeriesRef.current?.applyOptions({ visible: !!overlays.bb });
    bbLowerSeriesRef.current?.applyOptions({ visible: !!overlays.bb });
  }, [overlays]);

  // Push fresh data into the existing series. fitContent runs only on first
  // load or a symbol/timeframe change, so refetches never yank the user's view.
  useEffect(() => {
    const mainSeries = candleSeriesRef.current;
    if (!mainSeries) return;

    if (!data || data.length === 0) {
      // Already empty — callers pass a fresh [] on every render while loading.
      if (lastCandleTimeRef.current === 0 && !fitDoneRef.current) return;
      for (const s of [mainSeries, volumeSeriesRef.current, sma20SeriesRef.current, sma50SeriesRef.current, bbUpperSeriesRef.current, bbLowerSeriesRef.current]) {
        s?.setData([]);
      }
      lastCandleTimeRef.current = 0;
      fitDoneRef.current = false;
      return;
    }

    const sortedData = [...data].sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    mainSeries.setData(sortedData.map(c => ({
      time: toTime(c.datetime),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })));

    volumeSeriesRef.current?.setData(
      sortedData.map(c => ({
        time: toTime(c.datetime),
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0, 212, 170, 0.3)' : 'rgba(255, 77, 77, 0.3)',
      }))
    );

    sma20SeriesRef.current?.setData(
      calculateSMA(sortedData, 20)
        .filter(d => d.value !== null)
        .map(d => ({ time: toTime(d.time), value: d.value as number }))
    );
    sma50SeriesRef.current?.setData(
      calculateSMA(sortedData, 50)
        .filter(d => d.value !== null)
        .map(d => ({ time: toTime(d.time), value: d.value as number }))
    );

    const bb = calculateBollingerBands(sortedData, 20, 2);
    bbUpperSeriesRef.current?.setData(
      bb.upper
        .filter(d => d.value !== null)
        .map(d => ({ time: toTime(d.time), value: d.value as number }))
    );
    bbLowerSeriesRef.current?.setData(
      bb.lower
        .filter(d => d.value !== null)
        .map(d => ({ time: toTime(d.time), value: d.value as number }))
    );

    lastCandleTimeRef.current = toTime(sortedData[sortedData.length - 1].datetime) as number;
    const fitKey = `${symbol ?? ""}|${timeframe ?? ""}`;
    if (!fitDoneRef.current || fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      fitDoneRef.current = true;
      chartRef.current?.timeScale().fitContent();
    }
  }, [data, symbol, timeframe]);

  const liveCandleRef = useRef<{ open: number; high: number; low: number; close: number } | null>(null);

  useEffect(() => {
    liveCandleRef.current = null;
  }, [data]);

  useEffect(() => {
    if (!symbol) return;
    const symUpper = symbol.toUpperCase();
    let prevLast: number | null = null;
    const unsub = useTerminalStore.subscribe((state) => {
      const tick = state.streamPrices[symUpper];
      if (!tick || !candleSeriesRef.current || lastCandleTimeRef.current === 0) return;
      const price = tick.extendedLast ?? tick.last;
      if (price === null || price === undefined || price === prevLast) return;
      prevLast = price;
      const candleTime = lastCandleTimeRef.current as Time;

      if (!liveCandleRef.current) {
        const lastCandle = data?.[data.length - 1];
        liveCandleRef.current = lastCandle
          ? { open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close }
          : { open: price, high: price, low: price, close: price };
      }

      const lc = liveCandleRef.current;
      lc.close = price;
      if (price > lc.high) lc.high = price;
      if (price < lc.low) lc.low = price;

      candleSeriesRef.current.update({
        time: candleTime,
        open: lc.open,
        high: lc.high,
        low: lc.low,
        close: lc.close,
      } as CandlestickData);
    });
    return unsub;
  }, [symbol, data]);

  const legendItems: { color: string; label: string }[] = [];
  if (overlays.sma20) legendItems.push({ color: '#ffb800', label: 'SMA 20' });
  if (overlays.sma50) legendItems.push({ color: '#ffffff', label: 'SMA 50' });
  if (overlays.bb) legendItems.push({ color: 'rgba(187, 134, 252, 0.7)', label: 'Bollinger Bands' });
  if (overlays.volume) legendItems.push({ color: 'rgba(0, 212, 170, 0.5)', label: 'Volume' });

  return (
    <div className="w-full h-full min-h-[300px] relative rounded-xl border border-card-border bg-[#0c0c0c] overflow-hidden shadow-inner">
      <div ref={chartContainerRef} className="absolute inset-0" />

      {data && data.length > 0 && legendItems.length > 0 && (
        <div className="absolute top-2 left-3 z-10 pointer-events-none flex flex-col gap-0.5">
          {legendItems.map(item => (
            <div key={item.label} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-0.5 rounded-full shrink-0"
                style={{ background: item.color }}
              />
              <span className="text-[10px] text-zinc-400 font-medium tracking-wide">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {(!data || data.length === 0) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 font-mono text-xs sm:text-sm">
          {isLoading && !timedOut ? (
            <span className="text-muted-foreground animate-pulse">LOADING MARKET DATA...</span>
          ) : tokenExpired ? (
            <>
              <span className="text-yellow-500/80">SESSION EXPIRED — REFRESHING...</span>
              <span className="text-muted-foreground/50 text-[10px]">Open the sidebar to reconnect if this persists</span>
            </>
          ) : (isNotFoundError(error) || timedOut) ? (
            <>
              <span className="text-red-500/70 tracking-widest">SYMBOL NOT FOUND OR UNSUPPORTED BY API</span>
              <span className="text-muted-foreground/50 text-[10px]">Try a valid equity ticker (e.g. AAPL, MSFT, SPY)</span>
            </>
          ) : (
            <span className="text-muted-foreground">AWAITING MARKET DATA...</span>
          )}
        </div>
      )}
    </div>
  );
}
