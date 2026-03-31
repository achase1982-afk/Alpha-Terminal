import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { queryKeys } from '../api/queryKeys';

export interface TechnicalsCacheData {
  analysisResult: string;
  thinkingTokens: string[];
  timestamp: number;
}

export function useTechnicalsCache(ticker: string) {
  const queryClient = useQueryClient();

  const { data: cachedData } = useQuery<TechnicalsCacheData>({
    queryKey: queryKeys.technicals.byTicker(ticker),
    enabled: false,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const setCachedData = useCallback((data: TechnicalsCacheData) => {
    queryClient.setQueryData(queryKeys.technicals.byTicker(ticker), data);
  }, [queryClient, ticker]);

  const clearCache = useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.technicals.byTicker(ticker) });
  }, [queryClient, ticker]);

  return {
    cachedData,
    setCachedData,
    clearCache,
    hasCache: !!cachedData,
  };
}
