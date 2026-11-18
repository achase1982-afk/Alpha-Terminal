import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";
import { loadAtFlowWindowMs } from "@/lib/active-trader/atFlowWindowSec";
import {
  buildDeskNetPremiumGlance,
  DEFAULT_NET_PREMIUM_WINDOW_MS,
  EMPTY_HYSTERESIS,
  type DeskNetPremiumGlance,
} from "@/lib/active-trader/deskFlowNetPremium";
import { atGlanceFlowFixtureEnabled, atGlanceFlowReplayEnabled } from "@/lib/active-trader/atGlanceFeature";
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
import { getAtFixtureOverride } from "@/lib/active-trader/atFixtureBridge";

const API_BASE = import.meta.env.BASE_URL + "api";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const FLOW_RENDER_MS = 220;

function buildFixtureInternal(symbol: string) {
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
  return internal;
}

function buildReplayInternal(symbol: string) {
  const mode = resolveAtGlanceMode(symbol);
  let internal = createDeskFlowAggregatorInternal(mode);
  internal = deskFlowAggregatorMarkConnected(internal, true);
  const frames = deskFlowReplayForSymbol(symbol);
  const base = Date.now() - 120_000;
  for (const f of frames) {
    const shifted = {
      ...f,
      bucket_ms: "bucket_ms" in f ? base + (f.bucket_ms as number) : undefined,
      bar_start_ms: "bar_start_ms" in f ? base + (f.bar_start_ms as number) : undefined,
      rx_ts_ms: base + (f.rx_ts_ms ?? 0),
    };
    internal = reduceDeskFlowFrame(internal, shifted);
  }
  return internal;
}

export type DeskFlowStreamState = {
  aggregate: DeskFlowAggregate;
  /** From at-flow-stream `meta` when desk reports session_closed. */
  sessionClosed: boolean;
  netPremium: DeskNetPremiumGlance;
  flowWindowMs: number;
};

function projectNet(
  aggRef: ReturnType<typeof createDeskFlowAggregatorInternal>,
  aggregate: DeskFlowAggregate,
  windowMs: number,
  scaleRef: MutableRefObject<number>,
  hystRef: MutableRefObject<typeof EMPTY_HYSTERESIS>,
  sessionClosed: boolean,
): DeskNetPremiumGlance {
  const built = buildDeskNetPremiumGlance(aggRef, aggregate, windowMs, scaleRef.current, hystRef.current, Date.now(), {
    sessionClosed,
  });
  scaleRef.current = built.scaleMax;
  hystRef.current = built.hysteresis;
  return built.glance;
}

export function useDeskFlowStream(symbol: string, enabled: boolean): DeskFlowStreamState {
  const mode = resolveAtGlanceMode(symbol);
  const flowWindowMs = loadAtFlowWindowMs() || DEFAULT_NET_PREMIUM_WINDOW_MS;
  const [aggregate, setAggregate] = useState<DeskFlowAggregate>(() =>
    deskFlowAggregatorProject(createDeskFlowAggregatorInternal(mode)),
  );
  const [sessionClosed, setSessionClosed] = useState(false);
  const aggRef = useRef(createDeskFlowAggregatorInternal(mode));
  const scaleRef = useRef(400_000);
  const hystRef = useRef({ ...EMPTY_HYSTERESIS });
  const [netPremium, setNetPremium] = useState<DeskNetPremiumGlance>(() =>
    projectNet(aggRef.current, aggregate, flowWindowMs, scaleRef, hystRef, false),
  );
  const paintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionClosedRef = useRef(false);

  const schedulePaint = useCallback(() => {
    if (paintTimer.current) return;
    paintTimer.current = setTimeout(() => {
      paintTimer.current = null;
      const agg = deskFlowAggregatorProject(aggRef.current);
      setAggregate(agg);
      setNetPremium(projectNet(aggRef.current, agg, flowWindowMs, scaleRef, hystRef, sessionClosedRef.current));
    }, FLOW_RENDER_MS);
  }, [flowWindowMs]);

  useEffect(() => {
    aggRef.current = createDeskFlowAggregatorInternal(mode);
    scaleRef.current = 400_000;
    hystRef.current = { ...EMPTY_HYSTERESIS };
    const agg = deskFlowAggregatorProject(aggRef.current);
    setAggregate(agg);
    setNetPremium(projectNet(aggRef.current, agg, flowWindowMs, scaleRef, hystRef, false));
    setSessionClosed(false);
    sessionClosedRef.current = false;
  }, [symbol, mode, flowWindowMs]);

  useEffect(() => {
    if (!enabled) {
      schedulePaint();
      return;
    }

    if (atGlanceFlowReplayEnabled()) {
      aggRef.current = buildReplayInternal(symbol);
      const agg = deskFlowAggregatorProject(aggRef.current);
      setAggregate(agg);
      setNetPremium(projectNet(aggRef.current, agg, flowWindowMs, scaleRef, hystRef, false));
      return;
    }

    if (atGlanceFlowFixtureEnabled()) {
      aggRef.current = buildFixtureInternal(symbol);
      const agg = deskFlowAggregatorProject(aggRef.current);
      setAggregate(agg);
      setNetPremium(projectNet(aggRef.current, agg, flowWindowMs, scaleRef, hystRef, false));
      return;
    }

    if (import.meta.env.DEV && getAtFixtureOverride()?.presentation?.skipNetwork) {
      aggRef.current = buildFixtureInternal(symbol);
      const agg = deskFlowAggregatorProject(aggRef.current);
      setAggregate(agg);
      setNetPremium(projectNet(aggRef.current, agg, flowWindowMs, scaleRef, hystRef, false));
      return;
    }

    setSessionClosed(false);
    sessionClosedRef.current = false;
    let cancelled = false;
    let es: EventSource | null = null;
    let backoff = INITIAL_BACKOFF_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const bump = () => {
      if (cancelled) return;
      schedulePaint();
    };

    const open = async () => {
      if (cancelled) return;
      aggRef.current = deskFlowAggregatorMarkConnected(aggRef.current, false);
      bump();

      const streamSym = deskFlowStreamSymbol(symbol);
      const path = `${API_BASE}/market/at-flow-stream?symbol=${encodeURIComponent(streamSym)}`;
      if (cancelled) return;

      const url = await buildAuthenticatedEventSourceUrl(path);
      es = new EventSource(url);
      es.addEventListener("meta", (ev) => {
        if (cancelled) return;
        try {
          const j = JSON.parse((ev as MessageEvent).data) as { sessionClosed?: boolean };
          if (j.sessionClosed === true) {
            setSessionClosed(true);
            sessionClosedRef.current = true;
          }
        } catch {
          /* ignore */
        }
      });
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
  }, [symbol, enabled, mode, flowWindowMs, schedulePaint]);

  useEffect(() => {
    const tick = window.setInterval(() => schedulePaint(), flowWindowMs > 30_000 ? 500 : 350);
    return () => window.clearInterval(tick);
  }, [flowWindowMs, schedulePaint]);

  return { aggregate, sessionClosed, netPremium, flowWindowMs };
}