import { useState, useEffect } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export function useIsTablet(): boolean {
  return useMediaQuery("(min-width: 768px)");
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

/** Large desktop: 1536px+ (Tailwind 2xl). Use for denser grids and wider panels. */
export function useIsWide(): boolean {
  return useMediaQuery("(min-width: 1536px)");
}

/** Ultrawide: 1920px+. Use for extra rails/columns that only make sense on very large monitors. */
export function useIsUltrawide(): boolean {
  return useMediaQuery("(min-width: 1920px)");
}
