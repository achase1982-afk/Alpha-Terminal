/** After auth/billing failures, poll at most every 30 minutes. */
export const DESK_UW_AUTH_BACKOFF_MS = 30 * 60_000;

let pauseUntilMs = 0;

export function deskUwPollPaused(now = Date.now()): boolean {
  return now < pauseUntilMs;
}

export function deskUwPollResumeAtMs(): number | null {
  return pauseUntilMs > Date.now() ? pauseUntilMs : null;
}

export function deskUwRecordHttpStatus(status: number, retryAfterSec?: number): void {
  if (status === 401 || status === 402 || status === 403) {
    pauseUntilMs = Date.now() + DESK_UW_AUTH_BACKOFF_MS;
    return;
  }
  if (status === 429) {
    const sec = retryAfterSec != null && retryAfterSec > 0 ? retryAfterSec : 60;
    pauseUntilMs = Date.now() + Math.min(sec, 3600) * 1000;
  }
}

export function deskUwResetPollControlForTests(): void {
  pauseUntilMs = 0;
}