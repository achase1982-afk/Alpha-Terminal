import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { queryKeys } from '../api/queryKeys';
import type { StrategistAuditData } from '../components/market-pulse/StrategistAuditPanel';

interface LegPayload {
  strike: number;
  type: "CALL" | "PUT";
  action: "BUY" | "SELL";
  bid: number;
  ask: number;
  mark: number;
  delta: number;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  volume: number;
  openInterest: number;
}

interface ExitRules {
  profit_target_pct: number;
  profit_target_amount: number;
  stop_loss_pct: number;
  stop_loss_amount: number;
  time_exit: string;
}

interface StrategyPayload {
  strategy_type: string;
  expiration_date: string;
  days_to_expiration: number;
  short_leg: LegPayload;
  long_leg: LegPayload;
  short_leg_2?: LegPayload;
  long_leg_2?: LegPayload;
  net_credit: number;
  max_profit: number;
  max_loss: number;
  breakeven: number;
  breakeven_upper?: number;
  probability_of_profit_pct: number;
  risk_reward_ratio: string;
  size_recommendation: string;
  contracts: number;
  exit_rules: ExitRules;
  undefined_risk?: boolean;
}

interface RegimeInfo {
  regime: string;
  description: string;
  strategyUniverse: string[];
  dteRange: { min: number; max: number };
  deltaTargets: { shortStrike: number };
  sizeMultiplier: number;
}

interface PulseSnapshot {
  composite: number;
  confidence: number;
  label: string;
  todayEdge: string;
  size: string;
  timestamp?: number;
}

export interface StrategistCacheData {
  strategies: StrategyPayload[];
  narrative: string;
  regime: RegimeInfo | null;
  pulse: PulseSnapshot | null;
  overrideWarning: string | null;
  audit: StrategistAuditData | null;
  thinkingTokens: string[];
  resultStatus: string | null;
  timestamp: number;
}

export function useStrategistCache(ticker: string) {
  const queryClient = useQueryClient();

  const { data: cachedData } = useQuery<StrategistCacheData>({
    queryKey: queryKeys.strategist.byTicker(ticker),
    enabled: false,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const setCachedData = useCallback((data: StrategistCacheData) => {
    queryClient.setQueryData(queryKeys.strategist.byTicker(ticker), data);
  }, [queryClient, ticker]);

  const clearCache = useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.strategist.byTicker(ticker) });
  }, [queryClient, ticker]);

  return {
    cachedData,
    setCachedData,
    clearCache,
    hasCache: !!cachedData,
  };
}
