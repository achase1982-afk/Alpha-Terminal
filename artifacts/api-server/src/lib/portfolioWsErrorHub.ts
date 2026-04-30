/** Breaks circular deps: tokenStore can emit portfolio_error without importing wsServer. */

type PortfolioErrorPayload = unknown;

let broadcastPortfolioError: ((data: PortfolioErrorPayload) => void) | null = null;

export function registerPortfolioErrorBroadcast(fn: (data: PortfolioErrorPayload) => void) {
  broadcastPortfolioError = fn;
}

export function emitPortfolioError(data: PortfolioErrorPayload) {
  broadcastPortfolioError?.(data);
}
