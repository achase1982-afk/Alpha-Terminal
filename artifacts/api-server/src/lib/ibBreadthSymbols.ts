export interface IBSymbolDef {
  reqId: number;
  symbol: string;
  ibSymbol: string;
  secType: string;
  exchange: string;
  displaySymbol: string;
  category: string;
  description: string;
  enabled: boolean;
  sourceField?: "bid" | "ask" | "net_bid_ask";
}

// ─────────────────────────────────────────────────────────────
// IBKR BREADTH SYMBOLS — MASTER CONFIGURATION
// ─────────────────────────────────────────────────────────────
// Set enabled: true/false to control which symbols stream.
// reqId must be unique across all symbols (5000+ range).
// Categories: BREADTH, VOLATILITY, FUTURES, EQUITY, BOND, COMMODITY, CURRENCY, PUT_CALL
// ─────────────────────────────────────────────────────────────

export const ALL_BREADTH_SYMBOLS: IBSymbolDef[] = [

  // ═══════════════════════════════════════════════════════════
  // RATES (7)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5095, symbol: "$TNX",    ibSymbol: "TNX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$TNX",    category: "RATES",   description: "10-Year Treasury Yield Index",                                    enabled: true },
  { reqId: 5096, symbol: "$TYX",    ibSymbol: "TYX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$TYX",    category: "RATES",   description: "30-Year Treasury Yield Index",                                    enabled: true },
  { reqId: 5020, symbol: "/ZT",     ibSymbol: "ZT",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZT",     category: "RATES",   description: "2-Year Treasury Note Future",                                     enabled: true },
  { reqId: 5021, symbol: "/ZF",     ibSymbol: "ZF",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZF",     category: "RATES",   description: "5-Year Treasury Note Future",                                     enabled: true },
  { reqId: 5019, symbol: "/ZN",     ibSymbol: "ZN",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZN",     category: "RATES",   description: "10-Year Treasury Note Future",                                    enabled: true },
  { reqId: 5018, symbol: "/ZB",     ibSymbol: "ZB",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZB",     category: "RATES",   description: "30-Year Treasury Bond Future",                                    enabled: true },
  { reqId: 5120, symbol: "/ZQ",     ibSymbol: "ZQ",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZQ",     category: "RATES",   description: "30-Day Fed Funds Futures",                                        enabled: true },

  // ═══════════════════════════════════════════════════════════
  // CREDIT (3)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5025, symbol: "HYG",     ibSymbol: "HYG",        secType: "STK", exchange: "SMART",   displaySymbol: "HYG",     category: "CREDIT",  description: "iShares High Yield Corporate Bond ETF (credit risk gauge)",       enabled: true },
  { reqId: 5026, symbol: "LQD",     ibSymbol: "LQD",        secType: "STK", exchange: "SMART",   displaySymbol: "LQD",     category: "CREDIT",  description: "iShares Investment Grade Corporate Bond ETF",                     enabled: true },
  { reqId: 5102, symbol: "IEF",     ibSymbol: "IEF",        secType: "STK", exchange: "SMART",   displaySymbol: "IEF",     category: "CREDIT",  description: "iShares 7-10 Year Treasury Bond ETF",                             enabled: true },

  // ═══════════════════════════════════════════════════════════
  // VOLATILITY LEVEL (2)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5008, symbol: "$VIX",    ibSymbol: "VIX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$VIX",    category: "VOLATILITY", description: "CBOE VIX — 30-day implied volatility of S&P 500",            enabled: true },
  { reqId: 5011, symbol: "$VVIX",   ibSymbol: "VVIX",       secType: "IND", exchange: "CBOE",    displaySymbol: "$VVIX",   category: "VOLATILITY", description: "CBOE VVIX — volatility of VIX (vol of vol)",                  enabled: true },

  // ═══════════════════════════════════════════════════════════
  // VOLATILITY TERM STRUCTURE (4)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5012, symbol: "$VIX1D",  ibSymbol: "VIX1D",      secType: "IND", exchange: "CBOE",    displaySymbol: "$VIX1D",  category: "VOLATILITY", description: "CBOE VIX 1-Day — 1-day expected move implied vol",             enabled: true },
  { reqId: 5009, symbol: "$VIX9D",  ibSymbol: "VIX9D",      secType: "IND", exchange: "CBOE",    displaySymbol: "$VIX9D",  category: "VOLATILITY", description: "CBOE VIX 9-Day — short-term implied volatility",              enabled: true },
  { reqId: 5010, symbol: "$VIX3M",  ibSymbol: "VIX3M",      secType: "IND", exchange: "CBOE",    displaySymbol: "$VIX3M",  category: "VOLATILITY", description: "CBOE VIX 3-Month — medium-term implied volatility",            enabled: true },
  { reqId: 5013, symbol: "$SKEW",   ibSymbol: "SKEW",       secType: "IND", exchange: "CBOE",    displaySymbol: "$SKEW",   category: "VOLATILITY", description: "CBOE SKEW — tail risk / out-of-money put skew (dead indicator)",               enabled: false },

  // ═══════════════════════════════════════════════════════════
  // NYSE BREADTH (7)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5001, symbol: "$TICK",   ibSymbol: "TICK-NYSE",  secType: "IND", exchange: "NYSE",    displaySymbol: "$TICK",   category: "BREADTH", description: "NYSE Tick Index — net uptick vs downtick stocks",                enabled: true },
  { reqId: 5002, symbol: "$TRIN",   ibSymbol: "TRIN-NYSE",  secType: "IND", exchange: "NYSE",    displaySymbol: "$TRIN",   category: "BREADTH", description: "NYSE Arms Index (TRIN) — advancing/declining volume ratio",     enabled: true },
  { reqId: 5003, symbol: "$ADD",    ibSymbol: "AD-NYSE",    secType: "IND", exchange: "NYSE",    displaySymbol: "$ADD",    category: "BREADTH", description: "NYSE Net Advance/Decline (bid−ask of AD-NYSE)",                 enabled: true, sourceField: "net_bid_ask"},
  { reqId: 5004, symbol: "$ADVN",   ibSymbol: "AD-NYSE",    secType: "IND", exchange: "NYSE",    displaySymbol: "$ADVN",   category: "BREADTH", description: "NYSE Advancing Issues (bid of AD-NYSE)",                       enabled: true, sourceField: "bid"},
  { reqId: 5006, symbol: "$DECN",   ibSymbol: "AD-NYSE",    secType: "IND", exchange: "NYSE",    displaySymbol: "$DECN",   category: "BREADTH", description: "NYSE Declining Issues (ask of AD-NYSE)",                       enabled: true, sourceField: "ask"},
  { reqId: 5040, symbol: "$UVOL",   ibSymbol: "VOL-NYSE",   secType: "IND", exchange: "NYSE",    displaySymbol: "$UVOL",   category: "BREADTH", description: "NYSE Up Volume (bid of VOL-NYSE)",                             enabled: true, sourceField: "bid"},
  { reqId: 5041, symbol: "$DVOL",   ibSymbol: "VOL-NYSE",   secType: "IND", exchange: "NYSE",    displaySymbol: "$DVOL",   category: "BREADTH", description: "NYSE Down Volume (ask of VOL-NYSE)",                           enabled: true, sourceField: "ask"},

  // ═══════════════════════════════════════════════════════════
  // NASDAQ BREADTH (7)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5005, symbol: "$TICKI",  ibSymbol: "TICK-NASD",  secType: "IND", exchange: "NASDAQ",  displaySymbol: "$TICKI",  category: "BREADTH", description: "NASDAQ Tick Index — net uptick vs downtick stocks",             enabled: true },
  { reqId: 5007, symbol: "$TRINQ",  ibSymbol: "TRIN-NASD",  secType: "IND", exchange: "NASDAQ",  displaySymbol: "$TRINQ",  category: "BREADTH", description: "NASDAQ Arms Index (TRIN) — advancing/declining volume ratio",  enabled: true },
  { reqId: 5042, symbol: "$ADDQ",   ibSymbol: "AD-NASD",    secType: "IND", exchange: "NASDAQ",  displaySymbol: "$ADDQ",   category: "BREADTH", description: "NASDAQ Net Advance/Decline (bid−ask of AD-NASD)",              enabled: true, sourceField: "net_bid_ask"},
  { reqId: 5043, symbol: "$ADVNQ",  ibSymbol: "AD-NASD",    secType: "IND", exchange: "NASDAQ",  displaySymbol: "$ADVNQ",  category: "BREADTH", description: "NASDAQ Advancing Issues (bid of AD-NASD)",                     enabled: true, sourceField: "bid"},
  { reqId: 5044, symbol: "$DECNQ",  ibSymbol: "AD-NASD",    secType: "IND", exchange: "NASDAQ",  displaySymbol: "$DECNQ",  category: "BREADTH", description: "NASDAQ Declining Issues (ask of AD-NASD)",                     enabled: true, sourceField: "ask"},
  { reqId: 5045, symbol: "$UVOLQ",  ibSymbol: "VOL-NASD",   secType: "IND", exchange: "NASDAQ",  displaySymbol: "$UVOLQ",  category: "BREADTH", description: "NASDAQ Up Volume (bid of VOL-NASD)",                           enabled: true, sourceField: "bid"},
  { reqId: 5046, symbol: "$DVOLQ",  ibSymbol: "VOL-NASD",   secType: "IND", exchange: "NASDAQ",  displaySymbol: "$DVOLQ",  category: "BREADTH", description: "NASDAQ Down Volume (ask of VOL-NASD)",                         enabled: true, sourceField: "ask"},

  // ═══════════════════════════════════════════════════════════
  // RISK APPETITE (4)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5015, symbol: "/ES",     ibSymbol: "ES",         secType: "FUT", exchange: "CME",     displaySymbol: "/ES",     category: "FUTURES", description: "E-mini S&P 500 Future",                                        enabled: true },
  { reqId: 5016, symbol: "/NQ",     ibSymbol: "NQ",         secType: "FUT", exchange: "CME",     displaySymbol: "/NQ",     category: "FUTURES", description: "E-mini NASDAQ-100 Future",                                      enabled: true },
  { reqId: 5070, symbol: "/YM",     ibSymbol: "YM",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/YM",     category: "FUTURES", description: "E-mini Dow Jones Future",                                       enabled: true },
  { reqId: 5017, symbol: "/RTY",    ibSymbol: "RTY",        secType: "FUT", exchange: "CME",     displaySymbol: "/RTY",    category: "FUTURES", description: "E-mini Russell 2000 Future",                                    enabled: true },

  // ═══════════════════════════════════════════════════════════
  // MACRO (5 — /ZQ shared with RATES above)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5024, symbol: "/GC",     ibSymbol: "GC",         secType: "FUT", exchange: "COMEX",   displaySymbol: "/GC",     category: "COMMODITY", description: "Gold Future",                                                  enabled: true },
  { reqId: 5023, symbol: "/CL",     ibSymbol: "CL",         secType: "FUT", exchange: "NYMEX",   displaySymbol: "/CL",     category: "COMMODITY", description: "WTI Crude Oil Future",                                        enabled: true },
  { reqId: 5022, symbol: "/DX",     ibSymbol: "DX",         secType: "FUT", exchange: "ICEUS",   displaySymbol: "/DX",     category: "CURRENCY", description: "US Dollar Index Future (ICE Futures US — needs ICE subscription; derived from /6E instead)", enabled: false },

  // ═══════════════════════════════════════════════════════════
  // SENTIMENT / OPTIONS LAYER (2)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5050, symbol: "$CPC",    ibSymbol: "CPC",        secType: "IND", exchange: "CBOE",    displaySymbol: "$CPC",    category: "PUT_CALL", description: "CBOE Total Put/Call Ratio",              enabled: false },
  { reqId: 5051, symbol: "$CPCE",   ibSymbol: "CPCE",       secType: "IND", exchange: "CBOE",    displaySymbol: "$CPCE",   category: "PUT_CALL", description: "CBOE Equity Put/Call Ratio",             enabled: false },
  { reqId: 5058, symbol: "$PCUSEQTR", ibSymbol: "PCUSEQTR", secType: "IND", exchange: "CBOE",    displaySymbol: "$PCUSEQTR", category: "PUT_CALL", description: "CBOE Equity Put/Call Ratio",           enabled: true },
  { reqId: 5059, symbol: "$PCUSINXR", ibSymbol: "PCUSINXR", secType: "IND", exchange: "CBOE",    displaySymbol: "$PCUSINXR", category: "PUT_CALL", description: "CBOE Index Put/Call Ratio",            enabled: true },

  // ═══════════════════════════════════════════════════════════
  // ADDITIONAL EQUITY (not in scoring but useful for streaming)
  // ═══════════════════════════════════════════════════════════
  { reqId: 5028, symbol: "$SPX",    ibSymbol: "SPX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$SPX",    category: "EQUITY", description: "S&P 500 Cash Index",                                               enabled: true },
  { reqId: 5029, symbol: "SPY",     ibSymbol: "SPY",        secType: "STK", exchange: "SMART",   displaySymbol: "SPY",     category: "EQUITY", description: "SPDR S&P 500 ETF",                                                  enabled: true },
  { reqId: 5030, symbol: "QQQ",     ibSymbol: "QQQ",        secType: "STK", exchange: "SMART",   displaySymbol: "QQQ",     category: "EQUITY", description: "Invesco QQQ NASDAQ-100 ETF",                                       enabled: true },
  { reqId: 5031, symbol: "IWM",     ibSymbol: "IWM",        secType: "STK", exchange: "SMART",   displaySymbol: "IWM",     category: "EQUITY", description: "iShares Russell 2000 ETF",                                         enabled: true },
  { reqId: 5032, symbol: "TLT",     ibSymbol: "TLT",        secType: "STK", exchange: "SMART",   displaySymbol: "TLT",     category: "EQUITY", description: "iShares 20+ Year Treasury Bond ETF",                               enabled: true },
  { reqId: 5014, symbol: "/VIX",    ibSymbol: "VIX",        secType: "FUT", exchange: "CFE",     displaySymbol: "/VIX",    category: "VOLATILITY", description: "VIX Front Month Future — tradeable VIX contract",             enabled: true },

  // ═══════════════════════════════════════════════════════════
  // EXTENDED INDICATORS — ALL ENABLED
  // ═══════════════════════════════════════════════════════════
  { reqId: 5052, symbol: "$CPCI",   ibSymbol: "CPCI",       secType: "IND", exchange: "CBOE",    displaySymbol: "$CPCI",   category: "PUT_CALL", description: "CBOE Index Put/Call Ratio",              enabled: false },
  { reqId: 5053, symbol: "$PCALL",  ibSymbol: "PCALL",      secType: "IND", exchange: "CBOE",    displaySymbol: "$PCALL",  category: "PUT_CALL", description: "CBOE Total Put/Call Volume",             enabled: false },
  { reqId: 5054, symbol: "$PCSPY",  ibSymbol: "PCSPY",      secType: "IND", exchange: "CBOE",    displaySymbol: "$PCSPY",  category: "PUT_CALL", description: "SPY Put/Call Ratio",                     enabled: false },
  { reqId: 5055, symbol: "$PCQQQ",  ibSymbol: "PCQQQ",      secType: "IND", exchange: "CBOE",    displaySymbol: "$PCQQQ",  category: "PUT_CALL", description: "QQQ Put/Call Ratio",                     enabled: false },
  { reqId: 5056, symbol: "$PCIWM",  ibSymbol: "PCIWM",      secType: "IND", exchange: "CBOE",    displaySymbol: "$PCIWM",  category: "PUT_CALL", description: "IWM Put/Call Ratio",                     enabled: false },
  { reqId: 5057, symbol: "$PCVIX",  ibSymbol: "PCVIX",      secType: "IND", exchange: "CBOE",    displaySymbol: "$PCVIX",  category: "PUT_CALL", description: "VIX Put/Call Ratio",                     enabled: false },
  { reqId: 5060, symbol: "$RVX",    ibSymbol: "RVX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$RVX",    category: "VOLATILITY", description: "CBOE Russell 2000 VIX — small-cap implied volatility",         enabled: true },
  { reqId: 5061, symbol: "$VXN",    ibSymbol: "VXN",        secType: "IND", exchange: "CBOE",    displaySymbol: "$VXN",    category: "VOLATILITY", description: "CBOE NASDAQ-100 VIX — tech-heavy implied volatility",          enabled: true },
  { reqId: 5062, symbol: "$OVX",    ibSymbol: "OVX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$OVX",    category: "VOLATILITY", description: "CBOE Crude Oil VIX — oil implied volatility",                  enabled: true },
  { reqId: 5063, symbol: "$GVZ",    ibSymbol: "GVZ",        secType: "IND", exchange: "CBOE",    displaySymbol: "$GVZ",    category: "VOLATILITY", description: "CBOE Gold VIX — gold implied volatility",                      enabled: true },
  { reqId: 5064, symbol: "$SRVIX",  ibSymbol: "SRVIX",      secType: "IND", exchange: "CBOE",    displaySymbol: "$SRVIX",  category: "VOLATILITY", description: "CBOE SOFR Rate VIX (dead indicator)", enabled: false },
  { reqId: 5065, symbol: "$MOVE",   ibSymbol: "MOVE",       secType: "IND", exchange: "CBOE",    displaySymbol: "$MOVE",   category: "VOLATILITY", description: "ICE BofA MOVE Index (dead indicator)",                         enabled: false },
  { reqId: 5071, symbol: "/MES",    ibSymbol: "MES",        secType: "FUT", exchange: "CME",     displaySymbol: "/MES",    category: "FUTURES", description: "Micro E-mini S&P 500 Future",                                   enabled: true },
  { reqId: 5072, symbol: "/MNQ",    ibSymbol: "MNQ",        secType: "FUT", exchange: "CME",     displaySymbol: "/MNQ",    category: "FUTURES", description: "Micro E-mini NASDAQ-100 Future",                                enabled: true },
  { reqId: 5073, symbol: "/M2K",    ibSymbol: "M2K",        secType: "FUT", exchange: "CME",     displaySymbol: "/M2K",    category: "FUTURES", description: "Micro E-mini Russell 2000 Future",                              enabled: true },
  { reqId: 5074, symbol: "/UB",     ibSymbol: "UB",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/UB",     category: "BOND",   description: "Ultra Treasury Bond Future (20+ year)",                           enabled: true },
  { reqId: 5075, symbol: "/SI",     ibSymbol: "SI",         secType: "FUT", exchange: "COMEX",   displaySymbol: "/SI",     category: "COMMODITY", description: "Silver Future",                                                enabled: true },
  { reqId: 5076, symbol: "/HG",     ibSymbol: "HG",         secType: "FUT", exchange: "COMEX",   displaySymbol: "/HG",     category: "COMMODITY", description: "Copper Future",                                                enabled: true },
  { reqId: 5077, symbol: "/NG",     ibSymbol: "NG",         secType: "FUT", exchange: "NYMEX",   displaySymbol: "/NG",     category: "COMMODITY", description: "Natural Gas Future",                                           enabled: true },
  { reqId: 5078, symbol: "/RB",     ibSymbol: "RB",         secType: "FUT", exchange: "NYMEX",   displaySymbol: "/RB",     category: "COMMODITY", description: "RBOB Gasoline Future",                                         enabled: true },
  { reqId: 5079, symbol: "/PL",     ibSymbol: "PL",         secType: "FUT", exchange: "NYMEX",   displaySymbol: "/PL",     category: "COMMODITY", description: "Platinum Future",                                              enabled: true },
  { reqId: 5080, symbol: "/ZC",     ibSymbol: "ZC",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZC",     category: "COMMODITY", description: "Corn Future",                                                  enabled: true },
  { reqId: 5081, symbol: "/ZS",     ibSymbol: "ZS",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZS",     category: "COMMODITY", description: "Soybean Future",                                               enabled: true },
  { reqId: 5082, symbol: "/ZW",     ibSymbol: "ZW",         secType: "FUT", exchange: "CBOT",    displaySymbol: "/ZW",     category: "COMMODITY", description: "Wheat Future",                                                 enabled: true },
  { reqId: 5083, symbol: "/6E",     ibSymbol: "EUR",        secType: "FUT", exchange: "CME",     displaySymbol: "/6E",     category: "CURRENCY", description: "Euro FX Future (EUR/USD)",                                      enabled: true },
  { reqId: 5084, symbol: "/6J",     ibSymbol: "JPY",        secType: "FUT", exchange: "CME",     displaySymbol: "/6J",     category: "CURRENCY", description: "Japanese Yen Future (JPY/USD)",                                  enabled: true },
  { reqId: 5085, symbol: "/6B",     ibSymbol: "GBP",        secType: "FUT", exchange: "CME",     displaySymbol: "/6B",     category: "CURRENCY", description: "British Pound Future (GBP/USD)",                                 enabled: true },
  { reqId: 5086, symbol: "/6A",     ibSymbol: "AUD",        secType: "FUT", exchange: "CME",     displaySymbol: "/6A",     category: "CURRENCY", description: "Australian Dollar Future (AUD/USD)",                             enabled: true },
  { reqId: 5087, symbol: "/6C",     ibSymbol: "CAD",        secType: "FUT", exchange: "CME",     displaySymbol: "/6C",     category: "CURRENCY", description: "Canadian Dollar Future (CAD/USD)",                               enabled: true },
  { reqId: 5088, symbol: "/BTC",    ibSymbol: "BRR",        secType: "FUT", exchange: "CME",     displaySymbol: "/BTC",    category: "CURRENCY", description: "CME Bitcoin Future",                                             enabled: true },
  { reqId: 5089, symbol: "/ETH",    ibSymbol: "ETH",        secType: "FUT", exchange: "CME",     displaySymbol: "/ETH",    category: "CURRENCY", description: "CME Ether Future",                                              enabled: true },
  { reqId: 5090, symbol: "$NDX",    ibSymbol: "NDX",        secType: "IND", exchange: "NASDAQ",  displaySymbol: "$NDX",    category: "EQUITY", description: "NASDAQ-100 Cash Index",                                            enabled: true },
  { reqId: 5091, symbol: "$RUT",    ibSymbol: "RUT",        secType: "IND", exchange: "RUSSELL", displaySymbol: "$RUT",    category: "EQUITY", description: "Russell 2000 Cash Index",                                           enabled: true },
  { reqId: 5092, symbol: "$DJI",    ibSymbol: "INDU",       secType: "IND", exchange: "NYSE",    displaySymbol: "$DJI",    category: "EQUITY", description: "Dow Jones Industrial Average",                                      enabled: true },
  { reqId: 5093, symbol: "$SOX",    ibSymbol: "SOX",        secType: "IND", exchange: "PHLX",    displaySymbol: "$SOX",    category: "EQUITY", description: "Philadelphia Semiconductor Index",                                   enabled: true },
  { reqId: 5094, symbol: "$XOI",    ibSymbol: "XOI",        secType: "IND", exchange: "NYSE",    displaySymbol: "$XOI",    category: "EQUITY", description: "AMEX Oil Index",                                                    enabled: true },
  { reqId: 5097, symbol: "$IRX",    ibSymbol: "IRX",        secType: "IND", exchange: "CBOE",    displaySymbol: "$IRX",    category: "RATES", description: "13-Week Treasury Bill Yield Index (3-Month T-Bill Rate)",              enabled: true },
  { reqId: 5098, symbol: "DIA",     ibSymbol: "DIA",        secType: "STK", exchange: "SMART",   displaySymbol: "DIA",     category: "EQUITY", description: "SPDR Dow Jones Industrial ETF",                                    enabled: true },
  { reqId: 5099, symbol: "VXX",     ibSymbol: "VXX",        secType: "STK", exchange: "SMART",   displaySymbol: "VXX",     category: "VOLATILITY", description: "iPath VIX Short-Term Futures ETN",                             enabled: true },
  { reqId: 5100, symbol: "UVXY",    ibSymbol: "UVXY",       secType: "STK", exchange: "SMART",   displaySymbol: "UVXY",    category: "VOLATILITY", description: "ProShares Ultra VIX Short-Term Futures ETF (2x)",              enabled: true },
  { reqId: 5101, symbol: "SVXY",    ibSymbol: "SVXY",       secType: "STK", exchange: "SMART",   displaySymbol: "SVXY",    category: "VOLATILITY", description: "ProShares Short VIX Short-Term Futures ETF (-0.5x)",           enabled: true },
  { reqId: 5103, symbol: "SHY",     ibSymbol: "SHY",        secType: "STK", exchange: "SMART",   displaySymbol: "SHY",     category: "BOND",   description: "iShares 1-3 Year Treasury Bond ETF",                               enabled: true },
  { reqId: 5104, symbol: "GLD",     ibSymbol: "GLD",        secType: "STK", exchange: "SMART",   displaySymbol: "GLD",     category: "COMMODITY", description: "SPDR Gold Shares ETF",                                         enabled: true },
  { reqId: 5105, symbol: "SLV",     ibSymbol: "SLV",        secType: "STK", exchange: "SMART",   displaySymbol: "SLV",     category: "COMMODITY", description: "iShares Silver Trust ETF",                                     enabled: true },
  { reqId: 5106, symbol: "USO",     ibSymbol: "USO",        secType: "STK", exchange: "SMART",   displaySymbol: "USO",     category: "COMMODITY", description: "United States Oil Fund ETF",                                   enabled: true },
  { reqId: 5107, symbol: "XLF",     ibSymbol: "XLF",        secType: "STK", exchange: "SMART",   displaySymbol: "XLF",     category: "EQUITY", description: "Financial Select Sector SPDR ETF",                                 enabled: true },
  { reqId: 5108, symbol: "XLE",     ibSymbol: "XLE",        secType: "STK", exchange: "SMART",   displaySymbol: "XLE",     category: "EQUITY", description: "Energy Select Sector SPDR ETF",                                    enabled: true },
  { reqId: 5109, symbol: "XLK",     ibSymbol: "XLK",        secType: "STK", exchange: "SMART",   displaySymbol: "XLK",     category: "EQUITY", description: "Technology Select Sector SPDR ETF",                                enabled: true },
  { reqId: 5110, symbol: "XLV",     ibSymbol: "XLV",        secType: "STK", exchange: "SMART",   displaySymbol: "XLV",     category: "EQUITY", description: "Health Care Select Sector SPDR ETF",                               enabled: true },
  { reqId: 5111, symbol: "XLU",     ibSymbol: "XLU",        secType: "STK", exchange: "SMART",   displaySymbol: "XLU",     category: "EQUITY", description: "Utilities Select Sector SPDR ETF",                                 enabled: true },
  { reqId: 5112, symbol: "XLP",     ibSymbol: "XLP",        secType: "STK", exchange: "SMART",   displaySymbol: "XLP",     category: "EQUITY", description: "Consumer Staples Select Sector SPDR ETF",                          enabled: true },
  { reqId: 5113, symbol: "XLY",     ibSymbol: "XLY",        secType: "STK", exchange: "SMART",   displaySymbol: "XLY",     category: "EQUITY", description: "Consumer Discretionary Select Sector SPDR ETF",                    enabled: true },
  { reqId: 5114, symbol: "XLI",     ibSymbol: "XLI",        secType: "STK", exchange: "SMART",   displaySymbol: "XLI",     category: "EQUITY", description: "Industrial Select Sector SPDR ETF",                                enabled: true },
  { reqId: 5115, symbol: "XLB",     ibSymbol: "XLB",        secType: "STK", exchange: "SMART",   displaySymbol: "XLB",     category: "EQUITY", description: "Materials Select Sector SPDR ETF",                                 enabled: true },
  { reqId: 5116, symbol: "XLRE",    ibSymbol: "XLRE",       secType: "STK", exchange: "SMART",   displaySymbol: "XLRE",    category: "EQUITY", description: "Real Estate Select Sector SPDR ETF",                               enabled: true },
  { reqId: 5117, symbol: "XLC",     ibSymbol: "XLC",        secType: "STK", exchange: "SMART",   displaySymbol: "XLC",     category: "EQUITY", description: "Communication Services Select Sector SPDR ETF",                    enabled: true },
];

export function getEnabledSymbols(): IBSymbolDef[] {
  return ALL_BREADTH_SYMBOLS.filter(s => s.enabled);
}

export function getSymbolsByCategory(category: string): IBSymbolDef[] {
  return ALL_BREADTH_SYMBOLS.filter(s => s.category === category);
}

export function getEnabledByCategory(category: string): IBSymbolDef[] {
  return ALL_BREADTH_SYMBOLS.filter(s => s.enabled && s.category === category);
}
