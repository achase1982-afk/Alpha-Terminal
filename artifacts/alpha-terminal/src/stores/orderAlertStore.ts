import { create } from "zustand";

export interface OrderAlert {
  id: string;
  type: string;
  symbol: string | null;
  status: string | null;
  side: string | null;
  quantity: string | null;
  price: string | null;
  orderId: string | null;
  timestamp: number;
  raw: string;
}

interface OrderAlertState {
  alerts: OrderAlert[];
  addAlert: (alert: OrderAlert) => void;
  clearAlerts: () => void;
}

export const useOrderAlertStore = create<OrderAlertState>((set) => ({
  alerts: [],
  addAlert: (alert) =>
    set((s) => ({
      alerts: [alert, ...s.alerts].slice(0, 100),
    })),
  clearAlerts: () => set({ alerts: [] }),
}));
