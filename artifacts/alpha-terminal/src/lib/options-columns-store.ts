import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ColumnDef {
  id: string;
  label: string;
  shortLabel: string;
  stacked: boolean;
  topKey: string;
  bottomKey?: string;
  topLabel: string;
  bottomLabel?: string;
  decimals: number;
}

export const COLUMN_REGISTRY: ColumnDef[] = [
  { id: 'bidAsk', label: 'Bid / Ask', shortLabel: 'B/A', stacked: true, topKey: 'bid', bottomKey: 'ask', topLabel: 'Bid', bottomLabel: 'Ask', decimals: 2 },
  { id: 'volOi', label: 'Vol / OI', shortLabel: 'V/OI', stacked: true, topKey: 'volume', bottomKey: 'openInterest', topLabel: 'Vol', bottomLabel: 'OI', decimals: 0 },
  { id: 'delta', label: 'Delta', shortLabel: 'Δ', stacked: false, topKey: 'delta', topLabel: 'Delta', decimals: 3 },
  { id: 'gamma', label: 'Gamma', shortLabel: 'Γ', stacked: false, topKey: 'gamma', topLabel: 'Gamma', decimals: 4 },
  { id: 'theta', label: 'Theta', shortLabel: 'Θ', stacked: false, topKey: 'theta', topLabel: 'Theta', decimals: 3 },
  { id: 'probOtm', label: 'Prob OTM', shortLabel: '%OTM', stacked: false, topKey: 'probOtm', topLabel: '%OTM', decimals: 1 },
];

interface OptionsColumnsState {
  activeColumnIds: string[];
  toggleColumn: (id: string) => void;
  reorderColumns: (ids: string[]) => void;
}

export const useOptionsColumnsStore = create<OptionsColumnsState>()(
  persist(
    (set) => ({
      activeColumnIds: ['bidAsk', 'volOi', 'delta'],
      toggleColumn: (id) =>
        set((state) => {
          if (state.activeColumnIds.includes(id)) {
            if (state.activeColumnIds.length <= 1) return state;
            return { activeColumnIds: state.activeColumnIds.filter((c) => c !== id) };
          }
          return { activeColumnIds: [...state.activeColumnIds, id] };
        }),
      reorderColumns: (ids) => set({ activeColumnIds: ids }),
    }),
    {
      name: 'alpha-options-columns',
      version: 1,
    }
  )
);
