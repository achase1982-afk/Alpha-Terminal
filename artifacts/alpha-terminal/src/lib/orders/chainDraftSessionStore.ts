import { create } from "zustand";

/** Serializable chain leg — survives Options tab unmount (Portfolio chunk errors, etc.). */
export type ChainDraftStoredLeg = {
  key: string;
  contract: Record<string, unknown>;
  type: "CALL" | "PUT";
  expiration: string;
  side: "bid" | "ask";
};

export type ChainDraftSheetSession = {
  limitPrice: string;
  limitLocked: boolean;
};

type ChainDraftSessionState = {
  symbol: string | null;
  selectedLegs: ChainDraftStoredLeg[];
  legQuantities: Record<string, number>;
  chainTicketOpen: boolean;
  sheetCollapsed: boolean;
  sheet: ChainDraftSheetSession;
  setDraft: (
    symbol: string,
    patch: Partial<
      Pick<ChainDraftSessionState, "selectedLegs" | "legQuantities" | "chainTicketOpen" | "sheetCollapsed" | "sheet">
    >,
  ) => void;
  setSheetSession: (sheet: Partial<ChainDraftSheetSession>) => void;
  clear: () => void;
  hasActiveDraft: () => boolean;
};

const EMPTY_SHEET: ChainDraftSheetSession = { limitPrice: "", limitLocked: false };

export const useChainDraftSessionStore = create<ChainDraftSessionState>((set, get) => ({
  symbol: null,
  selectedLegs: [],
  legQuantities: {},
  chainTicketOpen: false,
  sheetCollapsed: true,
  sheet: { ...EMPTY_SHEET },
  setDraft: (symbol, patch) =>
    set((state) => ({
      symbol,
      selectedLegs: patch.selectedLegs ?? state.selectedLegs,
      legQuantities: patch.legQuantities ?? state.legQuantities,
      chainTicketOpen: patch.chainTicketOpen ?? state.chainTicketOpen,
      sheetCollapsed: patch.sheetCollapsed ?? state.sheetCollapsed,
      sheet: patch.sheet ?? state.sheet,
    })),
  setSheetSession: (sheet) =>
    set((state) => ({
      sheet: { ...state.sheet, ...sheet },
    })),
  clear: () =>
    set({
      symbol: null,
      selectedLegs: [],
      legQuantities: {},
      chainTicketOpen: false,
      sheetCollapsed: true,
      sheet: { ...EMPTY_SHEET },
    }),
  hasActiveDraft: () => get().selectedLegs.length > 0,
}));

function publishDraftSnapshot(getState: () => ChainDraftSessionState) {
  if (typeof window === "undefined") return;
  window.__AT_CHAIN_DRAFT_SNAPSHOT = () => {
    const s = getState();
    return {
      symbol: s.symbol,
      legs: s.selectedLegs,
      legQuantities: s.legQuantities,
      chainTicketOpen: s.chainTicketOpen,
      sheet: s.sheet,
    };
  };
}

declare global {
  interface Window {
    __AT_CHAIN_DRAFT_SNAPSHOT?: () => {
      symbol: string | null;
      legs: ChainDraftStoredLeg[];
      legQuantities: Record<string, number>;
      chainTicketOpen: boolean;
      sheet: ChainDraftSheetSession;
    };
  }
}

useChainDraftSessionStore.subscribe(() => {
  publishDraftSnapshot(useChainDraftSessionStore.getState);
});
publishDraftSnapshot(() => useChainDraftSessionStore.getState());