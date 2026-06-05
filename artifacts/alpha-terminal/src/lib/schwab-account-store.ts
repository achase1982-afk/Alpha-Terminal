import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchWithAuth } from "./fetchWithAuth";
import type {
  SchwabAccountSummary,
  SchwabPortfolioPrefs,
  SchwabViewSelection,
} from "./schwab-account-types";
import { schwabAccountsFingerprint } from "./schwabAccountFingerprint";

const LOCAL_KEY = "schwab-account-store";

interface SchwabAccountState {
  /** Account list for picker / order ticket (synced from 1 Hz portfolio poll). */
  accounts: SchwabAccountSummary[];
  accountsFingerprint: string;
  accountsLoadedAt: number | null;
  viewSelection: SchwabViewSelection;
  defaultTradingAccountHash: string | null;
  hideBalances: boolean;
  orderTicketAccountHash: string | null;
  pickerOpen: boolean;

  setPickerOpen: (open: boolean) => void;
  setViewSelection: (sel: SchwabViewSelection) => void;
  setDefaultTradingAccountHash: (hash: string | null) => void;
  setHideBalances: (hide: boolean) => void;
  setOrderTicketAccountHash: (hash: string | null) => void;
  /** Apply accounts from the portfolio poll without redundant store updates. */
  syncAccountsFromStream: (accounts: SchwabAccountSummary[]) => void;
  /** One-shot REST load (picker fallback before first portfolio poll). */
  refreshAccounts: () => Promise<void>;
  loadPreferencesFromServer: () => Promise<void>;
  persistPreferences: () => Promise<void>;
  tradingAccountHash: () => string | null;
  ordersAccountHash: () => string | null;
  headerLabel: () => string;
}

function pickDefaultHash(accounts: SchwabAccountSummary[], current: string | null): string | null {
  if (current && accounts.some((a) => a.hashValue === current)) return current;
  return accounts.find((a) => a.hashValue)?.hashValue ?? null;
}

function applyAccountsList(
  data: SchwabAccountSummary[],
  prev: Pick<SchwabAccountState, "accountsFingerprint" | "defaultTradingAccountHash" | "viewSelection">,
): Partial<SchwabAccountState> | null {
  const fingerprint = schwabAccountsFingerprint(data);
  if (fingerprint === prev.accountsFingerprint) {
    return { accountsLoadedAt: Date.now() };
  }
  const defaultTradingAccountHash = pickDefaultHash(data, prev.defaultTradingAccountHash);
  const viewStillValid =
    prev.viewSelection === "all" || data.some((a) => a.hashValue === prev.viewSelection);
  return {
    accounts: data,
    accountsFingerprint: fingerprint,
    accountsLoadedAt: Date.now(),
    defaultTradingAccountHash,
    viewSelection: viewStillValid ? prev.viewSelection : "all",
  };
}

export const useSchwabAccountStore = create<SchwabAccountState>()(
  persist(
    (set, get) => ({
      accounts: [],
      accountsFingerprint: "",
      accountsLoadedAt: null,
      viewSelection: "all",
      defaultTradingAccountHash: null,
      hideBalances: false,
      orderTicketAccountHash: null,
      pickerOpen: false,

      setPickerOpen: (open) => set({ pickerOpen: open }),
      setViewSelection: (sel) => {
        set({ viewSelection: sel });
        void get().persistPreferences();
      },
      setDefaultTradingAccountHash: (hash) => {
        set({ defaultTradingAccountHash: hash });
        void get().persistPreferences();
      },
      setHideBalances: (hide) => {
        set({ hideBalances: hide });
        void get().persistPreferences();
      },
      setOrderTicketAccountHash: (hash) => set({ orderTicketAccountHash: hash }),

      syncAccountsFromStream: (accounts) => {
        if (!Array.isArray(accounts) || !accounts.length) return;
        set((s) => applyAccountsList(accounts, s) ?? {});
      },

      refreshAccounts: async () => {
        try {
          const res = await fetchWithAuth("/api/portfolio/accounts");
          if (!res.ok) return;
          const data = (await res.json()) as SchwabAccountSummary[];
          if (!Array.isArray(data)) return;
          set((s) => applyAccountsList(data, s) ?? {});
        } catch {
          /* ignore */
        }
      },

      loadPreferencesFromServer: async () => {
        try {
          const res = await fetchWithAuth("/api/portfolio/preferences");
          if (!res.ok) return;
          const prefs = (await res.json()) as SchwabPortfolioPrefs;
          set({
            viewSelection: prefs.viewSelection === "all" ? "all" : prefs.viewSelection,
            defaultTradingAccountHash: prefs.defaultTradingAccountHash,
            hideBalances: !!prefs.hideBalances,
          });
        } catch {
          /* ignore */
        }
      },

      persistPreferences: async () => {
        const { viewSelection, defaultTradingAccountHash, hideBalances } = get();
        try {
          await fetchWithAuth("/api/portfolio/preferences", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              viewSelection,
              defaultTradingAccountHash,
              hideBalances,
            }),
          });
        } catch {
          /* ignore */
        }
      },

      tradingAccountHash: () => {
        const s = get();
        if (s.orderTicketAccountHash) return s.orderTicketAccountHash;
        if (s.viewSelection !== "all") return s.viewSelection;
        return s.defaultTradingAccountHash;
      },

      ordersAccountHash: () => {
        const s = get();
        if (s.viewSelection !== "all") return s.viewSelection;
        return s.defaultTradingAccountHash;
      },

      headerLabel: () => {
        const { viewSelection, accounts } = get();
        if (viewSelection === "all") return "All Accounts";
        const acct = accounts.find((a) => a.hashValue === viewSelection);
        if (!acct) return "Account";
        return `${acct.accountNumber} ${acct.type}`;
      },
    }),
    {
      name: LOCAL_KEY,
      partialize: (s) => ({
        viewSelection: s.viewSelection,
        defaultTradingAccountHash: s.defaultTradingAccountHash,
        hideBalances: s.hideBalances,
      }),
    },
  ),
);
