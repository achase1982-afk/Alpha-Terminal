import { MONO, WHITE } from "@/components/options/optionsTheme";

type SpotRecenterPillProps = {
  visible: boolean;
  onClick: () => void;
  /** Defaults to `data-spot-recenter`; pass `data-at-ladder-recenter` for legacy AT tests. */
  dataAttribute?: string;
  label?: string;
};

/**
 * Mid-right floating control — recenters a vertical strip (ladder or chain) on spot / ATM.
 */
export function SpotRecenterPill({
  visible,
  onClick,
  dataAttribute = "data-spot-recenter",
  label = "Recenter",
}: SpotRecenterPillProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      {...{ [dataAttribute]: true }}
      onClick={onClick}
      aria-label={label}
      style={{
        position: "absolute",
        top: "50%",
        right: 10,
        transform: "translateY(-50%)",
        zIndex: 45,
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 650,
        padding: "7px 12px",
        borderRadius: 999,
        border: `1px solid rgba(255,255,255,0.22)`,
        background: "rgba(28, 28, 30, 0.88)",
        color: WHITE,
        boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {label}
    </button>
  );
}