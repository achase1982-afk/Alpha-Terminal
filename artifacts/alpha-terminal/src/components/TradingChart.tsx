import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  IChartApi,
  Time,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import type { Candle } from "@workspace/api-client-react";
import { useTerminalStore } from '@/lib/store';
import { calculateSMA, calculateBollingerBands } from '@/lib/chart-utils';

interface TradingChartProps {
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

export function TradingChart({ data, isLoading, error, timedOut, tokenExpired, intraday }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
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

    if (overlays.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#00d166',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
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
      const sma20Series = chart.addSeries(LineSeries, { color: '#ffb800', lineWidth: 2 });
      sma20Series.setData(sma20Data);
    }

    if (overlays.sma50) {
      const sma50Data = calculateSMA(sortedData, 50)
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const sma50Series = chart.addSeries(LineSeries, { color: '#ffffff', lineWidth: 2 });
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
      const bbUpper = chart.addSeries(LineSeries, { color: 'rgba(187, 134, 252, 0.5)', lineWidth: 1 });
      bbUpper.setData(upperData);
      const bbLower = chart.addSeries(LineSeries, { color: 'rgba(187, 134, 252, 0.5)', lineWidth: 1 });
      bbLower.setData(lowerData);
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      removed = true;
      chartRef.current = null;
      try { chart.remove(); } catch { /* already disposed */ }
    };
  }, [data, overlays, intraday]);

  return (
    <div className="w-full h-full min-h-[300px] relative rounded-xl border border-card-border bg-[#0c0c0c] overflow-hidden shadow-inner">
      <div ref={chartContainerRef} className="absolute inset-0" />

      {data && data.length > 0 && (
        <div className="absolute bottom-3 left-3 z-10 pointer-events-none">
          <div className="px-2.5 py-1.5 rounded-md text-[10px] font-mono leading-relaxed"
            style={{ background: 'rgba(17, 17, 17, 0.85)', border: '1px solid #262626' }}>
            <span style={{ color: '#ffb800' }}>Yellow</span>
            <span className="text-muted-foreground">: 50-day SMA</span>
            <span className="text-muted-foreground mx-1.5">|</span>
            <span className="text-white">White</span>
            <span className="text-muted-foreground">: Trend</span>
            <span className="text-muted-foreground mx-1.5">|</span>
            <span className="text-muted-foreground" style={{ borderBottom: '1px dotted #808080' }}>Dotted</span>
            <span className="text-muted-foreground">: Support/Resistance</span>
          </div>
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
