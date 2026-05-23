/**
 * Curated catalyst themes → tickers. Clustering uses **symbol membership only**
 * (never FMP industry/sector). Tune here without code changes elsewhere.
 */
export const MOVERS_THEME_TICKER_MAP: ReadonlyArray<{
  label: string;
  tickers: readonly string[];
}> = [
  {
    label: "Quantum Computing",
    tickers: ["RGTI", "IONQ", "QUBT", "INFQ", "QBTS", "ARQQ"],
  },
  {
    label: "Nuclear",
    tickers: ["CEG", "VST", "CCJ", "NNE", "OKLO", "SMR", "LEU", "UEC"],
  },
  {
    label: "Space",
    tickers: ["RKLB", "LUNR", "ASTS", "SPCE", "RDW", "PL", "BKSY", "MNTS"],
  },
];
