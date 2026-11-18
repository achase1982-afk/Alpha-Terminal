/** Session-stable monotonic $ scale — grows with observed peak, never drops while scrolling. */
export class AtLadderMonotonicHeatScale {
  private peakUsd: number;

  constructor(floorUsd = 100_000) {
    this.peakUsd = Math.max(1, floorUsd);
  }

  observe(contractPremiums: Iterable<number>): void {
    for (const p of contractPremiums) {
      if (p > this.peakUsd) this.peakUsd = p;
    }
  }

  peak(): number {
    return this.peakUsd;
  }

  intensity(premiumUsd: number): number {
    if (!(premiumUsd > 0) || !(this.peakUsd > 0)) return 0;
    return Math.min(1, premiumUsd / this.peakUsd);
  }
}