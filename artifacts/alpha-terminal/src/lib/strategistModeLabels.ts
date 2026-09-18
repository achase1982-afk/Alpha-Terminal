/** Server `strategistMode` (1–6) → short uppercase label for live Strategist UI chrome. */
export function strategistTuningModeHeaderLabel(mode: number): string {
  switch (mode) {
    case 1:
      return "SOLO MODE";
    case 2:
      return "DEBATE MODE";
    case 3:
      return "DESK MODE";
    case 4:
      return "SOLO DESK MODE";
    case 5:
      return "CONVICTION DESK MODE";
    case 6:
      return "CONSENSUS MODE";
    default:
      return "STRATEGIST";
  }
}
