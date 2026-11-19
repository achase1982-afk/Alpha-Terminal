import { useEffect, useState } from "react";
import { JournalScreen } from "@/components/journal/JournalScreen";
import type { InsightsPayload, JournalPeriod, JournalView } from "@/components/journal/journalModel";
import fixture from "./journalFixture.json";

const book = fixture as { insights: InsightsPayload; empty: InsightsPayload };

function useQueryView(): "insights" | "drill" | "trades" | "empty" {
  const value = new URLSearchParams(window.location.search).get("view");
  if (value === "drill" || value === "trades" || value === "empty") return value;
  return "insights";
}

export default function JournalFixtureDevPage() {
  const initial = useQueryView();
  const [period, setPeriod] = useState<JournalPeriod>("ytd");
  const [view, setView] = useState<JournalView>(initial === "trades" ? "trades" : "insights");
  const [strategy, setStrategy] = useState<string | null>(initial === "drill" ? "Credit spreads (puts)" : null);
  const payload = initial === "empty" ? book.empty : book.insights;
  useEffect(() => {
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.margin = "0";
    document.body.style.background = "#0c0c0c";
  }, []);

  return (
    <div data-fixture-view={initial} style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", background: "#0c0c0c", color: "#e4e4e7", fontFamily: `'Inter','SF Pro Text',-apple-system,sans-serif` }}>
      <div style={{ flex: "1 1 auto", overflow: "auto", minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div aria-hidden style={{ fontSize: 16, letterSpacing: -1 }}>≡</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1.2, lineHeight: 1 }}>ALPHA</div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, color: "#FFB800", lineHeight: 1.1 }}>TERMINAL</div>
          </div>
        </div>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: "#d4d4d8" }}>
          MARKET CLOSED <span style={{ color: "#dc2626" }}>●</span>
        </div>
      </header>
      <div style={{ display: "flex", gap: 14, padding: "6px 14px 2px", fontSize: 12, color: "#a1a1aa" }}>
        {["SPX", "NDX", "VIX", "TSLA", "NVDA"].map((symbol) => (
          <span key={symbol}>{symbol}</span>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "8px 14px 6px", gap: 8 }}>
        <Figure label="Net liq value" value="$86,420.00" />
        <Figure label="Available $" value="$41,200.00" />
        <Figure label="Buying power" value="$62,150.00" />
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #27272a", borderBottom: "1px solid #27272a" }}>
        {["Positions", "Orders", "Balances", "Journal"].map((tab) => (
          <div key={tab} style={{ flex: 1, textAlign: "center", padding: "8px 0 6px", fontSize: 12, letterSpacing: 0.6, color: tab === "Journal" ? "#FFB800" : "#71717a", borderBottom: tab === "Journal" ? "2px solid #FFB800" : "2px solid transparent" }}>
            {tab.toUpperCase()}
          </div>
        ))}
      </div>
      <JournalScreen
        payload={payload}
        loading={false}
        error={null}
        period={period}
        onPeriod={setPeriod}
        view={view}
        onView={setView}
        strategy={strategy}
        onStrategy={setStrategy}
        exampleBanner
      />
      </div>
      <nav data-bottom-nav style={{ flex: "0 0 auto", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "8px 8px 14px", background: "#0c0c0c", borderTop: "1px solid #27272a", fontSize: 9, letterSpacing: 0.4 }}>
        <NavItem label="PORTFOLIO" active />
        <NavItem label="MARKETS" />
        <span aria-hidden style={{ width: 42, height: 42, borderRadius: 21, background: "#FFB800", color: "#111", display: "grid", placeItems: "center" }}>
          <svg width="16" height="16" viewBox="0 0 16 16">
            <rect x="1" y="8" width="3" height="6" rx="0.5" fill="#111" />
            <rect x="6.5" y="4" width="3" height="10" rx="0.5" fill="#111" />
            <rect x="12" y="1" width="3" height="13" rx="0.5" fill="#111" />
          </svg>
        </span>
        <NavItem label="SEARCH" />
        <NavItem label="WATCHLIST" />
      </nav>
    </div>
  );
}

function Figure(props: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: "uppercase", color: "#71717a" }}>{props.label}</div>
      <div style={{ fontSize: props.label.startsWith("Net") ? 18 : 14, fontWeight: 720, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

function NavItem(props: { label: string; active?: boolean }) {
  return <div style={{ color: props.active ? "#FFB800" : "#71717a", textAlign: "center" }}>{props.label}</div>;
}
