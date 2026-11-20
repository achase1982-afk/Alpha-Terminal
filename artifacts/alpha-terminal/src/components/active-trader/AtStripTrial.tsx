import { useRef, useState, type PointerEvent } from "react";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { resolveGammaFlipDisplay } from "@/lib/active-trader/atGlanceWallDisplay";
import "./AtStripTrial.css";

const layouts = ["Paged", "No tap", "Grok"] as const;
const pages = ["Now", "Session", "Levels"] as const;
const preference = "alpha.activeTrader.stripTrial";
const money = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
});
const strike = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

type Props = {
  windowSeconds: number;
  gross: readonly [number, number, number, number] | null;
  zones: ZoneModel;
};

function initialLayout() {
  try {
    const value = window.localStorage.getItem(preference);
    const index = layouts.findIndex((layout) => layout === value);
    return index < 0 ? 0 : index + 1;
  } catch {
    return 0;
  }
}

export function useAtStripTrial() {
  const [layout, setLayout] = useState(initialLayout);
  function select(value: number) {
    setLayout(value);
    try {
      window.localStorage.setItem(preference, layouts[value - 1] ?? "");
    } catch {
      // The trial still works when local storage is disabled.
    }
  }
  return { layout, select };
}

function useStripSwipe(onSwipe: (direction: number) => void) {
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest("button, select")) return;
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId) return;
      pointer.current = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) >= 44 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        onSwipe(dx < 0 ? 1 : -1);
      }
    },
    onPointerCancel() { pointer.current = null; },
  };
}

export function AtStripTrialSelector({
  layout, select,
}: ReturnType<typeof useAtStripTrial>) {
  const count = layouts.length + 1;
  const swipe = useStripSwipe((direction) => select((layout + direction + count) % count));
  return (
    <div className="at-strip-trial-selector" {...swipe}>
      <span aria-hidden="true" style={{ pointerEvents: "none" }}>Strip · swipe</span>
      <select aria-label="Active Trader strip design" value={layout}
        onChange={(event) => select(Number(event.currentTarget.value))}>
        <option value={0}>Original</option>
        {layouts.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </select>
    </div>
  );
}

export function AtStripTrial({ layout, windowSeconds, gross, zones }: Props & { layout: number }) {
  const [pageByLayout, setPageByLayout] = useState<Record<number, typeof pages[number]>>({});
  const page = pageByLayout[layout] ?? "Now";
  const together = layout === 2;
  const grok = layout === 3;
  function selectPage(next: typeof pages[number]) {
    setPageByLayout((current) => ({ ...current, [layout]: next }));
  }
  const swipe = useStripSwipe((direction) => {
    const next = pages[pages.indexOf(page) + direction];
    if (next) selectPage(next);
  });
  const level = (value: number | null) => value == null ? "—" : strike.format(value);
  return (
    <div className="at-strip-trial" data-strip-layout={layouts[layout - 1]}>
      {together ? (
        <div className="at-strip-trial-tabs">
          <strong>Flow · {windowSeconds}s</strong><strong>Model levels</strong>
        </div>
      ) : (
        <div className="at-strip-trial-tabs" role="group" aria-label="Strip page">
          {pages.map((item) => (
            <button key={item} type="button" aria-pressed={page === item}
              onClick={() => selectPage(item)}>
              {item}
            </button>
          ))}
        </div>
      )}
      <div className={together ? "at-strip-trial-body at-strip-trial-split" : "at-strip-trial-body"}
        {...(grok ? swipe : {})}>
        {(together || page !== "Levels") && (
          <div>
            {(["Calls", "Puts"] as const).map((side, index) => {
              const buy = gross?.[index * 2];
              const sell = gross?.[index * 2 + 1];
              const split = buy != null && sell != null && buy + sell > 0 ? buy / (buy + sell) : null;
              return (
                <div className="at-strip-trial-flow" key={side}>
                  <b>{side}</b>
                  <span className="at-strip-buy">{page !== "Session" && buy != null ? money.format(buy) : "—"}</span>
                  {!together && page !== "Session" && (
                    <span aria-hidden="true" className="at-strip-trial-bar">
                      {split != null && <i style={{ width: (split * 100) + "%" }} />}
                    </span>
                  )}
                  <span className="at-strip-sell">{page !== "Session" && sell != null ? money.format(sell) : "—"}</span>
                </div>
              );
            })}
            {together && <small>Since open —</small>}
          </div>
        )}
        {(together || page === "Levels") && (
          <div className="at-strip-trial-levels">
            <span>Call wall <b>{level(zones.callWall)}</b></span>
            <span>Put wall <b>{level(zones.putWall)}</b></span>
            <span>Gamma flip <b>{resolveGammaFlipDisplay(zones)}</b></span>
          </div>
        )}
      </div>
      <small className="at-strip-trial-source">
        {together || page === "Now"
          ? `Bought / sold · ${windowSeconds}s symbol-wide L1 estimate`
          : page === "Session" ? "Opening-to-now premium and history unavailable"
          : "Current model · OI/volume split and opening levels unavailable"}
      </small>
    </div>
  );
}
