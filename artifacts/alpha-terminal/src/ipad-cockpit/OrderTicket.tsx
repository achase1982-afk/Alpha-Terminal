import { formatSendLabel, isCreditStrategy, ticketEconomics } from "./economics";
import { formatDollars, formatOptionPx, formatStrike } from "./format";
import type { IpadStagedLeg, IpadStrategy } from "./types";

const PILLS: readonly { id: IpadStrategy; label: string }[] = [
  { id: "call_credit", label: "Call Credit" },
  { id: "put_credit", label: "Put Credit" },
  { id: "debit", label: "Debit" },
  { id: "single", label: "Single" },
];

export function OrderTicket({
  expiryLeg,
  strategy,
  legs,
  qty,
  limit,
  oco,
  onStrategy,
  onQty,
  onLimit,
  onSnap,
  onOco,
  onSend,
  onClear,
}: {
  expiryLeg: string;
  strategy: IpadStrategy;
  legs: readonly IpadStagedLeg[];
  qty: number;
  limit: number;
  oco: boolean;
  onStrategy: (strategy: IpadStrategy) => void;
  onQty: (dir: -1 | 1) => void;
  onLimit: (dir: -1 | 1) => void;
  onSnap: (kind: "mid" | "nat") => void;
  onOco: () => void;
  onSend: () => void;
  onClear: () => void;
}) {
  const econ = ticketEconomics(strategy, legs, limit, qty);
  const credit = isCreditStrategy(strategy, legs);
  const ordered = [...legs].sort((a, b) => {
    if (a.side === b.side) return b.strike - a.strike;
    if (credit) return a.side === "SELL" ? -1 : 1;
    return a.side === "BUY" ? -1 : 1;
  });
  const sendLabel = legs.length === 0 ? "SEND ORDER" : formatSendLabel(strategy, qty, limit, credit);

  return (
    <section id="modTicket" className="mod" aria-label="Order ticket">
      <div className="ticket-h">
        <span className="ticket-title">ORDER TICKET</span>
        <div className="strats" role="group" aria-label="Strategy">
          {PILLS.map((pill) => (
            <button
              key={pill.id}
              type="button"
              className="strat"
              aria-pressed={strategy === pill.id}
              onClick={() => onStrategy(pill.id)}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      <div className="legs">
        {ordered.length === 0 ? (
          <div className="legs-empty">TAP BID = SELL · ASK = BUY</div>
        ) : (
          ordered.map((leg) => (
            <div key={leg.id} className="leg">
              <span className={`side ${leg.side === "SELL" ? "sell" : "buy"}`}>
                {leg.side} {qty}
              </span>
              <span className="leg-name num">
                SPX {expiryLeg} {formatStrike(leg.strike)} {leg.right}
              </span>
              <span className="leg-px num">{formatOptionPx(leg.price)}</span>
            </div>
          ))
        )}
      </div>

      <div className="step-grid">
        <div>
          <div className="field-label">QUANTITY</div>
          <div className="stepper qty">
            <button type="button" aria-label="Decrease quantity" onClick={() => onQty(-1)}>
              −
            </button>
            <div className="val num">{qty}</div>
            <button type="button" aria-label="Increase quantity" onClick={() => onQty(1)}>
              +
            </button>
          </div>
        </div>
        <div>
          <div className="field-label">
            <span>{credit ? "LIMIT CREDIT" : "LIMIT DEBIT"}</span>
            <span className="snaps">
              <button type="button" className="snap" onClick={() => onSnap("mid")}>
                MID
              </button>
              <button type="button" className="snap" onClick={() => onSnap("nat")}>
                NAT
              </button>
            </span>
          </div>
          <div className="stepper limit">
            <button type="button" aria-label="Decrease limit" onClick={() => onLimit(-1)}>
              −
            </button>
            <div className="val num">{formatOptionPx(limit)}</div>
            <button type="button" aria-label="Increase limit" onClick={() => onLimit(1)}>
              +
            </button>
          </div>
        </div>
      </div>

      <div className="oco" data-on={oco ? "true" : "false"}>
        <div className="oco-h">
          <span>1ST TRIGGERS OCO BRACKET</span>
          <button type="button" className="oco-toggle" aria-pressed={oco} onClick={onOco}>
            {oco ? "ON" : "OFF"}
          </button>
        </div>
        <div className="oco-metrics num">
          <div>
            <span>TP +50%</span>
            <b style={{ color: "var(--bull-green)" }}>{formatOptionPx(econ.tp)}</b>
          </div>
          <div>
            <span>SL 2x</span>
            <b style={{ color: "var(--bear-red)" }}>{formatOptionPx(econ.sl)}</b>
          </div>
          <div>
            <span>{credit ? "CREDIT" : "DEBIT"}</span>
            <b style={{ color: "#fff" }}>{formatDollars(econ.cash)}</b>
          </div>
          <div>
            <span>MAX RISK</span>
            <b style={{ color: "var(--brand-gold)" }}>{formatDollars(econ.maxRisk)}</b>
          </div>
        </div>
      </div>

      <div className="ticket-actions">
        <button type="button" className="send-btn" disabled={legs.length === 0} onClick={onSend}>
          {sendLabel}
        </button>
        <button type="button" className="clr-btn" onClick={onClear}>
          CLR
        </button>
      </div>
    </section>
  );
}
