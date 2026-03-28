import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ColumnDef {
  id: string;
  label: string;
  shortLabel: string;
  topKey: string;
  bottomKey?: string;
  topLabel: string;
  bottomLabel?: string;
  topDecimals: number;
  bottomDecimals?: number;
  isPrice?: boolean;
}

export const COLUMN_REGISTRY: ColumnDef[] = [
  { id: 'bid', label: 'Bid', shortLabel: 'BID', topKey: 'bid', bottomKey: 'bidSize', topLabel: 'Bid', bottomLabel: 'Size', topDecimals: 2, bottomDecimals: 0, isPrice: true },
  { id: 'ask', label: 'Ask', shortLabel: 'ASK', topKey: 'ask', bottomKey: 'askSize', topLabel: 'Ask', bottomLabel: 'Size', topDecimals: 2, bottomDecimals: 0, isPrice: true },
  { id: 'last', label: 'Last', shortLabel: 'LAST', topKey: 'last', topLabel: 'Last', topDecimals: 2 },
  { id: 'vol', label: 'Volume', shortLabel: 'VOL', topKey: 'volume', bottomKey: 'openInterest', topLabel: 'Vol', bottomLabel: 'OI', topDecimals: 0, bottomDecimals: 0 },
  { id: 'delta', label: 'Delta', shortLabel: 'Δ', topKey: 'delta', topLabel: 'Delta', topDecimals: 3 },
  { id: 'gamma', label: 'Gamma', shortLabel: 'Γ', topKey: 'gamma', topLabel: 'Gamma', topDecimals: 4 },
  { id: 'theta', label: 'Theta', shortLabel: 'Θ', topKey: 'theta', topLabel: 'Theta', topDecimals: 3 },
  { id: 'iv', label: 'IV', shortLabel: 'IV', topKey: 'iv', topLabel: 'IV', topDecimals: 1 },
];

interface OptionsColumnsState {
  activeColumnIds: string[];
  toggleColumn: (id: string) => void;
  reorderColumns: (ids: string[]) => void;
}

export const useOptionsColumnsStore = create<OptionsColumnsState>()(
  persist(
    (set) => ({
      activeColumnIds: ['bid', 'ask', 'vol', 'delta'],
      toggleColumn: (id) =>
        set((state) => {
          const validIds = COLUMN_REGISTRY.map(c => c.id);
          if (!validIds.includes(id)) return state;
          if (state.activeColumnIds.includes(id)) {
            if (state.activeColumnIds.length <= 1) return state;
            return { activeColumnIds: state.activeColumnIds.filter((c) => c !== id) };
          }
          return { activeColumnIds: [...state.activeColumnIds, id] };
        }),
      reorderColumns: (ids) => {
        const validIds = COLUMN_REGISTRY.map(c => c.id);
        const cleaned = [...new Set(ids)].filter(id => validIds.includes(id));
        if (cleaned.length === 0) return;
        set({ activeColumnIds: cleaned });
      },
    }),
    {
      name: 'alpha-options-columns',
      version: 2,
      migrate: () => ({
        activeColumnIds: ['bid', 'ask', 'vol', 'delta'],
      }),
    }
  )
);
