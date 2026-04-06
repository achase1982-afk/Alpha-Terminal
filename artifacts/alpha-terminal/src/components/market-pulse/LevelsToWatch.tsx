import type { LevelToWatch } from "../../types/marketPulse";

interface LevelsToWatchProps {
  levels: LevelToWatch[];
}

export function LevelsToWatch({ levels }: LevelsToWatchProps) {
  if (!levels.length) return null;

  return (
    <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/50">
        <span className="font-mono text-xs font-bold text-[#FFB800] tracking-wider">LEVELS TO WATCH</span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-zinc-800/50">
            <th className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider text-left pl-4 pr-2 py-2">Symbol</th>
            <th className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider text-right px-2 py-2">Level</th>
            <th className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider text-center px-2 py-2">Dir</th>
            <th className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider text-left pl-2 pr-4 py-2">Significance</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((lvl, i) => (
            <tr key={i} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
              <td className="pl-4 pr-2 py-2">
                <span className="font-mono text-sm font-bold text-zinc-200 tabular-nums">{lvl.symbol}</span>
              </td>
              <td className="px-2 py-2 text-right">
                <span className="font-mono text-sm font-bold text-[#FFB800] tabular-nums">
                  {typeof lvl.level === "number" ? lvl.level.toFixed(2) : lvl.level}
                </span>
              </td>
              <td className="px-2 py-2 text-center">
                <span className="font-mono text-xs font-bold" style={{ color: lvl.direction === "ABOVE" ? "#f23645" : "#00d166" }}>
                  {lvl.direction}
                </span>
              </td>
              <td className="pl-2 pr-4 py-2">
                <span className="font-mono text-[12px] text-zinc-400">{lvl.significance}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
