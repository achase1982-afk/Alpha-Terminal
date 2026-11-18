/** True when glance paint intrudes below the next chrome row (positive overlap px). */
export function glanceStackOverlapsNext(glanceBottom: number, nextTop: number, epsilonPx = 0.5): boolean {
  return glanceBottom - nextTop > epsilonPx;
}

export function glanceStackOverlapPx(glanceBottom: number, nextTop: number): number {
  return Math.max(0, glanceBottom - nextTop);
}