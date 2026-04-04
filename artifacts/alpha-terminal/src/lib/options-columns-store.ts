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
  group?: string;
}

export const COLUMN_REGISTRY: ColumnDef[] = [
  { id: 'bid', label: 'Bid', shortLabel: 'BID', topKey: 'bid', bottomKey: 'bidSize', topLabel: 'Bid', bottomLabel: 'Sz', topDecimals: 2, bottomDecimals: 0, isPrice: true, group: 'Price' },
  { id: 'ask', label: 'Ask', shortLabel: 'ASK', topKey: 'ask', bottomKey: 'askSize', topLabel: 'Ask', bottomLabel: 'Sz', topDecimals: 2, bottomDecimals: 0, isPrice: true, group: 'Price' },
  { id: 'last', label: 'Last', shortLabel: 'LAST', topKey: 'last', topLabel: 'Last', topDecimals: 2, group: 'Price' },
  { id: 'vol', label: 'Volume', shortLabel: 'VOL', topKey: 'volume', topLabel: 'Vol', topDecimals: 0, group: 'Flow' },
  { id: 'oi', label: 'Open Int', shortLabel: 'OI', topKey: 'openInterest', topLabel: 'OI', topDecimals: 0, group: 'Flow' },
  { id: 'delta', label: 'Delta', shortLabel: '\u0394', topKey: 'delta', topLabel: '\u0394', topDecimals: 3, group: 'Greeks' },
  { id: 'gamma', label: 'Gamma', shortLabel: '\u0393', topKey: 'gamma', topLabel: '\u0393', topDecimals: 4, group: 'Greeks' },
  { id: 'theta', label: 'Theta', shortLabel: '\u0398', topKey: 'theta', topLabel: '\u0398', topDecimals: 3, group: 'Greeks' },
  { id: 'vega', label: 'Vega', shortLabel: 'V', topKey: 'vega', topLabel: 'V', topDecimals: 3, group: 'Greeks' },
  { id: 'iv', label: 'IV', shortLabel: 'IV', topKey: 'iv', topLabel: 'IV%', topDecimals: 1, group: 'Vol' },
];

interface OptionsColumnsState {
  activeColumnIds: string[];
  toggleColumn: (id: string) => void;
  reorderColumns: (ids: string[]) => void;
}

export const useOptionsColumnsStore = create<OptionsColumnsState>()(
  persist(
    (set) => ({
      activeColumnIds: ['bid', 'ask', 'vol', 'oi'],
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
      version: 3,
      migrate: () => ({
        activeColumnIds: ['bid', 'ask', 'vol', 'oi'],
      }),
    }
  )
);
