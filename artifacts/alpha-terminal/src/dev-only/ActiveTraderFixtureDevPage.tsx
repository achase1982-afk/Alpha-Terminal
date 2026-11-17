import { useEffect, useMemo, useState } from "react";
import { ActiveTraderView } from "@/components/active-trader/ActiveTraderView";
import { OptionsSubViewToggle, type OptionsSubView } from "@/components/active-trader/OptionsSubViewToggle";
import { BG, GOLD, BG_EXP_BAR, BORDER, DIM, MONO, ROW_H, GOLD_DIM } from "@/components/options/optionsTheme";
import { ACCENT_COLORS } from "@/lib/ui-customization-store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { OrderTicket } from "@/components/OrderTicket";
import {
  FIXTURE_CLASSIFIED_PCT,
  FIXTURE_HEADLINE,
  FIXTURE_MARKER,
  FIXTURE_REGIME,
  FIXTURE_SPX_SPOT,
  FIXTURE_ZONE_MODEL,
  buildSpxFixtureGroups,
  buildSpxFixtureTicks,
  seedSpxFixtureFlow,
} from "./active-trader/spxFixture";
import type { OptionsContract } from "@/components/OptionsTab";

const accentHex = ACCENT_COLORS.gold;

function useCaptureScene(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("scene");
}

export default function ActiveTraderFixtureDevPage() {
  const scene = useCaptureScene();
  const [subView, setSubView] = useState<OptionsSubView>(scene === "chain" ? "chain" : "at");
  const [ticketOpen, setTicketOpen] = useState(scene === "confirm");
  const groups = useMemo(() => buildSpxFixtureGroups(), []);
  const presentation = useMemo(
    () => ({
      regimeLabel: FIXTURE_REGIME.label,
      regimeDegraded: FIXTURE_REGIME.degraded,
      zones: FIXTURE_ZONE_MODEL,
      classifiedPct: FIXTURE_CLASSIFIED_PCT,
      headline: FIXTURE_HEADLINE,
      skipNetwork: true as const,
    }),
    [],
  );

  useEffect(() => {
    document.title = `AT Fixture ${FIXTURE_MARKER}`;
    const mergeTick = useOptionsStreamStore.getState().mergeTick;
    for (const t of buildSpxFixtureTicks()) mergeTick(t);
    seedSpxFixtureFlow();
  }, []);

  useEffect(() => {
    if (scene !== "strip") return;
    const t = window.setTimeout(() => {
      const btn = document.querySelector('[data-at-call-strike="7545"]') as HTMLButtonElement | null;
      btn?.click();
    }, 300);
    return () => clearTimeout(t);
  }, [scene]);

  const call7545 = groups[0].rows.find((r) => r.strike === 7545)?.call;

  const onOpenReview = (_contract: OptionsContract, _side: "BUY" | "SELL", _type: "CALL" | "PUT") => {
    setTicketOpen(true);
  };

  return (
    <div className="min-h-screen" style={{ background: BG, color: "#f0f0f0" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 text-[10px] tracking-widest">
        <span>ALPHA TERMINAL</span>
        <span className="text-green-500">MARKET OPEN</span>
      </div>
      <div className="flex border-b border-zinc-800 text-[10px] tracking-widest font-medium">
        {["NEWS", "OPTIONS", "COMPANY"].map((t) => (
          <span
            key={t}
            className="flex-1 text-center py-2.5"
            style={t === "OPTIONS" ? { borderBottom: `2px solid ${GOLD}`, color: "#fff" } : { color: "#71717a" }}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="px-3 py-2 border-b border-zinc-800 font-mono">
        <div className="text-lg">SPX 7,540.00</div>
        <div className="text-[10px] text-zinc-500">Nov 17 · 0DTE PM</div>
      </div>

      <div style={{ width: 440, margin: "0 auto", maxWidth: "100%" }}>
        <OptionsSubViewToggle view={subView} onChange={setSubView} accentHex={accentHex} />
        {subView === "at" ? (
          <ActiveTraderView
            symbol="SPX"
            groups={groups}
            underlyingPrice={FIXTURE_SPX_SPOT}
            stickyOffset={0}
            accentHex={accentHex}
            holdSubs={{}}
            onAddLeg={() => undefined}
            onOpenReview={onOpenReview}
            presentation={presentation}
            initialTradeSelection={
              scene === "strip" || scene === "confirm" ? { strike: 7545, type: "CALL" as const } : undefined
            }
          />
        ) : (
          <FixtureChainPreview accentHex={accentHex} groups={groups} />
        )}
      </div>

      <OrderTicket
        isOpen={ticketOpen}
        onClose={() => setTicketOpen(false)}
        initialSide="BUY"
        optionSymbol={call7545?.schwabSymbol}
        optionInstruction="BUY_TO_OPEN"
        initialStage="review"
        confirmDisabled
      />
      <p className="text-center py-2 font-mono" style={{ fontSize: 9, color: DIM }}>
        {FIXTURE_MARKER}
      </p>
    </div>
  );
}

function FixtureChainPreview({
  accentHex,
  groups,
}: {
  accentHex: string;
  groups: ReturnType<typeof buildSpxFixtureGroups>;
}) {
  const rows = groups[0].rows.filter((r) => r.strike >= 7520 && r.strike <= 7560).reverse();
  return (
    <div style={{ background: BG, fontFamily: MONO }}>
      <div
        className="flex items-center justify-between px-3"
        style={{ height: 32, background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}` }}
      >
        <span style={{ fontSize: 14, color: DIM }}>Strike 10</span>
      </div>
      <div
        className="grid text-center py-1"
        style={{ gridTemplateColumns: "1fr 44px 1fr", fontSize: 10, color: DIM, background: "#060606" }}
      >
        <span>CALLS</span>
        <span>STRIKE</span>
        <span>PUTS</span>
      </div>
      {rows.map((row) => (
        <div
          key={row.strike}
          className="grid items-center"
          style={{ gridTemplateColumns: "1fr 44px 1fr", height: ROW_H, borderBottom: `1px solid #0c0c0c` }}
        >
          <span className="text-center text-[12px]">{row.call?.volume ?? "\u2014"}</span>
          <span
            className="text-center text-[12px] font-semibold"
            style={{ background: accentHex, color: "black" }}
          >
            {row.strike}
          </span>
          <span className="text-center text-[12px]">{row.put?.volume ?? "\u2014"}</span>
        </div>
      ))}
      <p className="text-center py-4 text-[10px]" style={{ color: GOLD_DIM }}>
        Chain view (fixture — calls left / puts right)
      </p>
    </div>
  );
}