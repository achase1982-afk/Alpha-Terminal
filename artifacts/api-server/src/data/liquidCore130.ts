export const LIQUID_CORE_SYMBOLS = [
  "SPY", "QQQ", "IWM", "DIA", "TQQQ", "GLD", "SLV", "USO",
  "NVDA", "TSLA", "AAPL", "AMZN", "META", "MSFT", "AMD", "AVGO",
  "GOOGL", "GOOG", "SMCI", "PLTR", "CRWD", "PANW", "MU", "MRVL",
  "INTC", "QCOM", "AMAT", "LRCX", "KLAC", "NXPI", "TXN", "ADI", "MCHP",
  "HOOD", "COIN", "RIVN", "DKNG", "ROKU", "PATH", "SNOW", "DDOG",
  "HUBS", "SHOP", "CRDO", "APP", "NFLX",
  "JPM", "BAC", "GS", "SCHW", "BLK", "MS", "AXP", "COF",
  "PNC", "TFC", "USB", "FITB", "HBAN", "RF", "CFG", "BK",
  "LLY", "UNH", "JNJ", "ABBV", "PFE", "MRK", "AMGN", "GILD",
  "VRTX", "REGN", "BMY", "MDT", "SYK", "ISRG", "BSX", "ELV", "CI", "HUM",
  "COST", "WMT", "PG", "KO", "PEP", "MCD", "NKE", "TGT",
  "KR", "DG", "DLTR", "BURL", "ROST", "TJX",
  "XOM", "CVX", "COP", "OXY", "SLB", "BKR", "EOG", "FANG",
  "DVN", "MPC", "PSX", "VLO", "OKE", "TRGP", "LNG",
  "CAT", "HON", "RTX", "LMT", "NOC", "BA", "DAL", "UAL",
  "LUV", "UNP", "CSX", "NSC", "GEHC", "TDG", "PCAR",
] as const;

export type LiquidCoreSymbol = typeof LIQUID_CORE_SYMBOLS[number];

export const LIQUID_CORE_SECTORS: Record<string, readonly string[]> = {
  "ETFs / Index Proxies": ["SPY", "QQQ", "IWM", "DIA", "TQQQ", "GLD", "SLV", "USO"],
  "Mega-Tech / AI / Semiconductors": ["NVDA", "TSLA", "AAPL", "AMZN", "META", "MSFT", "AMD", "AVGO", "GOOGL", "GOOG", "SMCI", "PLTR", "CRWD", "PANW", "MU", "MRVL", "INTC", "QCOM", "AMAT", "LRCX", "KLAC", "NXPI", "TXN", "ADI", "MCHP"],
  "Growth / Meme / High-Flow": ["HOOD", "COIN", "RIVN", "DKNG", "ROKU", "PATH", "SNOW", "DDOG", "HUBS", "SHOP", "CRDO", "APP", "NFLX"],
  "Financials": ["JPM", "BAC", "GS", "SCHW", "BLK", "MS", "AXP", "COF", "PNC", "TFC", "USB", "FITB", "HBAN", "RF", "CFG", "BK"],
  "Healthcare / Biotech": ["LLY", "UNH", "JNJ", "ABBV", "PFE", "MRK", "AMGN", "GILD", "VRTX", "REGN", "BMY", "MDT", "SYK", "ISRG", "BSX", "ELV", "CI", "HUM"],
  "Consumer Staples / Discretionary": ["COST", "WMT", "PG", "KO", "PEP", "MCD", "NKE", "TGT", "KR", "DG", "DLTR", "BURL", "ROST", "TJX"],
  "Energy / Commodities": ["XOM", "CVX", "COP", "OXY", "SLB", "BKR", "EOG", "FANG", "DVN", "MPC", "PSX", "VLO", "OKE", "TRGP", "LNG"],
  "Industrials / Defense / Transport": ["CAT", "HON", "RTX", "LMT", "NOC", "BA", "DAL", "UAL", "LUV", "UNP", "CSX", "NSC", "GEHC", "TDG", "PCAR"],
};
