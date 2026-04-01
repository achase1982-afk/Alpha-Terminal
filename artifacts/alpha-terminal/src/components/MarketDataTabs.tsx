import React from "react";
import { Newspaper, BarChart2, Building2, LineChart } from "lucide-react";

export type MarketDataTab = "news" | "options" | "company" | "chart";

const tabs: { id: MarketDataTab; label: string; icon: React.ReactNode }[] = [
  { id: "news", label: "NEWS", icon: <Newspaper className="w-4 h-4" /> },
  { id: "options", label: "OPTIONS", icon: <BarChart2 className="w-4 h-4" /> },
  { id: "company", label: "COMPANY", icon: <Building2 className="w-4 h-4" /> },
  { id: "chart", label: "CHART", icon: <LineChart className="w-4 h-4" /> },
];

interface MarketDataTabsProps {
  activeTab: MarketDataTab;
  setActiveTab: (tab: MarketDataTab) => void;
}

export function MarketDataTabs({ activeTab, setActiveTab }: MarketDataTabsProps) {
  return (
    <nav
      className="sticky z-30 w-full bg-[#1a1a1a] border-b border-card-border/50 p-0 m-0"
      style={{ top: "80px" }}
    >
      <div className="flex w-full items-stretch p-0 border-t border-card-border/20">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 transition-all border-b-2 ${
              activeTab === tab.id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-white/80"
            }`}
          >
            {tab.icon}
            <span className="text-[10px] font-black tracking-widest uppercase">
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
