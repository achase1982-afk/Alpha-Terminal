import { FullPageView } from "@/components/FullPageView";
import { Briefcase } from "lucide-react";

interface PortfolioPageProps {
  onClose: () => void;
}

export function PortfolioPage({ onClose }: PortfolioPageProps) {
  return (
    <FullPageView title="PORTFOLIO" onClose={onClose}>
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
          <Briefcase className="w-7 h-7 text-primary/50" />
        </div>
        <h3 className="font-mono text-sm font-bold text-foreground mb-2">Portfolio View</h3>
        <p className="font-mono text-[11px] text-muted-foreground leading-relaxed max-w-[280px]">
          Positions, P&L tracking, Greeks exposure, and risk analytics coming soon.
        </p>
      </div>
    </FullPageView>
  );
}
