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
      <div className="flex items-center gap-3">
        <Shimmer className="w-6 h-6 rounded-lg" />
        <div className="space-y-1.5 flex-1">
          <Shimmer className="h-4 w-48" />
          <Shimmer className="h-3 w-32" />
        </div>
      </div>

      <Shimmer className="h-16 w-full rounded-xl" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[#2A2A2C] p-4 space-y-3"
            style={{ background: "#111113" }}
          >
            <div className="flex items-center gap-2">
              <Shimmer className="w-4 h-4 rounded" />
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-5 w-14 rounded-full ml-auto" />
            </div>
            <Shimmer className="h-10 w-full" />
            <div className="space-y-1.5">
              <Shimmer className="h-3 w-full" />
              <Shimmer className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>

      <Shimmer className="h-32 w-full rounded-xl" />
      <Shimmer className="h-20 w-full rounded-xl" />
    </div>
  );
}
