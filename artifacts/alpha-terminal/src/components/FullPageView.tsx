import { ArrowLeft } from "lucide-react";

interface FullPageViewProps {
  title: string;
  onClose: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}

export function FullPageView({ title, onClose, headerRight, children }: FullPageViewProps) {
  return (
    <div className="fixed inset-0 z-40 bg-background flex flex-col" style={{ paddingBottom: "calc(56px + env(safe-area-inset-bottom, 0px) + 8px)" }}>
      <header className="shrink-0 flex items-center h-12 px-4 border-b border-card-border bg-card">
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="font-mono text-sm font-bold tracking-wider text-foreground ml-3">{title}</h2>
        {headerRight && <div className="ml-auto">{headerRight}</div>}
      </header>
      <div className="flex-1 overflow-y-auto -webkit-overflow-scrolling-touch">
        {children}
      </div>
    </div>
  );
}
