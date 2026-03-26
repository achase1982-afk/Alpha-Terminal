import { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, Time } from 'lightweight-charts';
import type { Candle } from "@workspace/api-client-react";
import { useTerminalStore } from '@/lib/store';
import { calculateSMA, calculateBollingerBands } from '@/lib/chart-utils';

interface TradingChartProps {
  data: Candle[];
}

export function TradingChart({ data }: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { overlays } = useTerminalStore();

  useEffect(() => {
    if (!chartContainerRef.current || !data || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8B949E',
        fontFamily: "'JetBrains Mono', monospace",
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

    const sortedData = [...data].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    const formattedData = sortedData.map(c => ({
      time: (new Date(c.datetime).getTime() / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const mainSeries = chart.addCandlestickSeries({
      upColor: '#00D4AA',
      downColor: '#FF4D4D',
      borderVisible: false,
      wickUpColor: '#00D4AA',
      wickDownColor: '#FF4D4D',
    });
    mainSeries.setData(formattedData);

    if (overlays.volume) {
      const volumeSeries = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(sortedData.map(c => ({
        time: (new Date(c.datetime).getTime() / 1000) as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0, 212, 170, 0.3)' : 'rgba(255, 77, 77, 0.3)'
      })));
    }

    if (overlays.sma20) {
      const sma20Data = calculateSMA(sortedData, 20)
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      chart.addLineSeries({ color: '#58A6FF', lineWidth: 2, title: 'SMA 20' }).setData(sma20Data);
    }

    if (overlays.sma50) {
      const sma50Data = calculateSMA(sortedData, 50)
        .filter(d => d.value !== null)
        .map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      chart.addLineSeries({ color: '#D2A8FF', lineWidth: 2, title: 'SMA 50' }).setData(sma50Data);
    }

    if (overlays.bb) {
      const bb = calculateBollingerBands(sortedData, 20, 2);
      const upperData = bb.upper.filter(d => d.value !== null).map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      const lowerData = bb.lower.filter(d => d.value !== null).map(d => ({ time: (new Date(d.time).getTime() / 1000) as Time, value: d.value as number }));
      chart.addLineSeries({ color: 'rgba(187, 134, 252, 0.5)', lineWidth: 1, title: 'BB Upper' }).setData(upperData);
      chart.addLineSeries({ color: 'rgba(187, 134, 252, 0.5)', lineWidth: 1, title: 'BB Lower' }).setData(lowerData);
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
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground font-mono text-xs sm:text-sm">
          AWAITING MARKET DATA...
        </div>
      )}
    </div>
  );
}
