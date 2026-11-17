import { deskUwGet } from "./deskUwHttp.js";
import {
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
  type DeskFeedId,
} from "./deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../logger.js";

const UW_TICKER = "SPX";
const UW_SOURCE = "unusual_whales";
const REFRESH_MS = 90_000;

let refreshInFlight: Promise<void> | null = null;
let lastRefreshMs = 0;

function markUwGammaNotConfigured(): void {
  for (const feed of ["live_gamma_0dte", "live_gamma", "live_net_prem", "uw_flow"] as DeskFeedId[]) {
    deskMarkFeedNotConfigured(feed, UW_SOURCE);
  }
}

export type DeskUwFeedSnapshot = {
  data: unknown;
  asOfMs: number;
  row_count: number;
};

const snapshots: Partial<Record<DeskFeedId, DeskUwFeedSnapshot>> = {};

export function getDeskUwFeedSnapshot(
  feed: "live_gamma_0dte" | "live_gamma" | "live_net_prem",
): DeskUwFeedSnapshot | null {
  return snapshots[feed] ?? null;
}

function extractUwRows(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.rows)) return o.rows;
    if (Array.isArray(o.ticks)) return o.ticks;
  }
  return [];
}

async function deskUwGetAllPages(
  path: string,
  pageSize = 50,
): Promise<{ ok: boolean; status: number; rows: unknown[]; asOfMs: number }> {
  const rows: unknown[] = [];
  let page = 1;
  let asOfMs = Date.now();
  let ok = true;
  let status = 200;
  while (page <= 250) {
    const suffix = path.includes("?") ? `&page=${page}` : `?page=${page}`;
    const res = await deskUwGet(`${path}${suffix}`);
    asOfMs = res.asOfMs;
    if (!res.ok) {
      ok = false;
      status = res.status;
      break;
    }
    const batch = extractUwRows(res.json);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    page += 1;
  }
  return { ok, status, rows, asOfMs };
}

export async function refreshDeskUwLiveFeeds(force = false): Promise<void> {
  const key = getUwApiKey();
  if (!key) {
    markUwGammaNotConfigured();
    return;
  }

  const now = Date.now();
  if (!force && now - lastRefreshMs < REFRESH_MS && refreshInFlight) {
    await refreshInFlight;
    return;
  }
  if (!force && now - lastRefreshMs < REFRESH_MS) return;

  if (refreshInFlight) {
    await refreshInFlight;
    return;
  }

  refreshInFlight = (async () => {
    const specs: Array<{ feed: DeskFeedId; path: string; paginate: boolean }> = [
      { feed: "live_gamma_0dte", path: `/api/stock/${UW_TICKER}/spot-exposures/expiry-strike`, paginate: true },
      { feed: "live_gamma", path: `/api/stock/${UW_TICKER}/spot-exposures/strike`, paginate: true },
      { feed: "live_net_prem", path: `/api/stock/${UW_TICKER}/net-prem-ticks`, paginate: false },
    ];

    for (const { feed, path, paginate } of specs) {
      try {
        const res = paginate ? await deskUwGetAllPages(path) : await deskUwGet(path).then((r) => ({
          ok: r.ok,
          status: r.status,
          rows: extractUwRows(r.json),
          asOfMs: r.asOfMs,
        }));
        if (!res.ok) {
          deskMarkFeedError(feed, `uw_http_${res.status}`, UW_SOURCE);
          logger.debug({ feed, status: res.status }, "Desk UW live feed fetch failed");
          continue;
        }
        const payload = paginate ? { data: res.rows } : res.rows;
        snapshots[feed] = { data: payload, asOfMs: res.asOfMs, row_count: res.rows.length };
        deskTouchFeed(feed, res.asOfMs, UW_SOURCE);
      } catch (err) {
        deskMarkFeedError(feed, "uw_fetch_error", UW_SOURCE);
        logger.debug({ err, feed }, "Desk UW live feed error");
      }
    }
    lastRefreshMs = Date.now();
  })().finally(() => {
    refreshInFlight = null;
  });

  await refreshInFlight;
}

export function startDeskUwLiveFeedRefresh(): void {
  if (!getUwApiKey()) {
    markUwGammaNotConfigured();
    return;
  }
  void refreshDeskUwLiveFeeds(true);
  setInterval(() => {
    void refreshDeskUwLiveFeeds();
  }, REFRESH_MS);
}