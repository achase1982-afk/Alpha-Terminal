export type AiSubTab = "pulse" | "strategist" | "technicals";

interface AiSubTabsProps {
  active: AiSubTab;
  onChange: (tab: AiSubTab) => void;
}

const TABS: { value: AiSubTab; label: string }[] = [
  { value: "pulse", label: "PULSE" },
  { value: "strategist", label: "STRATEGIST" },
  { value: "technicals", label: "TECHNICALS" },
];

export function AiSubTabs({ active, onChange }: AiSubTabsProps) {
  return (
    <div className="px-3 sm:px-4 lg:px-5 pb-3">
      <div
        className="flex rounded-full p-1"
        style={{ background: "rgba(39,39,42,0.5)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className="flex-1 font-mono text-[10px] sm:text-xs font-bold tracking-wider py-2 rounded-full transition-all duration-200"
            style={{
              background: active === tab.value ? "#3f3f46" : "transparent",
              color: active === tab.value ? "#fafafa" : "#71717a",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
