import { create } from "zustand";

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

interface PortfolioStatus {
  status: "ok" | "no_token" | "error";
  message?: string;
}

interface PortfolioStreamState {
  account: PortfolioAccount | null;
  orders: PortfolioOrder[];
  lastUpdate: Date | null;
  portfolioStatus: PortfolioStatus;
  setAccount: (account: PortfolioAccount) => void;
  setOrders: (orders: PortfolioOrder[]) => void;
  setPortfolioStatus: (status: PortfolioStatus) => void;
}

export const usePortfolioStreamStore = create<PortfolioStreamState>((set) => ({
  account: null,
  orders: [],
  lastUpdate: null,
  portfolioStatus: { status: "ok" },
  setAccount: (account) => set({ account, lastUpdate: new Date(), portfolioStatus: { status: "ok" } }),
  setOrders: (orders) => set({ orders, lastUpdate: new Date() }),
  setPortfolioStatus: (status) => set({ portfolioStatus: status }),
}));
