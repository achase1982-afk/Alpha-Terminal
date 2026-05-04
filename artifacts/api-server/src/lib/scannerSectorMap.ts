/** LC130-style sector labels for scanner snapshot rows (was SECTOR_MAP in legacy scanner). */
const SECTOR_MAP: Record<string, string> = {
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", AMZN: "Consumer Discretionary", META: "Technology",
  GOOGL: "Technology", GOOG: "Technology", TSLA: "Consumer Discretionary", AVGO: "Technology", NFLX: "Communication Services",
  AMD: "Technology", CRM: "Technology", ORCL: "Technology", ADBE: "Technology", INTU: "Technology",
  NOW: "Technology", QCOM: "Technology", TXN: "Technology", AMAT: "Technology", MU: "Technology",
  LRCX: "Technology", PANW: "Technology", KLAC: "Technology", SNPS: "Technology", CDNS: "Technology",
  JPM: "Financials", BAC: "Financials", WFC: "Financials", GS: "Financials", MS: "Financials",
  SCHW: "Financials", C: "Financials", BLK: "Financials", SPGI: "Financials", CME: "Financials",
  ICE: "Financials", MCO: "Financials", AXP: "Financials", V: "Financials", MA: "Financials",
  UNH: "Healthcare", LLY: "Healthcare", ABBV: "Healthcare", MRK: "Healthcare", PFE: "Healthcare",
  JNJ: "Healthcare", ABT: "Healthcare", TMO: "Healthcare", ISRG: "Healthcare", SYK: "Healthcare",
  VRTX: "Healthcare", REGN: "Healthcare", AMGN: "Healthcare", BSX: "Healthcare", HCA: "Healthcare",
  DHR: "Healthcare", ZTS: "Healthcare", DXCM: "Healthcare", IDXX: "Healthcare", BIIB: "Healthcare",
  XOM: "Energy", CVX: "Energy", SLB: "Energy", FANG: "Energy", BKR: "Energy",
  PG: "Consumer Staples", KO: "Consumer Staples", PEP: "Consumer Staples", COST: "Consumer Staples",
  WMT: "Consumer Staples", CL: "Consumer Staples", MDLZ: "Consumer Staples", MCD: "Consumer Discretionary",
  HD: "Consumer Discretionary", LOW: "Consumer Discretionary", TGT: "Consumer Discretionary", SBUX: "Consumer Discretionary",
  BKNG: "Consumer Discretionary", ABNB: "Consumer Discretionary", DASH: "Consumer Discretionary",
  NEE: "Utilities", SO: "Utilities", DUK: "Utilities", AEP: "Utilities", XEL: "Utilities", EXC: "Utilities",
  LIN: "Materials", CAT: "Industrials", GE: "Industrials", DE: "Industrials", RTX: "Industrials",
  UNP: "Industrials", ETN: "Industrials", PH: "Industrials", WM: "Industrials",
  T: "Communication Services", VZ: "Communication Services", CMCSA: "Communication Services", TMUS: "Communication Services",
  PM: "Consumer Staples", BRK: "Financials", "BRK.B": "Financials",
  COIN: "Financials", MSTR: "Technology", PLTR: "Technology", CRWD: "Technology", NET: "Technology",
  DDOG: "Technology", SNOW: "Technology", SHOP: "Technology", SQ: "Financials",
  SOFI: "Financials", HOOD: "Financials", RIVN: "Consumer Discretionary", LCID: "Consumer Discretionary",
  SMCI: "Technology", ARM: "Technology", CEG: "Utilities", APP: "Technology", WDAY: "Technology",
  GME: "Consumer Discretionary", AMC: "Communication Services", MARA: "Financials", RIOT: "Financials",
  PYPL: "Financials", FI: "Financials", CB: "Financials", PGR: "Financials", MMC: "Financials",
};

export function getScannerSector(symbol: string): string {
  return SECTOR_MAP[symbol.toUpperCase()] ?? "Other";
}
