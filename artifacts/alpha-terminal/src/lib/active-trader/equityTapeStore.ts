import { create } from "zustand";

export type EquityTapeLevel = { price: number; size: number };

export type EquityTapeVenue = "NYSE" | "NASDAQ";

export type EquityTapeBook = {
  bids: EquityTapeLevel[];
  asks: EquityTapeLevel[];
  ts: number;
};

export type EquityTapePrint = { price: number; size: number; ts: number };

type VenueBooks = Partial<Record<EquityTapeVenue, EquityTapeBook>>;

const PRINT_WINDOW_MS = 30_000;
const FLUSH_MS = 100;
const MAX_PRINTS = 800;

interface EquityTapeState {
  books: Record<string, VenueBooks>;
  prints: Record<string, EquityTapePrint[]>;
  pushBook: (msg: {
    symbol: string;
    venue: EquityTapeVenue;
    bids: EquityTapeLevel[];
    asks: EquityTapeLevel[];
    ts: number;
  }) => void;
  pushPrint: (msg: { symbol: string; price: number; size: number; ts: number }) => void;
}

let pendingBooks = new Map<string, VenueBooks>();
let pendingPrints = new Map<string, EquityTapePrint[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function levels(rows: EquityTapeLevel[]): EquityTapeLevel[] {
  const out: EquityTapeLevel[] = [];
  for (const row of rows) {
    if (!(row.price > 0) || !(row.size > 0)) continue;
    if (!Number.isFinite(row.price) || !Number.isFinite(row.size)) continue;
    out.push({ price: row.price, size: row.size });
  }
  return out;
}

export const useEquityTapeStore = create<EquityTapeState>((set) => {
  const arm = () => {
    if (flushTimer != null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const bookBatch = pendingBooks;
      const printBatch = pendingPrints;
      pendingBooks = new Map();
      pendingPrints = new Map();
      if (bookBatch.size === 0 && printBatch.size === 0) return;
      set((state) => {
        let books = state.books;
        let prints = state.prints;
        if (bookBatch.size > 0) {
          books = { ...state.books };
          for (const [sym, incoming] of bookBatch) {
            books[sym] = { ...books[sym], ...incoming };
          }
        }
        if (printBatch.size > 0) {
          prints = { ...state.prints };
          const now = Date.now();
          for (const [sym, incoming] of printBatch) {
            const kept = (prints[sym] ?? []).concat(incoming).filter((p) => now - p.ts <= PRINT_WINDOW_MS);
            prints[sym] = kept.length > MAX_PRINTS ? kept.slice(-MAX_PRINTS) : kept;
          }
        }
        return { books, prints };
      });
    }, FLUSH_MS);
  };

  return {
    books: {},
    prints: {},
    pushBook: (msg) => {
      const sym = msg.symbol.toUpperCase();
      const prev = pendingBooks.get(sym) ?? {};
      pendingBooks.set(sym, {
        ...prev,
        [msg.venue]: {
          bids: levels(msg.bids),
          asks: levels(msg.asks),
          ts: msg.ts,
        },
      });
      arm();
    },
    pushPrint: (msg) => {
      if (!(msg.price > 0) || !(msg.size > 0)) return;
      if (!Number.isFinite(msg.price) || !Number.isFinite(msg.size)) return;
      const sym = msg.symbol.toUpperCase();
      const prev = pendingPrints.get(sym) ?? [];
      prev.push({ price: msg.price, size: msg.size, ts: msg.ts });
      pendingPrints.set(sym, prev);
      arm();
    },
  };
});
