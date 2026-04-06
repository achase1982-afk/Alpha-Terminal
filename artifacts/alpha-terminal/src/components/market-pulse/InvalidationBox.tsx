interface InvalidationBoxProps {
  conditions: string[];
}

export function InvalidationBox({ conditions }: InvalidationBoxProps) {
  if (!conditions.length) return null;

  return (
    <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
      <div className="px-4 py-2" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <span className="font-mono text-[10px] font-bold text-[#ef4444] tracking-widest">INVALIDATION</span>
      </div>
      <div className="px-4 py-2.5 space-y-1">
        {conditions.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="font-mono text-[10px] text-[#ef4444] mt-px shrink-0">x</span>
            <span className="font-mono text-[10px] text-[#a1a1aa] leading-[1.5]">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
