import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { queryKeys } from '../api/queryKeys';

export interface ScanCacheData {
  results: any;
  timestamp: number;
}

type ScanCacheQueryData = ScanCacheData | undefined;

export function useScanCache() {
  const queryClient = useQueryClient();

  const { data: cachedData } = useQuery<ScanCacheQueryData>({
    queryKey: queryKeys.scan.latest(),
    queryFn: () => Promise.resolve(undefined),
    enabled: false,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const setCachedData = useCallback((data: ScanCacheData) => {
    queryClient.setQueryData(queryKeys.scan.latest(), data);
  }, [queryClient]);

  const clearCache = useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.scan.latest() });
  }, [queryClient]);

  return {
    cachedData,
    setCachedData,
    clearCache,
    hasCache: !!cachedData,
  };
}
