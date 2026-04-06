import { useMemo } from 'react';
import type { CreditSpread } from '@/lib/strategyCalculator';
import { calculateBullPutSpread } from '@/lib/strategyCalculator';

export const useStrategy = (spread: CreditSpread) => {
  const metrics = useMemo(() => calculateBullPutSpread(spread), [spread]);

  return {
    ...metrics,
    isValid: metrics.maxRisk <= 750,
    riskCheckSummary: {
      positionSizePass: metrics.maxRisk <= 750,
    },
  };
};
