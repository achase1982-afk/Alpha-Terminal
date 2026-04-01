import { FullPageView } from "@/components/FullPageView";
import { TrendingUp, BarChart2, Activity } from "lucide-react";

interface MarketsPageProps {
  onClose: () => void;
}

export function MarketsPage({ onClose }: MarketsPageProps) {
  const indices = [
    { name: "S&P 500", symbol: "SPX", icon: TrendingUp },
    { name: "Nasdaq 100", symbol: "NDX", icon: BarChart2 },
    { name: "Dow Jones", symbol: "DJI", icon: Activity },
    { name: "Russell 2000", symbol: "RUT", icon: TrendingUp },
  ];

  return (
    <FullPageView title="MARKETS" onClose={onClose}>
      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest font-bold">Major Indices</span>
          <div className="grid grid-cols-2 gap-2">
            {indices.map(idx => (
              <div key={idx.symbol} className="p-4 rounded-xl bg-card border border-card-border">
                <div className="flex items-center gap-2 mb-2">
                  <idx.icon className="w-4 h-4 text-primary" />
                  <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">{idx.symbol}</span>
                </div>
                <span className="font-mono text-sm font-bold text-foreground">{idx.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 rounded-xl bg-card border border-card-border flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
            <TrendingUp className="w-5 h-5 text-primary/50" />
          </div>
          <p className="font-mono text-xs text-muted-foreground text-center">Sector performance, breadth data, and heat maps coming soon.</p>
        </div>
      </div>
    </FullPageView>
  );
}
