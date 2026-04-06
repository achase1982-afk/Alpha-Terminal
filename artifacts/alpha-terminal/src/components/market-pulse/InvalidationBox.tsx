interface InvalidationBoxProps {
  conditions: string[];
}

export function InvalidationBox({ conditions }: InvalidationBoxProps) {
  if (!conditions.length) return null;

  return (
    <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/50">
        <span className="font-mono text-xs font-bold text-[#f23645] tracking-wider">INVALIDATION</span>
      </div>
      <div className="px-4 py-3 space-y-2">
        {conditions.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="font-mono text-xs text-[#f23645] mt-px shrink-0 font-bold">✕</span>
            <span className="font-mono text-[12px] text-zinc-300 leading-snug">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
