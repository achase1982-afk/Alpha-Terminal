import { useEffect, useRef, useState } from "react";
import {
  atGlanceFlowFixtureEnabled,
  atGlanceFlowReplayEnabled,
  atGlanceFlowWorstCaseEnabled,
} from "@/lib/active-trader/atGlanceFeature";
import {
  buildNvdaTapeFixture,
  buildSpxFlowFixture,
  spxFlowDisplayTotals,
} from "@/lib/active-trader/deskFlowFixture";
import { resolveAtGlanceMode } from "@/lib/active-trader/atGlanceMode";
import { deskFlowStreamSymbol } from "@/lib/active-trader/deskFlowStreamSymbol";
import {
  createDeskFlowAggregatorInternal,
  deskFlowAggregatorMarkConnected,
  deskFlowAggregatorMarkUnsupported,
  deskFlowAggregatorProject,
  reduceDeskFlowFrame,
  type DeskFlowAggregate,
} from "@/lib/active-trader/deskFlowAggregator";
import { parseDeskFlowFrame } from "@/lib/active-trader/deskFlowFrameTypes";
import { deskFlowReplayForSymbol } from "@/lib/active-trader/deskFlowReplay";
import { buildAuthenticatedEventSourceUrl, fetchWithAuth } from "@/lib/fetchWithAuth";

const API_BASE = import.meta.env.BASE_URL + "api";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function fixtureAggregate(symbol: string): DeskFlowAggregate {
  const mode = resolveAtGlanceMode(symbol);
  let internal = createDeskFlowAggregatorInternal(mode);
  internal = deskFlowAggregatorMarkConnected(internal, true);
  if (mode === "index") {
    spxFlowDisplayTotals(buildSpxFlowFixture());
    const now = Date.now();
    internal = reduceDeskFlowFrame(internal, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: now - 5_000,
      call_buy: 5.9e6,
      call_sell: 1.1e6,
      put_buy: 1.2e6,
      put_sell: 18.1e6,
      rx_ts_ms: now,
    });
  } else if (mode === "stock") {
    const tape = buildNvdaTapeFixture();
    const now = Date.now();
    internal = reduceDeskFlowFrame(internal, {
      type: "tape_1s",
      sym: symbol.replace(/^\$/, "").toUpperCase(),
      bucket_ms: now - 5_000,
      buy_$: tape.buyersLift1m,
      sell_$: tape.sellersHit1m,
      n_prints: 3,
      rx_ts_ms: now,
    });
  } else if (mode === "futures") {
    const now = Date.now();
    internal = reduceDeskFlowFrame(internal, {
      type: "tape_1s",
      sym: deskFlowStreamSymbol(symbol),
      bucket_ms: now - 5_000,
      buy_$: 8e6,
      sell_$: 3e6,
      n_prints: 6,
      futures_mult: 50,
      rx_ts_ms: now,
    });
  }
  return deskFlowAggregatorProject(internal);
}

const WORST_USD = 1.23e9;

function worstCaseAggregate(symbol: string): DeskFlowAggregate {
  const mode = resolveAtGlanceMode(symbol);
  let internal = createDeskFlowAggregatorInternal(mode);
  internal = deskFlowAggregatorMarkConnected(internal, true);
  const now = Date.now();
  if (mode === "index") {
    internal = reduceDeskFlowFrame(internal, {
      type: "flow_1s",
      sym: "SPX",
      bucket_ms: now - 5_000,
      call_buy: WORST_USD,
      call_sell: WORST_USD,
      put_buy: WORST_USD,
      put_sell: WORST_USD,
      rx_ts_ms: now,
    });
    internal = reduceDeskFlowFrame(internal, {
      type: "flow_60s",
      sym: "SPX",
      bar_start_ms: now - 120_000,
      call_buy: WORST_USD,
      call_sell: WORST_USD,
      put_buy: WORST_USD,
      put_sell: WORST_USD,
      rx_ts_ms: now,
    });
    internal = reduceDeskFlowFrame(internal, {
      type: "flow_60s",
      sym: "SPX",
      bar_start_ms: now - 3_600_000,
      call_buy: WORST_USD,
      call_sell: WORST_USD,
      put_buy: WORST_USD,
      put_sell: WORST_USD,
      rx_ts_ms: now,
    });
  }
  return deskFlowAggregatorProject(internal);
}

function replayAggregate(symbol: string): DeskFlowAggregate {
  const mode = resolveAtGlanceMode(symbol);
  let internal = createDeskFlowAggregatorInternal(mode);
  internal = deskFlowAggregatorMarkConnected(internal, true);
  const frames = deskFlowReplayForSymbol(symbol);
  const base = Date.now() - 120_000;
  for (const f of frames) {
    const shifted = { ...f, bucket_ms: "bucket_ms" in f ? base + (f.bucket_ms as number) : undefined, bar_start_ms: "bar_start_ms" in f ? base + (f.bar_start_ms as number) : undefined, rx_ts_ms: base + (f.rx_ts_ms ?? 0) };
    internal = reduceDeskFlowFrame(internal, shifted);
  }
  return deskFlowAggregatorProject(internal);
}

export function useDeskFlowStream(symbol: string, enabled: boolean): DeskFlowAggregate {
  const mode = resolveAtGlanceMode(symbol);
  const [aggregate, setAggregate] = useState<DeskFlowAggregate>(() =>
    deskFlowAggregatorProject(createDeskFlowAggregatorInternal(mode)),
  );
  const aggRef = useRef(createDeskFlowAggregatorInternal(mode));

  useEffect(() => {
    aggRef.current = createDeskFlowAggregatorInternal(mode);
    setAggregate(deskFlowAggregatorProject(aggRef.current));
  }, [symbol, mode]);

  useEffect(() => {
    if (!enabled) {
      setAggregate(deskFlowAggregatorProject(aggRef.current));
      return;
    }

    if (atGlanceFlowWorstCaseEnabled()) {
      setAggregate(worstCaseAggregate(symbol));
      return;
    }

    if (atGlanceFlowReplayEnabled()) {
      setAggregate(replayAggregate(symbol));
      return;
    }

    if (atGlanceFlowFixtureEnabled()) {
      setAggregate(fixtureAggregate(symbol));
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let backoff = INITIAL_BACKOFF_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const bump = () => {
      if (cancelled) return;
      setAggregate(deskFlowAggregatorProject(aggRef.current));
    };

    const open = async () => {
      if (cancelled) return;
      aggRef.current = deskFlowAggregatorMarkConnected(aggRef.current, false);
      bump();

      const streamSym = deskFlowStreamSymbol(symbol);
      const path = `${API_BASE}/desk/v1/stream/flow?symbol=${encodeURIComponent(streamSym)}`;
      try {
        const probe = await fetchWithAuth(path, { headers: { Accept: "text/event-stream" } });
        if (!probe.ok) {
          const body = (await probe.json().catch(() => ({}))) as { error?: string };
          if (body.error === "futures_flow_unsupported") {
            setAggregate(deskFlowAggregatorMarkUnsupported(aggRef.current));
            return;
          }
          aggRef.current = deskFlowAggregatorMarkConnected(aggRef.current, false);
          bump();
          scheduleReconnect();
          return;
        }
        await probe.body?.cancel();
      } catch {
        scheduleReconnect();
        return;
      }

      if (cancelled) return;

      const url = await buildAuthenticatedEventSourceUrl(path);
      es = new EventSource(url);
      es.onopen = () => {
        backoff = INITIAL_BACKOFF_MS;
        aggRef.current = deskFlowAggregatorMarkConnected(aggRef.current, true);
        bump();
      };
      es.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const frame = parseDeskFlowFrame(JSON.parse(ev.data));
          if (!frame) return;
          if (frame.type === "resync") return;
          aggRef.current = reduceDeskFlowFrame(aggRef.current, frame);
          bump();
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        try {
          es?.close();
        } catch {
          /* noop */
        }
        es = null;
        aggRef.current = deskFlowAggregatorMarkConnected(aggRef.current, false);
        bump();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        void open();
      }, backoff);
    };

    void open();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        es?.close();
      } catch {
        /* noop */
      }
      es = null;
    };
  }, [symbol, enabled, mode]);

  return aggregate;
}