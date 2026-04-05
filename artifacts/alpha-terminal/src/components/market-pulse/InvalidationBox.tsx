import { AlertTriangle } from "lucide-react";

interface InvalidationBoxProps {
  conditions: string[];
}

export function InvalidationBox({ conditions }: InvalidationBoxProps) {
  if (!conditions.length) return null;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: "rgba(242,54,69,0.3)", background: "rgba(242,54,69,0.04)" }}
    >
      <div
        className="px-4 py-2.5 border-b flex items-center gap-2"
        style={{ borderColor: "rgba(242,54,69,0.2)", background: "rgba(242,54,69,0.06)" }}
      >
        <AlertTriangle className="w-3.5 h-3.5 text-[#f23645]" />
        <span className="font-mono text-xs font-bold text-[#f23645] tracking-wider">INVALIDATION</span>
      </div>
      <div className="p-4 space-y-1.5">
        {conditions.map((c, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="font-mono text-[10px] text-[#f23645] mt-0.5 shrink-0">✕</span>
            <span className="font-sans text-xs text-[#a1a1aa]">{c}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
