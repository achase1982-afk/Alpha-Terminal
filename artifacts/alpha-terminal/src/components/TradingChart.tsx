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

interface TradingChartProps {
  symbol?: string;
  data: Candle[];
  isLoading?: boolean;
  error?: string;
  timedOut?: boolean;
  tokenExpired?: boolean;
  intraday?: boolean;
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

export function TradingChart({ symbol, data, isLoading, error, timedOut, tokenExpired, intraday }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<typeof CandlestickSeries> | null>(null);
  const lastCandleTimeRef = useRef<number>(0);
  const { overlays } = useTerminalStore();

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const container = chartContainerRef.current;
    let removed = false;

    const chart = createChart(container, {
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
    chartRef.current = chart;

    const sortedData = [...data].sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    const formattedData = sortedData.map(c => ({
      time: (new Date(c.datetime).getTime() / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const mainSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00d166',
      downColor: '#f23645',
      borderVisible: false,
      wickUpColor: '#00d166',
      wickDownColor: '#f23645',
    });
    mainSeries.setData(formattedData);
    candleSeriesRef.current = mainSeries;
    if (formattedData.length > 0) {
      lastCandleTimeRef.current = formattedData[formattedData.length - 1].time as number;
    }

    if (overlays.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#00d166',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(
        sortedData.map(c => ({
          time: (new Date(c.datetime).getTime() / 1000) as Time,
          value: c.volume,
          color: c.close >= c.open ? 'rgba(0, 212, 170, 0.3)' : 'rgba(255, 77, 77, 0.3)',
        }))
      );
    }

    if (overlays.sma20) {
      const sma20Data = calculateSMA(sortedData, 20)
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const sma20Series = chart.addSeries(LineSeries, {
        color: '#ffb800',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      sma20Series.setData(sma20Data);
    }

    if (overlays.sma50) {
      const sma50Data = calculateSMA(sortedData, 50)
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const sma50Series = chart.addSeries(LineSeries, {
        color: '#ffffff',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      sma50Series.setData(sma50Data);
    }

    if (overlays.bb) {
      const bb = calculateBollingerBands(sortedData, 20, 2);
      const upperData = bb.upper
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const lowerData = bb.lower
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const bbUpper = chart.addSeries(LineSeries, {
        color: 'rgba(187, 134, 252, 0.5)',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      bbUpper.setData(upperData);
      const bbLower = chart.addSeries(LineSeries, {
        color: 'rgba(187, 134, 252, 0.5)',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      bbLower.setData(lowerData);
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      removed = true;
      chartRef.current = null;
      candleSeriesRef.current = null;
      try { chart.remove(); } catch { /* already disposed */ }
    };
  }, [data, overlays, intraday]);

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
