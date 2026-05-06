/**
 * Dev-only: paste into a throwaway route or Storybook to verify populated scanner panels.
 * Not imported by production code.
 */
import type { ScannerCardData } from "@/lib/unifiedScanTypes";

export const DEV_SCANNER_CARD_FIXTURE: ScannerCardData = {
  symbol: "DEMO",
  name: "Demo Corp",
  sector: "Technology",
  price: 142.5,
  changePct: 1.25,
  changeAbs: 1.76,
  volume: 45_000_000,
  avgVolume20d: 30_000_000,
  dayRange: { low: 140.0, high: 143.2 },
  iv30: 0.32,
  ivr: 62,
  ivPercentile: 58,
  hv30: 0.28,
  ivVsHv: 0.32 / 0.28,
  termStructure: { frontIv: 0.3, backIv: 0.27, ratio: 1.11, shape: "contango" },
  nextEarnings: { date: "2026-05-20", daysTo: 10, timing: "AMC" },
  nextExDiv: { date: "2026-06-01", daysTo: 22, amount: 0.52 },
  earningsHistory: [
    { quarter: "Q4", absMovePct: 3.2 },
    { quarter: "Q3", absMovePct: -1.1 },
    { quarter: "Q2", absMovePct: 0.8 },
    { quarter: "Q1", absMovePct: -2.4 },
  ],
  flow: {
    blocks4h: 12,
    sweeps4h: 34,
    netDeltaDollar: 4_200_000,
    topStrikeLabel: "$145C",
    topStrike: {
      strike: 145,
      optionType: "call",
      expiration: "2026-06-20",
      volumeAtStrike: 12000,
      openInterest: 8000,
    },
    volume4h: 185_000,
    volumeOverOi: 0.42,
  },
  technical: {
    week52High: 160,
    week52Low: 95,
    pctOffHigh: -10.9,
    aboveMa20: true,
    aboveMa50: true,
    aboveMa200: false,
    return5d: 2.1,
    return30d: -0.5,
  },
  score: 72,
  scoreComponents: {
    liquidity: 80,
    volContext: 65,
    catalyst: 70,
    flow: 68,
    technical: 75,
  },
  preset: "Momentum + Flow",
  lastUpdate: new Date().toISOString(),
  dataQualityFlags: [],
};
