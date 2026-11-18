import {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { LazyViewErrorBoundary } from "@/components/LazyViewErrorBoundary";

type LazyRouteViewProps = {
  viewName: string;
  fallback: ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loader: () => Promise<{ default: ComponentType<any> }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (Component: ComponentType<any>, remountKey: number) => ReactElement;
};

/** Error boundary outside Suspense; new `lazy()` instance each remount so Retry re-fetches chunks. */
export function LazyRouteView({ viewName, fallback, loader, render }: LazyRouteViewProps) {
  const [remountKey, setRemountKey] = useState(0);
  const onRemount = useCallback(() => setRemountKey((k) => k + 1), []);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const LazyComp = useMemo(() => lazy(() => loaderRef.current()), [remountKey]);

  return (
    <LazyViewErrorBoundary viewName={viewName} remountKey={remountKey} onRemount={onRemount}>
      <Suspense fallback={fallback}>{render(LazyComp, remountKey)}</Suspense>
    </LazyViewErrorBoundary>
  );
}