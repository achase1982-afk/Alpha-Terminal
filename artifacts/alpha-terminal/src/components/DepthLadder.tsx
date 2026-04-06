import { useEffect, useRef, useMemo } from "react";
import { useDepthStore, type DepthRow } from "@/lib/depth-store";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BG = "#08080a";
const BORDER = "#1a1a2e";
const MUTED = "#6b7280";
const TEXT = "#e5e7eb";
const GOLD = "#fbbf24";
const BID_BG = "rgba(0,209,102,0.08)";
const ASK_BG = "rgba(242,54,69,0.08)";
const BID_BAR = "rgba(0,209,102,0.25)";
const ASK_BAR = "rgba(242,54,69,0.25)";
const BID_TEXT = "#00d166";
const ASK_TEXT = "#f2363d";

const STATIC_DEPTH_SYMBOLS = ["/ES", "/NQ", "/YM", "/RTY", "/CL", "/GC", "SPY", "QQQ", "IWM"];

function formatSize(s: number): string {
  if (s >= 1_000_000) return (s / 1_000_000).toFixed(1) + "M";
  if (s >= 10_000) return (s / 1_000).toFixed(1) + "K";
  if (s >= 1_000) return (s / 1_000).toFixed(1) + "K";
  return s.toString();
}

function Row({ row, side, maxSize }: { row: DepthRow; side: "bid" | "ask"; maxSize: number }) {
  const pct = maxSize > 0 ? (row.size / maxSize) * 100 : 0;
  const isBid = side === "bid";

  return (
    <div
      className="flex items-center px-2 py-[3px] font-mono text-[11px]"
      style={{
        background: isBid
          ? `linear-gradient(to right, ${BID_BAR} ${pct}%, transparent ${pct}%)`
          : `linear-gradient(to left, ${ASK_BAR} ${pct}%, transparent ${pct}%)`,
      }}
    >
      {isBid ? (
        <>
          <span className="w-[52px] text-right tabular-nums" style={{ color: MUTED }}>{row.mm || ""}</span>
          <span className="flex-1 text-right tabular-nums pr-2" style={{ color: TEXT }}>{formatSize(row.size)}</span>
          <span className="w-[72px] text-right tabular-nums font-medium" style={{ color: BID_TEXT }}>{row.price.toFixed(2)}</span>
        </>
      ) : (
        <>
          <span className="w-[72px] text-left tabular-nums font-medium" style={{ color: ASK_TEXT }}>{row.price.toFixed(2)}</span>
          <span className="flex-1 text-left tabular-nums pl-2" style={{ color: TEXT }}>{formatSize(row.size)}</span>
          <span className="w-[52px] text-left tabular-nums" style={{ color: MUTED }}>{row.mm || ""}</span>
        </>
      )}
    </div>
  );
}

interface DepthLadderProps {
  symbol?: string;
  className?: string;
}

export default function DepthLadder({ symbol: propSymbol, className }: DepthLadderProps) {
  const activeSymbol = useTerminalStore((s) => s.symbol);
  const sym = (propSymbol ?? activeSymbol).toUpperCase();
  const book = useDepthStore((s) => s.books[sym]);
  const subscribedRef = useRef<string | null>(null);

  const isStatic = STATIC_DEPTH_SYMBOLS.includes(sym);

  useEffect(() => {
    if (isStatic) return;
    if (subscribedRef.current === sym) return;

    if (subscribedRef.current) {
      fetchWithAuth("/api/ib/depth/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: subscribedRef.current }),
      }).catch(() => {});
    }

    subscribedRef.current = sym;
    fetchWithAuth("/api/ib/depth/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym }),
    }).catch(() => {});

    return () => {
      if (subscribedRef.current) {
        fetchWithAuth("/api/ib/depth/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: subscribedRef.current }),
        }).catch(() => {});
        subscribedRef.current = null;
      }
    };
  }, [sym, isStatic]);

  const bids = book?.bids ?? [];
  const asks = book?.asks ?? [];

  const maxBidSize = useMemo(() => Math.max(1, ...bids.map((r) => r.size)), [bids]);
  const maxAskSize = useMemo(() => Math.max(1, ...asks.map((r) => r.size)), [asks]);
  const maxSize = Math.max(maxBidSize, maxAskSize);

  const spread = asks.length > 0 && bids.length > 0 ? asks[0].price - bids[0].price : null;

  const isEmpty = bids.length === 0 && asks.length === 0;

  return (
    <div className={className} style={{ background: BG, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold tracking-wider" style={{ color: GOLD }}>L2 DEPTH</span>
          <span className="font-mono text-[11px] font-medium" style={{ color: TEXT }}>{sym}</span>
        </div>
        {spread !== null && (
          <span className="font-mono text-[10px]" style={{ color: MUTED }}>
            Spread: {spread.toFixed(2)}
          </span>
        )}
      </div>

      {isEmpty ? (
        <div className="flex items-center justify-center py-8">
          <span className="font-mono text-[10px]" style={{ color: MUTED }}>
            No depth data — market may be closed
          </span>
        </div>
      ) : (
        <div className="flex">
          <div className="flex-1" style={{ borderRight: `1px solid ${BORDER}` }}>
            <div className="flex items-center px-2 py-1" style={{ borderBottom: `1px solid ${BORDER}`, background: BID_BG }}>
              <span className="w-[52px] text-right font-mono text-[9px] tracking-wider" style={{ color: MUTED }}>MM</span>
              <span className="flex-1 text-right font-mono text-[9px] tracking-wider pr-2" style={{ color: MUTED }}>SIZE</span>
              <span className="w-[72px] text-right font-mono text-[9px] tracking-wider" style={{ color: BID_TEXT }}>BID</span>
            </div>
            {bids.map((row, i) => (
              <Row key={i} row={row} side="bid" maxSize={maxSize} />
            ))}
          </div>

          <div className="flex-1">
            <div className="flex items-center px-2 py-1" style={{ borderBottom: `1px solid ${BORDER}`, background: ASK_BG }}>
              <span className="w-[72px] text-left font-mono text-[9px] tracking-wider" style={{ color: ASK_TEXT }}>ASK</span>
              <span className="flex-1 text-left font-mono text-[9px] tracking-wider pl-2" style={{ color: MUTED }}>SIZE</span>
              <span className="w-[52px] text-left font-mono text-[9px] tracking-wider" style={{ color: MUTED }}>MM</span>
            </div>
            {asks.map((row, i) => (
              <Row key={i} row={row} side="ask" maxSize={maxSize} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
