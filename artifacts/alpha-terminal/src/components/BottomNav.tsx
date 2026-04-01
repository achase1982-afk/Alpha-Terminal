import { Radar, TrendingUp, Zap, Briefcase, Star } from "lucide-react";

export type BottomNavRoute = "scanner" | "markets" | "ai" | "portfolio" | "watchlist";

interface BottomNavProps {
  activeRoute: string | null;
  activeMainTab: string;
  onNavigate: (route: BottomNavRoute) => void;
}

const NAV_ITEMS: { route: BottomNavRoute; label: string; icon: typeof Radar }[] = [
  { route: "scanner", label: "SCAN", icon: Radar },
  { route: "markets", label: "MARKETS", icon: TrendingUp },
  { route: "ai", label: "AI", icon: Zap },
  { route: "portfolio", label: "PORT", icon: Briefcase },
  { route: "watchlist", label: "WATCH", icon: Star },
];

export function BottomNav({ activeRoute, activeMainTab, onNavigate }: BottomNavProps) {
  const isActive = (route: BottomNavRoute) => {
    if (route === "scanner") return !activeRoute && activeMainTab === "scanner";
    return activeRoute === route;
  };

  return (
    <nav className="bottom-nav bg-[#0c0c0c] border-t border-card-border flex items-end justify-around">
      {NAV_ITEMS.map(({ route, label, icon: Icon }) => {
        const active = isActive(route);
        const isCenter = route === "ai";

        if (isCenter) {
          return (
            <button
              key={route}
              onClick={() => onNavigate(route)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 active:opacity-70 transition-opacity"
            >
              <div
                className="-mt-3 w-12 h-12 rounded-full flex items-center justify-center border transition-all"
                style={{
                  background: "rgba(255, 184, 0, 0.1)",
                  borderColor: "rgba(255, 184, 0, 0.3)",
                  boxShadow: active ? "0 0 12px rgba(255, 184, 0, 0.3)" : undefined,
                }}
              >
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <span className="font-mono text-[9px] uppercase tracking-wider text-primary">{label}</span>
            </button>
          );
        }

        return (
          <button
            key={route}
            onClick={() => onNavigate(route)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 active:opacity-70 transition-opacity"
          >
            <Icon className={`w-5 h-5 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`} />
            <span className={`font-mono text-[9px] uppercase tracking-wider transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
