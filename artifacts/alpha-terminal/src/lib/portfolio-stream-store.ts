import { create } from "zustand";
import type { SchwabAccountSummary } from "./schwab-account-types";
import { schwabAccountsFingerprint } from "./schwabAccountFingerprint";

interface PortfolioAccount {
  accountNumber: string;
  type: string;
  isDayTrader: boolean;
  roundTrips: number;
  balances: Record<string, number>;
  initialBalances: Record<string, number>;
  dayPL: number;
  totalPL: number;
  positions: any[];
  hashValue?: string | null;
  accountNumberRaw?: string;
}

interface PortfolioOrder {
  orderId: number;
  orderType: string;
  session: string;
  duration: string;
  status: string;
  filledQuantity: number;
  remainingQuantity: number;
  price: number | null;
  complexStrategy: string;
  enteredTime: string;
  closeTime: string | null;
  legs: any[];
  fills: any[];
  tag: string | null;
}

export interface PortfolioStatus {
  status: "ok" | "no_token" | "error";
  message?: string;
}

interface PortfolioStreamState {
  /** All Schwab sub-accounts (1 Hz poll via subscribePortfolio). */
  accounts: SchwabAccountSummary[];
  accountsFingerprint: string;
  account: PortfolioAccount | null;
  orders: PortfolioOrder[];
  lastUpdate: Date | null;
  portfolioStatus: PortfolioStatus;
  setAccounts: (accounts: SchwabAccountSummary[]) => void;
  setAccount: (account: PortfolioAccount) => void;
  setOrders: (orders: PortfolioOrder[]) => void;
  setPortfolioStatus: (status: PortfolioStatus) => void;
}

export const usePortfolioStreamStore = create<PortfolioStreamState>((set, get) => ({
  accounts: [],
  accountsFingerprint: "",
  account: null,
  orders: [],
  lastUpdate: null,
  portfolioStatus: { status: "ok" },
  setAccounts: (accounts) => {
    const fingerprint = schwabAccountsFingerprint(accounts);
    if (fingerprint === get().accountsFingerprint) {
      set({ lastUpdate: new Date(), portfolioStatus: { status: "ok" } });
      return;
    }
    set({
      accounts,
      accountsFingerprint: fingerprint,
      account: accounts[0] ? ({ ...accounts[0], balances: { ...accounts[0].balances } } as PortfolioAccount) : null,
      lastUpdate: new Date(),
      portfolioStatus: { status: "ok" },
    });
  },
  setAccount: (account) => set({ account, lastUpdate: new Date(), portfolioStatus: { status: "ok" } }),
  setOrders: (orders) => set({ orders, lastUpdate: new Date() }),
  setPortfolioStatus: (status) => set({ portfolioStatus: status }),
}));
