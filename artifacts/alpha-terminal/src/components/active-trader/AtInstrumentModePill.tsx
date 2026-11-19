import type { AtInstrumentTemplate } from "@/lib/active-trader/atInstrumentMode";

const VISIBLE_H = 20;

export function AtInstrumentModePill({
  template,
  onToggle,
}: {
  template: AtInstrumentTemplate;
  onToggle: () => void;
}) {
  const current = template === "stock" ? "Stock" : "Options";
  const destination = template === "stock" ? "Options" : "Stock";
  return (
    <button
      type="button"
      data-at-instrument-template={template}
      aria-label={`${current}, switch to ${destination}`}
      onClick={onToggle}
      className="inline-flex items-center justify-center"
      style={{
        minWidth: 44,
        minHeight: 44,
        marginTop: -12,
        marginBottom: -12,
        padding: 0,
        background: "transparent",
        border: "none",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{
          height: VISIBLE_H,
          maxWidth: 92,
          padding: "0 8px",
          gap: 4,
          borderRadius: 999,
          background: "#2a2e32",
          border: "1px solid rgba(255,255,255,0.18)",
          color: "#d5d8dc",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {current}
        <span style={{ fontSize: 13, lineHeight: 1 }}>⇄</span>
      </span>
    </button>
  );
}
