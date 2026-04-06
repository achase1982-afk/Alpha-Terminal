import { create } from "zustand";

export interface DepthRow {
  price: number;
  size: number;
  mm: string;
}

export interface DepthBook {
  symbol: string;
  bids: DepthRow[];
  asks: DepthRow[];
  ts: number;
}

interface DepthState {
  books: Record<string, DepthBook>;
  setBook: (book: DepthBook) => void;
  setBooks: (books: DepthBook[]) => void;
}

export const useDepthStore = create<DepthState>((set) => ({
  books: {},
  setBook: (book) =>
    set((state) => ({
      books: { ...state.books, [book.symbol]: book },
    })),
  setBooks: (books) =>
    set((state) => {
      const next = { ...state.books };
      for (const b of books) next[b.symbol] = b;
      return { books: next };
    }),
}));
