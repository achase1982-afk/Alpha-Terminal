import {
  Suspense,
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { LazyViewErrorBoundary } from "@/components/LazyViewErrorBoundary";

type LazyRouteViewProps = {
  viewName: string;
  fallback: ReactNode;
  children: (remountKey: number) => ReactElement;
};

/** Error boundary outside Suspense so failed dynamic imports stay scoped. */
export function LazyRouteView({ viewName, fallback, children }: LazyRouteViewProps) {
  const [remountKey, setRemountKey] = useState(0);
  const onRemount = useCallback(() => setRemountKey((k) => k + 1), []);

  return (
    <LazyViewErrorBoundary viewName={viewName} remountKey={remountKey} onRemount={onRemount}>
      <Suspense fallback={fallback}>{children(remountKey)}</Suspense>
    </LazyViewErrorBoundary>
  );
}