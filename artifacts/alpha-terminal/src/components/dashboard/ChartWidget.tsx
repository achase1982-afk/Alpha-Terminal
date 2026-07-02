import { useTerminalStore } from "@/lib/store";
import { useActiveSymbol, useActiveChartSettings } from "./widgetSymbolContext";
import { useGetPriceHistory } from "@workspace/api-client-react";
import type { PriceHistoryResponse } from "@workspace/api-client-react";
import { ChartControls, chartParamsFromStore, isIntradayInterval } from "@/components/ChartControls";
import { TradingChart } from "@/components/TradingChart";

/**
 * Self-contained chart widget for the dashboard grid. Follows the widget's
 * pinned symbol when set, else the global active symbol; react-query dedupes
 * the history request against the Markets tab when both are mounted.
 */
export function ChartWidget() {
  const { accessToken } = useTerminalStore();
  const symbol = useActiveSymbol();
  const { chartPeriod, chartInterval } = useActiveChartSettings();
  const chartParams = chartParamsFromStore(chartPeriod, chartInterval);
  const { data: historyData, isLoading: historyLoading } = useGetPriceHistory<PriceHistoryResponse>(
    {
      symbol,
      periodType: chartParams.periodType,
      period: chartParams.period,
      frequencyType: chartParams.frequencyType,
      frequency: chartParams.frequency,
    },
    { query: { enabled: !!accessToken && !!symbol } },
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-zinc-800/40">
        <ChartControls />
      </div>
      <div className="min-h-0 flex-1">
        <TradingChart
          symbol={symbol}
          data={historyData?.candles || []}
          isLoading={historyLoading}
          error={historyData?.error}
          timedOut={false}
          tokenExpired={historyData?.error === "unauthorized"}
          intraday={isIntradayInterval(chartInterval)}
        />
      </div>
    </div>
  );
}
