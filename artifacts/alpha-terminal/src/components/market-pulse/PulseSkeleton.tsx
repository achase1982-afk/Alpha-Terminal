function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={`rounded bg-[#2A2A2C]/50 animate-pulse ${className ?? ""}`}
    />
  );
}

export function PulseSkeleton() {
  return (
    <div className="space-y-4 animate-in fade-in">
      <Shimmer className="h-12 w-full rounded-xl" />

      <Shimmer className="h-20 w-full rounded-xl" />

      <Shimmer className="h-5 w-32 rounded" />

      <div className="flex gap-3 overflow-x-auto pb-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[#2A2A2C] p-4 space-y-3 shrink-0"
            style={{ background: "#111113", width: 220 }}
          >
            <div className="flex items-center gap-2">
              <Shimmer className="w-4 h-4 rounded" />
              <Shimmer className="h-4 w-20" />
              <Shimmer className="h-5 w-12 rounded-full ml-auto" />
            </div>
            <Shimmer className="h-3 w-full" />
            <div className="space-y-1">
              <Shimmer className="h-3 w-3/4" />
              <Shimmer className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>

      <Shimmer className="h-28 w-full rounded-xl" />

      <Shimmer className="h-20 w-full rounded-xl" />

      <Shimmer className="h-16 w-full rounded-xl" />
    </div>
  );
}
