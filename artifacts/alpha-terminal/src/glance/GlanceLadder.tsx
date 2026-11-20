import { useEffect, useMemo, useRef, useState } from "react";
import type { GetOptionChainParams, OptionChainResponse, OptionContract } from "@workspace/api-client-react";
import { useGetOptionChain } from "@workspace/api-client-react";
import { LadderBody, type LadderRowModel } from "@/components/active-trader/LadderBody";
import type { OptionsContract } from "@/components/OptionsTab";
import { BORDER, FW_LIGHT, GOLD } from "@/components/options/optionsTheme";
import { AT_HEADER_BG, AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import {
  AT_LADDER_CALLS_HDR,
  AT_LADDER_COL_HDR_H,
  AT_LADDER_GRID,
  AT_LADDER_GROUP_HDR_H,
  AT_LADDER_GUTTER_X,
  AT_LADDER_PUTS_HDR,
  AT_LADDER_ROW_H,
  AT_LADDER_THIN_SEP,
} from "@/lib/active-trader/atLadderLayout";
import { createAtLadderSelectionStore } from "@/lib/active-trader/atLadderSelection";
import { useAtLadderVolumeHeat } from "@/lib/active-trader/useAtLadderVolumeHeat";
import { seriesRootFromExpiration } from "@/lib/active-trader/optionSeries";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { resolveOptionStreamHolderId } from "@/lib/optionHoldClient";
import { buildSchwabOptionKey, findAtmStrikeIndex } from "@/lib/optionsSchwabKey";
import { getStreamClientId } from "@/lib/streamClientId";
import { etTodayYmd } from "@/lib/active-trader/atLadderStrikeCount";

const VIEW_ID = "glance-ladder";
const EMPTY_POSITIONS = new Map<string, number>();

type ChainLeg = OptionContract & { schwabSymbol?: string; streamKey?: string };

function legKey(leg: ChainLeg, right: "C" | "P"): OptionsContract {
  const explicit = leg.schwabSymbol?.trim() || leg.streamKey?.trim();
  const root = seriesRootFromExpiration(leg.expiration) ?? "SPXW";
  const streamKey = explicit || buildSchwabOptionKey(root, leg.expiration, leg.strike, right);
  return { ...leg, streamKey };
}

function ladderRows(calls: ChainLeg[], puts: ChainLeg[], today: string): LadderRowModel[] {
  const callByStrike = new Map<number, OptionsContract>();
  const putByStrike = new Map<number, OptionsContract>();
  const take = (leg: ChainLeg, right: "C" | "P", book: Map<number, OptionsContract>) => {
    const ymd = leg.expiration?.slice(0, 10);
    if (ymd !== today || !Number.isFinite(leg.strike)) return;
    book.set(leg.strike, legKey(leg, right));
  };
  for (const leg of calls) take(leg, "C", callByStrike);
  for (const leg of puts) take(leg, "P", putByStrike);
  const strikes = [...new Set([...callByStrike.keys(), ...putByStrike.keys()])].sort((a, b) => b - a);
  return strikes.map((strike) => ({
    strike,
    call: callByStrike.get(strike) ?? null,
    put: putByStrike.get(strike) ?? null,
  }));
}

/**
 * Read-only copy of the phone Active Trader ladder.
 * Buyers light the ask. Sellers light the bid. Taps do not place orders.
 */
export function GlanceLadder({
  spot,
  callWall,
  putWall,
  flip,
}: {
  spot: number | null;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
}) {
  const today = etTodayYmd();
  const chainParams = {
    symbol: "$SPX",
    contractType: "ALL",
    strikeCount: 12,
    fromDate: today,
    toDate: today,
    range: "NTM",
    series: "SPXW",
  } as GetOptionChainParams;
  const chain = useGetOptionChain<OptionChainResponse>(chainParams, {
    query: {
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: 1,
    },
  });
  const rows = useMemo(
    () => ladderRows((chain.data?.calls ?? []) as ChainLeg[], (chain.data?.puts ?? []) as ChainLeg[], today),
    [chain.data, today],
  );
  const streamKeys = useMemo(
    () => rows.flatMap((row) => [row.call?.streamKey, row.put?.streamKey].filter((key): key is string => Boolean(key))),
    [rows],
  );
  const keySig = streamKeys.slice().sort().join("\n");
  const keysRef = useRef(streamKeys);
  keysRef.current = streamKeys;
  const spotRef = useRef(spot);
  spotRef.current = spot;

  useEffect(() => {
    if (!keySig) return;
    const clientId = getStreamClientId();
    const holderId = resolveOptionStreamHolderId(clientId, "chain", VIEW_ID);
    let stopped = false;
    const post = () => {
      if (stopped) return;
      const symbols = keysRef.current;
      if (symbols.length === 0) return;
      const mark = spotRef.current;
      void fetchWithAuth("/api/stream/option-symbols", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stream-client-id": clientId,
        },
        body: JSON.stringify({
          symbols,
          purpose: "chain",
          viewId: VIEW_ID,
          clientId,
          holderId,
          ...(mark != null && Number.isFinite(mark) ? { underlyingPrice: mark } : {}),
        }),
      });
    };
    post();
    const timer = window.setInterval(post, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void fetchWithAuth("/api/stream/release-holds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stream-client-id": clientId,
        },
        body: JSON.stringify({ clientId, holderId }),
      });
    };
  }, [keySig]);

  const restWindow = useMemo(
    () => ({ fromDate: today, toDate: today, strikeCount: 24, range: "NTM", series: "SPXW" }),
    [today],
  );
  const seedContracts = useMemo(
    () =>
      rows.flatMap((row) => {
        const seeds = [];
        if (row.call?.streamKey) seeds.push({ key: row.call.streamKey, volume: row.call.volume });
        if (row.put?.streamKey) seeds.push({ key: row.put.streamKey, volume: row.put.volume });
        return seeds;
      }),
    [rows],
  );
  const { heatStore } = useAtLadderVolumeHeat({
    symbol: "$SPX",
    streamKeys,
    restWindow,
    seedContracts,
  });
  const [selection] = useState(createAtLadderSelectionStore);
  const rowByStrike = useMemo(() => new Map(rows.map((row) => [row.strike, row])), [rows]);
  const mark = chain.data?.underlyingPrice ?? spot;
  const spotStrike = useMemo(() => {
    if (mark == null || rows.length === 0) return null;
    const strikes = rows.map((row) => row.strike);
    const idx = findAtmStrikeIndex(strikes, mark);
    return idx >= 0 ? strikes[idx]! : null;
  }, [mark, rows]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const centered = useRef(false);
  useEffect(() => {
    if (centered.current || spotStrike == null) return;
    const el = scrollerRef.current;
    if (!el) return;
    const idx = rows.findIndex((row) => row.strike === spotStrike);
    if (idx < 0) return;
    el.scrollTop = Math.max(0, idx * AT_LADDER_ROW_H - el.clientHeight / 2 + AT_LADDER_ROW_H / 2);
    centered.current = true;
  }, [rows, spotStrike]);

  const status = chain.isError ? "Chain unavailable" : rows.length === 0 ? "Waiting for today's options" : "Live";

  return (
    <section className="block glance-ladder" aria-label="Active trader">
      <h2>
        <span>Active trader</span>
        <span>{status}</span>
      </h2>
      <div style={{ background: AT_HEADER_BG, borderBottom: `1px solid ${BORDER}` }}>
        <div
          className="grid items-center at-ladder-num"
          style={{
            height: AT_LADDER_GROUP_HDR_H,
            gridTemplateColumns: AT_LADDER_GRID,
            paddingLeft: AT_LADDER_GUTTER_X,
            paddingRight: AT_LADDER_GUTTER_X,
            fontSize: 13,
            color: AT_LABEL,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            background: AT_HEADER_BG,
            boxSizing: "border-box",
          }}
        >
          <span className="text-center col-span-2 font-bold" style={{ color: AT_LADDER_CALLS_HDR, fontSize: 13 }}>
            CALLS
          </span>
          <span />
          <span className="text-center col-span-2 font-bold" style={{ color: AT_LADDER_PUTS_HDR, fontSize: 13 }}>
            PUTS
          </span>
        </div>
        <div
          className="grid items-center at-ladder-num"
          style={{
            height: AT_LADDER_COL_HDR_H,
            gridTemplateColumns: AT_LADDER_GRID,
            paddingLeft: AT_LADDER_GUTTER_X,
            paddingRight: AT_LADDER_GUTTER_X,
            fontSize: 13,
            color: AT_LABEL,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            borderTop: `1px solid ${AT_LADDER_THIN_SEP}`,
            background: AT_HEADER_BG,
            boxSizing: "border-box",
          }}
        >
          <span className="text-center">BID</span>
          <span className="text-center">ASK</span>
          <span className="text-center" style={{ color: AT_LABEL, fontWeight: 600, fontSize: 13 }}>
            STRIKE
          </span>
          <span className="text-center">BID</span>
          <span className="text-center">ASK</span>
        </div>
      </div>
      <div ref={scrollerRef} className="glance-ladder-scroll" data-at-ladder-scroll>
        <LadderBody
          rows={rows}
          accentHex={GOLD}
          spotStrike={spotStrike}
          flip={flip}
          callWall={callWall}
          putWall={putWall}
          pinStrike={null}
          wallsRolling={false}
          selectedStrike={null}
          onQuoteTap={() => {}}
          positionQtyByKey={EMPTY_POSITIONS}
          heat={heatStore}
          selection={selection}
          ladderMode="single"
          verticalWidth={5}
          rowByStrike={rowByStrike}
          rowHeight={AT_LADDER_ROW_H}
          expiryLabel={today}
        />
      </div>
    </section>
  );
}
