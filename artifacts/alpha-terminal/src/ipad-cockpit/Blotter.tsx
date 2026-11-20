import { formatOptionPx, formatPnl, toneForSigned } from "./format";
import type { IpadBlotterTab, IpadFill, IpadPosition, IpadWorkingOrder } from "./types";

export function Blotter({
  tab,
  onTab,
  dayPnl,
  positions,
  working,
  fills,
  onClose,
  onCancel,
}: {
  tab: IpadBlotterTab;
  onTab: (tab: IpadBlotterTab) => void;
  dayPnl: number;
  positions: readonly IpadPosition[];
  working: readonly IpadWorkingOrder[];
  fills: readonly IpadFill[];
  onClose: (position: IpadPosition) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <section id="modBlotter" className="mod" aria-label="Positions and orders">
      <div className="blotter-h">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "positions"} onClick={() => onTab("positions")}>
            Positions ({positions.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === "working"} onClick={() => onTab("working")}>
            Working ({working.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === "fills"} onClick={() => onTab("fills")}>
            Fills ({fills.length})
          </button>
        </div>
        <div className="day-pnl num">
          <span className="lbl">DAY P&L</span>
          <span className="px" style={{ color: toneForSigned(dayPnl) }}>
            {formatPnl(dayPnl)}
          </span>
        </div>
      </div>
      <div id="blotterList" role="tabpanel">
        {tab === "positions"
          ? positions.length === 0
            ? <div className="empty-row">No open positions</div>
            : positions.map((position) => (
                <div key={position.id} className="blot-row">
                  <div className="blot-main">
                    <div className="blot-title">{position.title}</div>
                    <div className="blot-sub num">
                      In {formatOptionPx(position.entry)} · Mk {formatOptionPx(position.mark)}
                    </div>
                  </div>
                  <div className="blot-right">
                    <span className="blot-pnl num" style={{ color: toneForSigned(position.pnl) }}>
                      {formatPnl(position.pnl)}
                    </span>
                    <button type="button" className="close-btn" onClick={() => onClose(position)}>
                      CLOSE
                    </button>
                  </div>
                </div>
              ))
          : null}
        {tab === "working"
          ? working.length === 0
            ? <div className="empty-row">No working orders</div>
            : working.map((order) => (
                <div key={order.id} className="blot-row">
                  <div className="blot-main">
                    <div className="blot-title">
                      <span className="work-badge">{order.status}</span>
                      <span className="num">{order.summary}</span>
                    </div>
                  </div>
                  <button type="button" className="cancel-btn" onClick={() => onCancel(order.id)}>
                    CANCEL
                  </button>
                </div>
              ))
          : null}
        {tab === "fills"
          ? fills.length === 0
            ? <div className="empty-row">No fills</div>
            : fills.map((fill) => (
                <div key={fill.id} className="blot-row">
                  <div className="blot-main">
                    <div className="blot-title num">{fill.description}</div>
                    <div className="blot-sub num">
                      {fill.time} · {formatOptionPx(fill.price)}
                    </div>
                  </div>
                  <span className="blot-pnl num" style={{ color: toneForSigned(fill.pnl) }}>
                    {formatPnl(fill.pnl)}
                  </span>
                </div>
              ))
          : null}
      </div>
    </section>
  );
}
