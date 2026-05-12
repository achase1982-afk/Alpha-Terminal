/** Server `strategistMode` (1–5) → short uppercase label for live Strategist UI chrome. */
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
    default:
      return "STRATEGIST";
  }
}
