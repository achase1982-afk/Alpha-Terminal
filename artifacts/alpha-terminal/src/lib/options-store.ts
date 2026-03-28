import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ContractType = 'ALL' | 'CALL' | 'PUT';

interface OptionsSettingsState {
  contractType: ContractType;
  setContractType: (t: ContractType) => void;
  strikeCount: number;
  setStrikeCount: (n: number) => void;
  maxDte: number;
  setMaxDte: (n: number) => void;
  customStrikeInput: string;
  setCustomStrikeInput: (v: string) => void;
}

export const useOptionsSettingsStore = create<OptionsSettingsState>()(
  persist(
    (set) => ({
      contractType: 'ALL',
      setContractType: (contractType) => set({ contractType }),
      strikeCount: 10,
      setStrikeCount: (strikeCount) => set({ strikeCount: strikeCount % 2 !== 0 ? strikeCount + 1 : strikeCount }),
      maxDte: 30,
      setMaxDte: (maxDte) => set({ maxDte }),
      customStrikeInput: '',
      setCustomStrikeInput: (customStrikeInput) => set({ customStrikeInput }),
    }),
    {
      name: 'alpha-options-settings',
      version: 1,
    }
  )
);
