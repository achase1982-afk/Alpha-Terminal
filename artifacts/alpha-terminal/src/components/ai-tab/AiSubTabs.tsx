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
    <div
      className="sticky z-30 px-3 sm:px-4 lg:px-5 py-2 bg-background flex justify-center"
      style={{ top: 130 }}
    >
      <div
        className="flex rounded-full p-1"
        style={{ background: "rgba(39,39,42,0.5)", maxWidth: "400px" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className="flex-1 font-mono text-[10px] font-bold tracking-wider py-1.5 px-2 rounded-full transition-all duration-200"
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
