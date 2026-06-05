import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchWithAuth } from "./fetchWithAuth";
import type {
  SchwabAccountSummary,
  SchwabPortfolioPrefs,
  SchwabViewSelection,
} from "./schwab-account-types";
import { aggregateSchwabAccounts } from "./schwabAccountAggregate";
import { schwabAccountsFingerprint } from "./schwabAccountFingerprint";

const LOCAL_KEY = "schwab-account-store";

interface SchwabAccountState {
  accounts: SchwabAccountSummary[];
  /** Bumped only when account payloads meaningfully change (avoids portfolio table re-renders). */
  accountsRevision: number;
  accountsFingerprint: string;
  accountsLoadedAt: number | null;
  viewSelection: SchwabViewSelection;
  defaultTradingAccountHash: string | null;
  hideBalances: boolean;
  /** Order ticket override (hash); null = use trading hash from prefs/view */
  orderTicketAccountHash: string | null;
  pickerOpen: boolean;

  setPickerOpen: (open: boolean) => void;
  setViewSelection: (sel: SchwabViewSelection) => void;
  setDefaultTradingAccountHash: (hash: string | null) => void;
  setHideBalances: (hide: boolean) => void;
  setOrderTicketAccountHash: (hash: string | null) => void;
  refreshAccounts: () => Promise<void>;
  loadPreferencesFromServer: () => Promise<void>;
  persistPreferences: () => Promise<void>;
  tradingAccountHash: () => string | null;
  ordersAccountHash: () => string | null;
  displayAccount: () => SchwabAccountSummary | null;
  headerLabel: () => string;
}

function pickDefaultHash(accounts: SchwabAccountSummary[], current: string | null): string | null {
  if (current && accounts.some((a) => a.hashValue === current)) return current;
  return accounts.find((a) => a.hashValue)?.hashValue ?? null;
}

export const useSchwabAccountStore = create<SchwabAccountState>()(
  persist(
    (set, get) => ({
      accounts: [],
      accountsRevision: 0,
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

      refreshAccounts: async () => {
        try {
          const res = await fetchWithAuth("/api/portfolio/accounts");
          if (!res.ok) return;
          const data = (await res.json()) as SchwabAccountSummary[];
          if (!Array.isArray(data)) return;
          const fingerprint = schwabAccountsFingerprint(data);
          set((s) => {
            const defaultTradingAccountHash = pickDefaultHash(data, s.defaultTradingAccountHash);
            const viewStillValid =
              s.viewSelection === "all" ||
              data.some((a) => a.hashValue === s.viewSelection);
            const unchanged = fingerprint === s.accountsFingerprint;
            return {
              accounts: data,
              accountsFingerprint: fingerprint,
              accountsRevision: unchanged ? s.accountsRevision : s.accountsRevision + 1,
              accountsLoadedAt: Date.now(),
              defaultTradingAccountHash,
              viewSelection: viewStillValid ? s.viewSelection : "all",
            };
          });
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

      displayAccount: () => {
        const { accounts, viewSelection } = get();
        if (!accounts.length) return null;
        if (viewSelection === "all") return aggregateSchwabAccounts(accounts);
        return accounts.find((a) => a.hashValue === viewSelection) ?? accounts[0] ?? null;
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
