import { useRef } from "react";

const UP_COLOR   = "#00d166";
const DOWN_COLOR = "#f23645";
const FLAT_COLOR = "#e4e4e7";

export function useTickColor(symbol: string, currentPrice: number | null): string {
  const prevRef = useRef<{ symbol: string; price: number | null; tickColor: string }>({
    symbol: "",
    price: null,
    tickColor: FLAT_COLOR,
  });

  if (symbol !== prevRef.current.symbol) {
    prevRef.current = { symbol, price: null, tickColor: FLAT_COLOR };
  }

  if (currentPrice != null && prevRef.current.price != null) {
    if (currentPrice > prevRef.current.price) {
      prevRef.current.tickColor = UP_COLOR;
    } else if (currentPrice < prevRef.current.price) {
      prevRef.current.tickColor = DOWN_COLOR;
    }
  }

  prevRef.current.price = currentPrice;
  return prevRef.current.tickColor;
}
