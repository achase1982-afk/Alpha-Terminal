export interface SchwabBalances {
  liquidationValue: number;
  equity: number;
  buyingPower: number;
  dayTradingBuyingPower: number;
  cashBalance: number;
  availableFunds: number;
  marginBalance: number;
  maintenanceRequirement: number;
  longMarketValue: number;
  shortMarketValue: number;
  longOptionMarketValue: number;
  shortOptionMarketValue: number;
  moneyMarketFund: number;
  mutualFundValue: number;
  bondValue: number;
  pendingDeposits: number;
  sma: number;
}

export interface SchwabPosition {
  symbol: string;
  underlyingSymbol: string;
  description: string;
  assetType: string;
  putCall: string | null;
  cusip: string;
  longQuantity: number;
  shortQuantity: number;
  averagePrice: number;
  marketValue: number;
  currentDayProfitLoss: number;
  currentDayProfitLossPercentage: number;
  longOpenProfitLoss: number;
  maintenanceRequirement: number;
  settledLongQuantity: number;
  settledShortQuantity: number;
  previousSessionLongQuantity: number;
  closePrice: number | null;
  currentDayCost: number | null;
}

export interface SchwabAccountSummary {
  accountNumber: string;
  accountNumberRaw?: string;
  hashValue: string | null;
  type: string;
  isDayTrader: boolean;
  roundTrips: number;
  balances: SchwabBalances;
  initialBalances: { accountValue: number; equity: number; liquidationValue: number };
  dayPL: number;
  totalPL: number;
  positions: SchwabPosition[];
}

export type SchwabViewSelection = "all" | string;

export interface SchwabPortfolioPrefs {
  viewSelection: SchwabViewSelection;
  defaultTradingAccountHash: string | null;
  hideBalances: boolean;
}
