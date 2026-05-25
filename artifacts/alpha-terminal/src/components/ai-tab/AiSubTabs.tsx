export type AiSubTab = "pulse" | "movers" | "catalysts" | "strategist";

interface AiSubTabsProps {
  active: AiSubTab;
  onChange: (tab: AiSubTab) => void;
}

const TABS: { value: AiSubTab; label: string }[] = [
  { value: "pulse", label: "PULSE" },
  { value: "movers", label: "MOVERS" },
  { value: "catalysts", label: "CATALYSTS" },
  { value: "strategist", label: "STRATEGIST" },
];

export function AiSubTabs({ active, onChange }: AiSubTabsProps) {
  return (
    <div
      className="sticky z-40 w-full px-3 sm:px-4 lg:px-5 py-2 bg-background"
      style={{ top: 0 }}
    >
      <div
        className="flex w-full max-w-full overflow-x-auto rounded-full p-1 gap-0.5"
        style={{ background: "rgba(39,39,42,0.5)", scrollbarWidth: "thin" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className="shrink-0 flex-1 min-w-[5.5rem] font-mono font-bold tracking-wider py-2 rounded-full transition-all duration-200"
            style={{
              fontSize: 12,
              background: active === tab.value ? "#3f3f46" : "transparent",
              color: "#F5F5F5",
              fontWeight: active === tab.value ? 700 : 500,
              border:
                active === tab.value
                  ? "1px solid #3A3A3A"
                  : "1px solid transparent",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
