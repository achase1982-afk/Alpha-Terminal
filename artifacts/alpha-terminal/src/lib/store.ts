import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface TerminalState {
  // Auth
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  clearTokens: () => void;

  // Market Configuration
  symbol: string;
  setSymbol: (s: string) => void;
  
  timeframe: string;
  setTimeframe: (t: string) => void;
  
  overlays: {
    sma20: boolean;
    sma50: boolean;
    bb: boolean;
    rsi: boolean;
    volume: boolean;
  };
  toggleOverlay: (overlay: keyof TerminalState['overlays']) => void;

  // AI Configuration
  aiModel: string;
  setAiModel: (m: string) => void;
  aiTemp: number;
  setAiTemp: (t: number) => void;
  
  // AI Chat
  chatHistory: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      // Auth
      accessToken: null,
      refreshToken: null,
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      clearTokens: () => set({ accessToken: null, refreshToken: null }),

      // Market
      symbol: 'AAPL',
      setSymbol: (symbol) => set({ symbol: symbol.toUpperCase() }),
      
      timeframe: '3M',
      setTimeframe: (timeframe) => set({ timeframe }),
      
      overlays: {
        sma20: true,
        sma50: true,
        bb: false,
        rsi: false,
        volume: true,
      },
      toggleOverlay: (overlay) => set((state) => ({ 
        overlays: { ...state.overlays, [overlay]: !state.overlays[overlay] } 
      })),

      // AI
      aiModel: 'gemini-2.5-pro',
      setAiModel: (aiModel) => set({ aiModel }),
      aiTemp: 0.7,
      setAiTemp: (aiTemp) => set({ aiTemp }),

      // Chat
      chatHistory: [],
      addChatMessage: (msg) => set((state) => ({ chatHistory: [...state.chatHistory, msg] })),
      clearChat: () => set({ chatHistory: [] }),
    }),
    {
      name: 'alpha-terminal-storage',
    }
  )
);
