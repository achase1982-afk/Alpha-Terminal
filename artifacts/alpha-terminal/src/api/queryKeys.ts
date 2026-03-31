export const queryKeys = {
  marketPulse: {
    all: ['marketPulse'] as const,
    current: () => [...queryKeys.marketPulse.all, 'current'] as const,
  },

  strategist: {
    all: ['strategist'] as const,
    byTicker: (ticker: string) => [...queryKeys.strategist.all, ticker] as const,
  },

  technicals: {
    all: ['technicals'] as const,
    byTicker: (ticker: string) => [...queryKeys.technicals.all, ticker] as const,
  },

  scan: {
    all: ['scan'] as const,
    latest: () => [...queryKeys.scan.all, 'latest'] as const,
  },
} as const;
