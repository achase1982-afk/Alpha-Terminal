import React from "react";
import { Newspaper, BarChart2, Brain, Target, LineChart } from "lucide-react";

export type MarketDataTab = "news" | "options" | "ai" | "scan" | "chart";

const tabs: { id: MarketDataTab; label: string; icon: React.ReactNode }[] = [
  { id: "news", label: "NEWS", icon: <Newspaper className="w-4 h-4" /> },
  { id: "options", label: "OPTIONS", icon: <BarChart2 className="w-4 h-4" /> },
  { id: "ai", label: "AI", icon: <Brain className="w-4 h-4" /> },
  { id: "scan", label: "SCAN", icon: <Target className="w-4 h-4" /> },
  { id: "chart", label: "CHART", icon: <LineChart className="w-4 h-4" /> },
];

interface MarketDataTabsProps {
  activeTab: MarketDataTab;
  setActiveTab: (tab: MarketDataTab) => void;
}

export function MarketDataTabs({ activeTab, setActiveTab }: MarketDataTabsProps) {
  return (
    <nav
      className="sticky z-30 w-full bg-[#0c0c0c] border-b border-card-border/50 p-0 m-0"
      style={{ top: "118px" }}
    >
      <div className="flex w-full items-stretch border-t border-card-border/30">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-2 py-2 transition-all duration-200 border-b-2 ${
              activeTab === tab.id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-white"
            }`}
          >
            <span className={activeTab === tab.id ? "text-primary" : "text-muted-foreground"}>
              {tab.icon}
            </span>
            <span className="text-[10px] font-black tracking-tighter uppercase sm:tracking-widest">
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
