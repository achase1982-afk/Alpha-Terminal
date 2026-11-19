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
const EQUITY_TIME_ZONE = "America/New_York";

function equitySessionDate(ts: number): string {
  const date = new Date(Number.isFinite(ts) && ts > 0 ? ts : Date.now());
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EQUITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((out, part) => {
      if (part.type !== "literal") out[part.type] = part.value;
      return out;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

interface EquityTapeState {
  books: Record<string, VenueBooks>;
  prints: Record<string, EquityTapePrint[]>;
  /** Accumulated traded shares per price (price key -> shares) for today's session, per symbol. */
  volumeByPrice: Record<string, Record<string, number>>;
  volumeSessionBySymbol: Record<string, string>;
  pushBook: (msg: {
    symbol: string;
    venue: EquityTapeVenue;
    bids: EquityTapeLevel[];
    asks: EquityTapeLevel[];
    ts: number;
  }) => void;
  pushPrint: (msg: { symbol: string; price: number; size: number; ts: number }) => void;
  seedVolumeProfile: (msg: {
    symbol: string;
    sessionDate: string;
    volumeByPrice: Record<string, number>;
  }) => void;
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
        let volumeByPrice = state.volumeByPrice;
        let volumeSessionBySymbol = state.volumeSessionBySymbol;
        if (printBatch.size > 0) {
          prints = { ...state.prints };
          volumeByPrice = { ...state.volumeByPrice };
          volumeSessionBySymbol = { ...state.volumeSessionBySymbol };
          const now = Date.now();
          for (const [sym, incoming] of printBatch) {
            const kept = (prints[sym] ?? []).concat(incoming).filter((p) => now - p.ts <= PRINT_WINDOW_MS);
            prints[sym] = kept.length > MAX_PRINTS ? kept.slice(-MAX_PRINTS) : kept;
            const latestSession = equitySessionDate(incoming[incoming.length - 1]?.ts ?? now);
            const accum =
              volumeSessionBySymbol[sym] === latestSession
                ? { ...(volumeByPrice[sym] ?? {}) }
                : {};
            for (const p of incoming) {
              if (equitySessionDate(p.ts) !== latestSession) continue;
              const key = p.price.toFixed(2);
              accum[key] = (accum[key] ?? 0) + p.size;
            }
            volumeByPrice[sym] = accum;
            volumeSessionBySymbol[sym] = latestSession;
          }
        }
        return { books, prints, volumeByPrice, volumeSessionBySymbol };
      });
    }, FLUSH_MS);
  };

  return {
    books: {},
    prints: {},
    volumeByPrice: {},
    volumeSessionBySymbol: {},
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
    seedVolumeProfile: (msg) => {
      const sym = msg.symbol.trim().toUpperCase();
      if (!sym || !/^\d{4}-\d{2}-\d{2}$/.test(msg.sessionDate)) return;
      set((state) => {
        const next =
          state.volumeSessionBySymbol[sym] === msg.sessionDate
            ? { ...(state.volumeByPrice[sym] ?? {}) }
            : {};
        for (const [price, size] of Object.entries(msg.volumeByPrice)) {
          if (!(Number(price) > 0) || !(size > 0) || !Number.isFinite(size)) continue;
          const key = Number(price).toFixed(2);
          next[key] = Math.max(next[key] ?? 0, size);
        }
        return {
          volumeByPrice: { ...state.volumeByPrice, [sym]: next },
          volumeSessionBySymbol: {
            ...state.volumeSessionBySymbol,
            [sym]: msg.sessionDate,
          },
        };
      });
    },
  };
});
