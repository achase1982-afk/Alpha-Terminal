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
  tokenExpired?: boolean;
}

export function TradingChart({ data, isLoading, tokenExpired }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { overlays } = useTerminalStore();

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8B949E',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(33, 38, 45, 0.5)' },
        horzLines: { color: 'rgba(33, 38, 45, 0.5)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#00D4AA', width: 1, style: 3 },
        horzLine: { color: '#00D4AA', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#21262D',
      },
      timeScale: {
        borderColor: '#21262D',
        timeVisible: true,
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

    // v5 API: chart.addSeries(SeriesType, options)
    const mainSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00D4AA',
      downColor: '#FF4D4D',
      borderVisible: false,
      wickUpColor: '#00D4AA',
      wickDownColor: '#FF4D4D',
    });
    mainSeries.setData(formattedData);

    if (overlays.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
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
      const sma20Series = chart.addSeries(LineSeries, { color: '#58A6FF', lineWidth: 2 });
      sma20Series.setData(sma20Data);
    }

    if (overlays.sma50) {
      const sma50Data = calculateSMA(sortedData, 50)
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const sma50Series = chart.addSeries(LineSeries, { color: '#D2A8FF', lineWidth: 2 });
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

    return () => {
      chart.remove();
    };
  }, [data, overlays]);

  return (
    <div className="w-full h-full min-h-[300px] relative rounded-xl border border-card-border bg-[#0D1117] overflow-hidden shadow-inner">
      <div ref={chartContainerRef} className="absolute inset-0" />
      {(!data || data.length === 0) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 font-mono text-xs sm:text-sm">
          {isLoading ? (
            <span className="text-muted-foreground animate-pulse">LOADING MARKET DATA...</span>
          ) : tokenExpired ? (
            <>
              <span className="text-yellow-500/80">SESSION EXPIRED — REFRESHING...</span>
              <span className="text-muted-foreground/50 text-[10px]">Open the sidebar to reconnect if this persists</span>
            </>
          ) : (
            <span className="text-muted-foreground">AWAITING MARKET DATA...</span>
          )}
        </div>
      )}
    </div>
  );
}
