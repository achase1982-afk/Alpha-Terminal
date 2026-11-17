import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  TOOLBAR_H, SUB_HEADER_H, BG, BG_HEADER, BORDER, DIM, WHITE, MONO, FW_LIGHT, noScrollbar,
} from "@/components/options/optionsTheme";
import { buildAtHoldSignature } from "@/lib/active-trader/atHoldSig";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import { computeZoneModel, type ChainRowForZones } from "@/lib/active-trader/zonesModel";
import { useFlowByKey } from "@/lib/active-trader/useFlowByKey";
import { findAtmStrikeIndex } from "@/lib/optionsSchwabKey";
import { useChainOptionHold } from "@/hooks/useChainOptionHold";
import type { ChainHoldSubscribers } from "@/hooks/useChainOptionHold";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { TemplateBar } from "./TemplateBar";
import { RegimeStrip } from "./RegimeStrip";
import { FilterStrip, type LaneFilterKey } from "./FilterStrip";
import { LadderBody, type LadderRowModel } from "./LadderBody";

export interface AtExpirationGroup {
  expiration: string;
  dte: number;
  dateLabel: string;
  rows: { strike: number; call: OptionsContract | null; put: OptionsContract | null }[];
}

interface ActiveTraderViewProps {
  symbol: string;
  groups: AtExpirationGroup[];
  underlyingPrice: number | null;
  stickyOffset: number;
  accentHex: string;
  holdSubs: ChainHoldSubscribers;
  onAddLeg: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onOpenReview: (contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => void;
}

const LADDER_RADIUS = 20;

function buildPressureHeadline(flowTotals: { cb: number; cs: number; pb: number; ps: number }): string {
  const up = flowTotals.cb + flowTotals.ps;
  const down = flowTotals.cs + flowTotals.pb;
  const net = up - down;
  const pressure =
    Math.abs(net) < (up + down) * 0.2 ? "Balanced flow" : net > 0 ? "Upward pressure" : "Downward pressure";
  return `${pressure} · Price stalled`;
}

export const ActiveTraderView = memo(function ActiveTraderView({
  symbol,
  groups,
  underlyingPrice,
  stickyOffset,
  accentHex,
  holdSubs,
  onAddLeg,
  onOpenReview,
}: ActiveTraderViewProps) {
  const primary = groups[0];
  const [windowSec, setWindowSec] = useState<30 | 60 | 300>(30);
  const [laneFilters, setLaneFilters] = useState<Record<LaneFilterKey, boolean>>({
    call_buy: true,
    call_sell: true,
    put_buy: true,
    put_sell: true,
  });
  const [tradeStripStrike, setTradeStripStrike] = useState<number | null>(null);
  const [tradeContext, setTradeContext] = useState<{ contract: OptionsContract; type: "CALL" | "PUT" } | null>(null);
  const [selected, setSelected] = useState<{ contract: OptionsContract; type: "CALL" | "PUT" } | null>(null);
  const [regimeLabel, setRegimeLabel] = useState<string | null>(null);
  const [regimeDegraded, setRegimeDegraded] = useState(false);

  const symbolClass = symbol.toUpperCase().includes("SPX") || symbol.startsWith("$") ? "index" : "equity";
  const [prefs, setPrefs] = useState<ActiveTraderTemplatePrefs>(() => loadActiveTraderPrefs(symbolClass));

  useEffect(() => {
    void fetchWithAuth("/api/strategist/regime")
      .then((r) => r.json())
      .then((j: { directionalConviction?: string; degraded?: boolean }) => {
        setRegimeLabel(j.directionalConviction?.replace(/_/g, " ") ?? null);
        setRegimeDegraded(!!j.degraded);
      })
      .catch(() => setRegimeLabel(null));
  }, []);

  const ladderRows: LadderRowModel[] = useMemo(() => {
    if (!primary) return [];
    const strikes = primary.rows.map((r) => r.strike);
    const atm = findAtmStrikeIndex(strikes, underlyingPrice);
  const start = Math.max(0, atm - LADDER_RADIUS);
    const end = Math.min(primary.rows.length, atm + LADDER_RADIUS + 1);
    const slice = primary.rows.slice(start, end);
    return slice
      .map((r) => ({ strike: r.strike, call: r.call, put: r.put }))
      .sort((a, b) => b.strike - a.strike);
  }, [primary, underlyingPrice]);

  const streamKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of ladderRows) {
      if (row.call?.streamKey) keys.push(row.call.streamKey);
      if (row.put?.streamKey) keys.push(row.put.streamKey);
    }
    return keys;
  }, [ladderRows]);

  const holdSig = useMemo(() => {
    if (!primary || streamKeys.length === 0) return null;
    return buildAtHoldSignature(symbol, primary.expiration, streamKeys);
  }, [primary, streamKeys, symbol]);

  useChainOptionHold(
    holdSig?.holdSig,
    holdSig?.keys ?? [],
    holdSig?.viewId,
    holdSubs,
    underlyingPrice,
  );

  const flowByKey = useFlowByKey(streamKeys, windowSec * 1000);

  const zones = useMemo(() => {
    if (!primary) return computeZoneModel([], underlyingPrice);
    const rows: ChainRowForZones[] = primary.rows.map((r) => ({
      strike: r.strike,
      callOi: r.call?.openInterest ?? 0,
      putOi: r.put?.openInterest ?? 0,
      callGamma: r.call?.gamma ?? null,
      putGamma: r.put?.gamma ?? null,
    }));
    return computeZoneModel(rows, underlyingPrice);
  }, [primary, underlyingPrice]);

  const classifiedPct = useMemo(() => {
    let cls = 0;
    let tot = 0;
    for (const k of streamKeys) {
      const f = flowByKey[k];
      if (!f) continue;
      const c = f.buy + f.sell + f.even;
      const t = c + f.unknown;
      cls += c;
      tot += t;
    }
    return tot > 0 ? cls / tot : null;
  }, [flowByKey, streamKeys]);

  const headline = useMemo(() => {
    let cb = 0;
    let cs = 0;
    let pb = 0;
    let ps = 0;
    for (const row of ladderRows) {
      if (row.call?.streamKey) {
        const f = flowByKey[row.call.streamKey];
        if (f) {
          cb += f.buy;
          cs += f.sell;
        }
      }
      if (row.put?.streamKey) {
        const f = flowByKey[row.put.streamKey];
        if (f) {
          pb += f.buy;
          ps += f.sell;
        }
      }
    }
    return buildPressureHeadline({ cb, cs, pb, ps });
  }, [ladderRows, flowByKey]);

  const positions = usePortfolioStreamStore((s) => s.account?.positions ?? []);
  const positionQtyByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) {
      const sym = p.instrument?.symbol ?? p.symbol;
      if (typeof sym !== "string") continue;
      const qty = p.longQuantity ?? p.shortQuantity ?? p.quantity ?? 0;
      const signed = p.shortQuantity ? -Math.abs(p.shortQuantity) : qty;
      map.set(sym.trim(), signed);
    }
    return map;
  }, [positions]);

  const accounts = useSchwabAccountStore((s) => s.accounts);
  const accountLabel = accounts.length > 0 ? `LIVE ••${String(accounts[0]?.accountNumber ?? "").slice(-4)}` : "Account";
  const isPaper = false;

  const toggleLane = useCallback((key: LaneFilterKey) => {
    setLaneFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onPrefsChange = useCallback(
    (p: ActiveTraderTemplatePrefs) => {
      setPrefs(p);
      saveActiveTraderPrefs(symbolClass, p);
    },
    [symbolClass],
  );

  const handleCellTap = useCallback((contract: OptionsContract, type: "CALL" | "PUT") => {
    setSelected({ contract, type });
    setTradeContext({ contract, type });
    setTradeStripStrike(contract.strike);
  }, []);

  const instrumentLabel = useMemo(() => {
    if (selected) {
      const root = symbol.replace(/^\$/, "").slice(0, 4);
      return `${root} ${selected.contract.strike}${selected.type === "CALL" ? "C" : "P"}`;
    }
    const und = symbol.toUpperCase().startsWith("SPX") ? "SPY" : symbol;
    return `${und} (underlying)`;
  }, [selected, symbol]);

  const templateBarTop = stickyOffset + TOOLBAR_H;
  const regimeTop = templateBarTop + 64;
  const filterTop = regimeTop + 120;
  const headerTop = filterTop + 72;

  if (!primary) {
    return (
      <div className="p-8 text-center font-mono" style={{ color: DIM, fontSize: 10 }}>
        No expiry for Active Trader
      </div>
    );
  }

  return (
    <div style={{ background: BG }}>
      <div
        className="flex items-center justify-between px-3 sticky z-40"
        style={{ top: stickyOffset, height: TOOLBAR_H, background: BG, borderBottom: `1px solid ${BORDER}`, fontFamily: MONO }}
      >
        <span style={{ fontSize: 12, color: DIM }}>
          {primary.dateLabel} · {primary.dte === 0 ? "0DTE" : `${primary.dte}D`} ▾
        </span>
        <select
          className="h-6 px-1.5 rounded border"
          style={{ fontSize: 11, background: "transparent", borderColor: BORDER, color: DIM }}
          value={windowSec}
          onChange={(e) => setWindowSec(Number(e.target.value) as 30 | 60 | 300)}
        >
          <option value={30}>30s</option>
          <option value={60}>1m</option>
          <option value={300}>5m</option>
        </select>
      </div>

      <TemplateBar
        accentHex={accentHex}
        instrumentLabel={instrumentLabel}
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        onSell={() => selected && onOpenReview(selected.contract, "SELL", selected.type)}
        onBuy={() => selected && onOpenReview(selected.contract, "BUY", selected.type)}
        stickyTop={templateBarTop}
        accountLabel={accountLabel}
        isPaper={isPaper}
      />

      <RegimeStrip
        accentHex={accentHex}
        regimeLabel={regimeLabel}
        regimeDegraded={regimeDegraded}
        zones={zones}
        headline={headline}
        stickyTop={regimeTop}
      />

      <FilterStrip
        accentHex={accentHex}
        filters={laneFilters}
        onToggle={toggleLane}
        classifiedPct={classifiedPct}
        windowLabel={`last ${windowSec}s`}
        stickyTop={filterTop}
      />

      <div
        className="sticky z-[36] grid px-1"
        style={{
          top: headerTop,
          height: SUB_HEADER_H,
          gridTemplateColumns: "1fr 1.1fr 44px 1.1fr 1fr",
          background: BG_HEADER,
          borderBottom: `1px solid ${BORDER}`,
          fontFamily: MONO,
          fontSize: 10,
          color: DIM,
          fontWeight: FW_LIGHT,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span className="text-center">Put flow</span>
        <span className="text-center">Puts</span>
        <span className="text-center" style={{ color: WHITE }}>Strike</span>
        <span className="text-center">Calls</span>
        <span className="text-center">Call flow</span>
      </div>

      <div style={{ ...noScrollbar, maxHeight: "min(60vh, 520px)", overflowY: "auto" }}>
        <LadderBody
          rows={ladderRows}
          accentHex={accentHex}
          underlyingPrice={underlyingPrice}
          zones={zones}
          maxFlow={1}
          laneFilters={laneFilters}
          windowMs={windowSec * 1000}
          tradeStripStrike={tradeStripStrike}
          tradeContext={tradeContext}
          onCellTap={handleCellTap}
          onTradeStripSell={(c, t) => onOpenReview(c, "SELL", t)}
          onTradeStripBuy={(c, t) => onOpenReview(c, "BUY", t)}
          onAddLeg={onAddLeg}
          positionQtyByKey={positionQtyByKey}
          flowByKey={flowByKey}
          symbolLabel={symbol.replace(/^\$/, "").slice(0, 3).toUpperCase()}
        />
      </div>
    </div>
  );
});