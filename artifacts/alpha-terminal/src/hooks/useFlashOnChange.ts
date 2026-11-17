import { useEffect, useRef, useState } from "react";

/** Brief highlight pulse when a numeric/string value updates (key level tiles). */
export function useFlashOnChange(value: string | number | null, ms = 650): boolean {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prev.current !== value && value != null) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), ms);
      return () => clearTimeout(t);
    }
    prev.current = value;
    return undefined;
  }, [value, ms]);

  return flash;
}