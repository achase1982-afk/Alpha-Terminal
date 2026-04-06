import type { LevelToWatch } from "../../types/marketPulse";

interface LevelsToWatchProps {
  levels: LevelToWatch[];
}

export function LevelsToWatch({ levels }: LevelsToWatchProps) {
  if (!levels.length) return null;

  return (
    <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
      <div className="px-4 py-2" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <span className="font-mono text-[10px] font-bold text-[#fbbf24] tracking-widest">LEVELS TO WATCH</span>
      </div>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: "1px solid #1a1a1a" }}>
            <th className="font-mono text-[8px] text-[#3f3f46] uppercase tracking-widest text-left pl-4 pr-2 py-1">Symbol</th>
            <th className="font-mono text-[8px] text-[#3f3f46] uppercase tracking-widest text-right px-2 py-1">Level</th>
            <th className="font-mono text-[8px] text-[#3f3f46] uppercase tracking-widest text-center px-2 py-1">Dir</th>
            <th className="font-mono text-[8px] text-[#3f3f46] uppercase tracking-widest text-left pl-2 pr-4 py-1">Significance</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((lvl, i) => (
            <tr key={i} className="border-b border-[#111] hover:bg-[#0a0a0a]">
              <td className="pl-4 pr-2 py-1">
                <span className="font-mono text-[10px] font-bold text-[#d4d4d8] tabular-nums">{lvl.symbol}</span>
              </td>
              <td className="px-2 py-1 text-right">
                <span className="font-mono text-[10px] font-bold text-[#fbbf24] tabular-nums">
                  {typeof lvl.level === "number" ? lvl.level.toFixed(2) : lvl.level}
                </span>
              </td>
              <td className="px-2 py-1 text-center">
                <span className="font-mono text-[9px] font-bold" style={{ color: lvl.direction === "ABOVE" ? "#ef4444" : "#22c55e" }}>
                  {lvl.direction}
                </span>
              </td>
              <td className="pl-2 pr-4 py-1">
                <span className="font-mono text-[9px] text-[#52525b]">{lvl.significance}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
