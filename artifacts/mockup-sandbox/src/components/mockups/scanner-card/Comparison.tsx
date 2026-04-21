import { useState } from "react";
import { ChevronDown, Send, Info } from "lucide-react";

const FIXTURE = {
  symbol: "UNH",
  rank: 3,
  score: 96.7,
  skew: "bullish" as const,
  unusualStrikeCount: 9,
  unusualCallStrikes: 6,
  unusualPutStrikes: 3,
  unusualTotalVolume: 35200,
  unusualTotalNotional: 12_990_000,
  unusualCallVolume: 28000,
  unusualPutVolume: 7200,
  totalCallVolume: 71575,
  totalPutVolume: 40060,
  putCallVolumeRatio: 0.56,
  topVoiRatio: 59.3,
  avgDte: 12,
  livePrice: 347.4,
  asOfDate: "2026-04-21",
  asOfTime: "11:24 AM ET",
  exec: { sweepCount: 0, blockCount: 7, regularCount: 0 },
  scoreBreakdown: {
    strikeCount: 40,
    voi: 17.8,
    skewScore: 10,
    notional: 16.9,
    tenor: 0,
    execution: 12,
  },
  topByVoiRatio: [
    { optionType: "put" as const, strike: 355, expiration: "2026-04-24", expShort: "Apr 24", dte: 3, volume: 593, openInterest: 10, volOiRatio: 59.3 },
    { optionType: "call" as const, strike: 350, expiration: "2026-05-16", expShort: "May 16", dte: 25, volume: 4210, openInterest: 188, volOiRatio: 22.4 },
    { optionType: "call" as const, strike: 360, expiration: "2026-04-24", expShort: "Apr 24", dte: 3, volume: 1820, openInterest: 121, volOiRatio: 15.0 },
    { optionType: "call" as const, strike: 345, expiration: "2026-06-20", expShort: "Jun 20", dte: 60, volume: 7900, openInterest: 612, volOiRatio: 12.9 },
  ],
};

function fmtCompactInt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function fmtMoney(n: number) {
  if (n >= 1_000_000_000) return "$" + (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "k";
  return "$" + n.toFixed(0);
}

function OldStatusBar() {
  return (
    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 px-3 py-2 border border-zinc-800 rounded bg-[#0a0a0a]">
      130 SCANNED | 122 WITH FLOW DATA | 15 MATCHED FILTERSas of 2026-04-21
    </div>
  );
}

function NewStatusBar() {
  return (
    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 px-3 py-2 border border-zinc-800 rounded bg-[#0a0a0a] flex items-center gap-x-5 gap-y-1 flex-wrap">
      <span><span className="text-zinc-500">scanned</span> <span className="text-zinc-200">130</span></span>
      <span><span className="text-zinc-500">with flow data</span> <span className="text-zinc-200">122</span></span>
      <span><span className="text-zinc-500">matched filters</span> <span className="text-[#FFB800]">15</span></span>
      <span className="ml-auto text-zinc-500 normal-case tracking-normal">as of {FIXTURE.asOfDate} {FIXTURE.asOfTime}</span>
    </div>
  );
}

function OldCard() {
  const [expanded, setExpanded] = useState(true);
  const c = FIXTURE;
  const skewColor = "#26a69a";
  const scoreColor = "#66e0ff";
  return (
    <div className="bg-card border border-zinc-800 rounded-lg overflow-hidden">
      <div onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left cursor-pointer"
        style={{ background: "#0c0c0c" }}>
        <span className="text-[11px] font-bold tabular-nums w-5 text-zinc-600 shrink-0">#{c.rank}</span>
        <span className="font-bold text-[13px] tracking-wider shrink-0" style={{ color: scoreColor }}>{c.symbol}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ color: skewColor, background: `${skewColor}1a`, border: `1px solid ${skewColor}40` }}>
          BULLISH
        </span>
        <span className="text-[10px] text-zinc-500 font-mono tabular-nums shrink-0">{c.unusualStrikeCount} strk</span>
        <span className="text-[10px] text-zinc-400 font-mono tabular-nums shrink-0">{fmtCompactInt(c.unusualTotalVolume)} ct</span>
        <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: "#FFB800" }}>{fmtMoney(c.unusualTotalNotional)}</span>
        <span className="text-[10px] font-mono tabular-nums shrink-0 px-1.5 py-0.5 rounded"
          style={{ color: "#FFB800", background: "rgba(255,184,0,0.08)", border: "1px solid rgba(255,184,0,0.25)" }}>
          {c.exec.sweepCount}s/{c.exec.blockCount}b
        </span>
        <span className="text-[10px] text-zinc-600 font-mono tabular-nums shrink-0">{c.avgDte}d</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono tabular-nums text-zinc-400">${c.livePrice.toFixed(2)}</span>
          <span className="text-[11px] font-mono tabular-nums text-zinc-500">{c.topVoiRatio.toFixed(1)}×</span>
          <span className="text-[12px] font-bold font-mono tabular-nums" style={{ color: scoreColor }}>{c.score.toFixed(0)}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
        </div>
      </div>

      {expanded && (
        <>
          <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-zinc-800/50">
            <div className="space-y-1.5">
              <Row label="Unusual Strikes" value={<><span style={{ color: "#26a69a" }}>{c.unusualCallStrikes}C</span><span className="text-zinc-600 mx-1">/</span><span style={{ color: "#f23645" }}>{c.unusualPutStrikes}P</span></>} />
              <Row label="Unusual Volume" value={(c.unusualCallVolume + c.unusualPutVolume).toLocaleString()} />
              <Row label="P/C Volume Ratio" value={c.putCallVolumeRatio.toFixed(2)} />
            </div>
            <div className="space-y-1.5">
              <Row label="Top VOI" value={<span style={{ color: "#66e0ff" }}>{c.topVoiRatio.toFixed(1)}×</span>} />
              <Row label="Total Call/Put Vol" value={<>{c.totalCallVolume.toLocaleString()}<span className="text-zinc-600 mx-1">/</span>{c.totalPutVolume.toLocaleString()}</>} />
              <Row label="As Of" value={<span className="text-zinc-400">{c.asOfDate}</span>} />
              <Row label="Live Exec" value={<span className="text-[11px] font-mono"><span style={{ color: "#FFB800" }}>{c.exec.sweepCount}sw</span><span className="text-zinc-700 mx-1">/</span><span style={{ color: "#66e0ff" }}>{c.exec.blockCount}bk</span><span className="text-zinc-700 mx-1">/</span><span className="text-zinc-500">{c.exec.regularCount}rg</span></span>} />
              <Row label="Aggressor" value={<span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: "#9ca3af", background: "rgba(156,163,175,0.08)", border: "1px solid rgba(156,163,175,0.2)" }}>N/A · Phase 2</span>} />
            </div>
          </div>

          <div className="px-4 py-2.5 border-t border-zinc-800/50">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Top Strikes by VOI</div>
            <div className="space-y-1">
              {c.topByVoiRatio.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold w-5 text-center" style={{ color: s.optionType === "call" ? "#26a69a" : "#f23645" }}>{s.optionType === "call" ? "C" : "P"}</span>
                    <span className="text-zinc-300">${s.strike}</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-500">{s.expiration}</span>
                    <span className="text-zinc-700">({s.dte}d)</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-zinc-400">{s.volume.toLocaleString()} vol</span>
                    <span className="text-zinc-600">/</span>
                    <span className="text-zinc-500">{s.openInterest.toLocaleString()} OI</span>
                    <span className="font-bold w-12 text-right" style={{ color: "#66e0ff" }}>{s.volOiRatio.toFixed(1)}×</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 py-2.5 border-t border-zinc-800/50 flex items-center justify-between" style={{ background: "#0a0a0a" }}>
            <span className="text-[10px] text-zinc-600 font-mono">
              Score {c.score.toFixed(1)} · strk=40 voi=17.8 skew=10 notl=16.9 tnr=0 exec=12
            </span>
            <button className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded"
              style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>
              <Send className="w-3 h-3" /> SEND TO STRATEGIST
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="text-sm font-mono tabular-nums text-zinc-200">{value}</span>
    </div>
  );
}

function NewCard() {
  const [expanded, setExpanded] = useState(true);
  const c = FIXTURE;
  const skewColor = "#26a69a";
  const scoreColor = "#66e0ff";
  const execParts: string[] = [];
  if (c.exec.sweepCount > 0) execParts.push(`${c.exec.sweepCount} ${c.exec.sweepCount === 1 ? "sweep" : "sweeps"}`);
  if (c.exec.blockCount > 0) execParts.push(`${c.exec.blockCount} ${c.exec.blockCount === 1 ? "block" : "blocks"}`);
  if (c.exec.regularCount > 0) execParts.push(`${c.exec.regularCount} regular`);
  const pcLean = c.putCallVolumeRatio < 0.7 ? "bullish lean" : c.putCallVolumeRatio > 1.3 ? "bearish lean" : "neutral";

  return (
    <div className="bg-card border border-zinc-800 rounded-lg overflow-hidden">
      {/* HEADER — two-line cleaner layout */}
      <div onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 cursor-pointer" style={{ background: "#0c0c0c" }}>
        {/* Line 1 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-bold tabular-nums text-zinc-600">#{c.rank}</span>
          <span className="font-bold text-[15px] tracking-wider" style={{ color: scoreColor }}>{c.symbol}</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ color: skewColor, background: `${skewColor}1a`, border: `1px solid ${skewColor}40` }}>
            BULLISH
          </span>
          <span className="text-[13px] font-mono tabular-nums font-semibold" style={{ color: "#FFB800" }}>
            {fmtMoney(c.unusualTotalNotional)} <span className="text-zinc-500 font-normal text-[11px]">notional</span>
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-[12px] font-mono tabular-nums text-zinc-300">
            {c.unusualTotalVolume.toLocaleString()} <span className="text-zinc-500">contracts</span>
          </span>
          <span className="text-zinc-700">·</span>
          <span className="text-[12px] font-mono tabular-nums text-zinc-300">
            {c.unusualStrikeCount} <span className="text-zinc-500">strikes</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Score</span>
            <span className="text-[16px] font-bold font-mono tabular-nums" style={{ color: scoreColor }}>{c.score.toFixed(0)}</span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
          </div>
        </div>
        {/* Line 2 */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px] font-mono tabular-nums">
          <span className="text-zinc-400">Price <span className="text-zinc-200">${c.livePrice.toFixed(2)}</span></span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-400">Top Vol/OI <span style={{ color: "#66e0ff" }}>{c.topVoiRatio.toFixed(1)}x</span></span>
          {execParts.length > 0 && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="text-zinc-400">Execution <span className="text-zinc-200">{execParts.join(", ")}</span></span>
            </>
          )}
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-400">Avg DTE <span className="text-zinc-200">{c.avgDte}</span></span>
        </div>
      </div>

      {expanded && (
        <>
          {/* DETAILS */}
          <div className="px-4 py-3 border-t border-zinc-800/60 space-y-2">
            <DetailRow label="Unusual Strikes"
              value={<><span style={{ color: "#26a69a" }}>{c.unusualCallStrikes} calls</span><span className="text-zinc-600">,</span> <span style={{ color: "#f23645" }}>{c.unusualPutStrikes} puts</span></>} />
            <DetailRow label="Top Volume / Open Interest Ratio"
              value={<><span style={{ color: "#66e0ff" }}>{c.topVoiRatio.toFixed(1)}x</span> <span className="text-zinc-500 text-[11px]">(highest unusual strike)</span></>} />
            <DetailRow label="Total Call Volume" value={c.totalCallVolume.toLocaleString()} />
            <DetailRow label="Total Put Volume" value={c.totalPutVolume.toLocaleString()} />
            <DetailRow label="Put / Call Ratio"
              value={<>{c.putCallVolumeRatio.toFixed(2)} <span className="text-[11px]" style={{ color: pcLean === "bullish lean" ? "#26a69a" : pcLean === "bearish lean" ? "#f23645" : "#9ca3af" }}>({pcLean})</span></>} />
            <DetailRow label="Execution Types"
              value={<>{c.exec.sweepCount} sweeps<span className="text-zinc-600">,</span> {c.exec.blockCount} blocks<span className="text-zinc-600">,</span> {c.exec.regularCount} regular trades</>} />
            <DetailRow label="Aggressor Side"
              value={
                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded cursor-help"
                  title="Aggressor side classification (bid/ask analysis) coming in a future update. Currently unavailable."
                  style={{ color: "#9ca3af", background: "rgba(156,163,175,0.08)", border: "1px solid rgba(156,163,175,0.2)" }}>
                  Coming soon <Info className="w-3 h-3" />
                </span>
              } />
          </div>

          {/* TOP STRIKES TABLE */}
          <div className="px-4 py-3 border-t border-zinc-800/60">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Top Strikes by Volume / Open Interest</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-600 grid items-center gap-2 px-1 pb-1.5 border-b border-zinc-800/50"
              style={{ gridTemplateColumns: "44px 64px 88px 1fr 1fr 64px" }}>
              <span>Side</span>
              <span>Strike</span>
              <span>Expiry</span>
              <span className="text-right">Volume</span>
              <span className="text-right">Open Int</span>
              <span className="text-right">Vol/OI</span>
            </div>
            <div className="divide-y divide-zinc-800/40">
              {c.topByVoiRatio.map((s, i) => (
                <div key={i} className="grid items-center gap-2 px-1 py-1.5 text-[12px] font-mono tabular-nums"
                  style={{ gridTemplateColumns: "44px 64px 88px 1fr 1fr 64px" }}>
                  <span className="text-[10px] font-bold uppercase" style={{ color: s.optionType === "call" ? "#26a69a" : "#f23645" }}>
                    {s.optionType}
                  </span>
                  <span className="text-zinc-200">${s.strike}</span>
                  <span className="text-zinc-400">{s.expShort} <span className="text-zinc-600">({s.dte}d)</span></span>
                  <span className="text-right text-zinc-300">{s.volume.toLocaleString()}</span>
                  <span className="text-right text-zinc-500">{s.openInterest.toLocaleString()}</span>
                  <span className="text-right font-bold" style={{ color: "#66e0ff" }}>{s.volOiRatio.toFixed(1)}x</span>
                </div>
              ))}
            </div>
          </div>

          {/* SCORE BREAKDOWN */}
          <div className="px-4 py-3 border-t border-zinc-800/60">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Score Breakdown</span>
              <span className="text-[14px] font-bold font-mono tabular-nums" style={{ color: scoreColor }}>{c.score.toFixed(1)}</span>
              <span className="text-[10px] text-zinc-600">total</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] font-mono">
              <ScoreRow label="Strike count" value={c.scoreBreakdown.strikeCount} />
              <ScoreRow label="Volume / OI" value={c.scoreBreakdown.voi} />
              <ScoreRow label="Directional skew" value={c.scoreBreakdown.skewScore} />
              <ScoreRow label="Notional size" value={c.scoreBreakdown.notional} />
              <ScoreRow label="Tenor / DTE" value={c.scoreBreakdown.tenor} />
              <ScoreRow label="Execution quality" value={c.scoreBreakdown.execution} />
            </div>
          </div>

          {/* FOOTER */}
          <div className="px-4 py-2.5 border-t border-zinc-800/60 flex items-center justify-between" style={{ background: "#0a0a0a" }}>
            <span className="text-[10px] text-zinc-500">
              As of {c.asOfDate} {c.asOfTime}
            </span>
            <button className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded"
              style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.3)" }}>
              <Send className="w-3 h-3" /> SEND TO STRATEGIST
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[12px] text-zinc-400">{label}</span>
      <span className="text-[13px] font-mono tabular-nums text-zinc-100 text-right">{value}</span>
    </div>
  );
}
function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-zinc-400">{label}</span>
      <span className="text-zinc-100 tabular-nums">{value}</span>
    </div>
  );
}

export function Comparison() {
  return (
    <div className="min-h-screen p-6" style={{ background: "#070707", color: "#e4e4e7", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <style>{`.bg-card { background:#101010; }`}</style>
      <div className="max-w-[1600px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT — current */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 px-2 py-1 rounded border border-zinc-800">Current</span>
              <span className="text-[12px] text-zinc-500">live in production</span>
            </div>
            <div className="space-y-3">
              <OldStatusBar />
              <OldCard />
            </div>
          </div>
          {/* RIGHT — proposed */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded" style={{ color: "#FFB800", border: "1px solid rgba(255,184,0,0.4)", background: "rgba(255,184,0,0.06)" }}>Proposed</span>
              <span className="text-[12px] text-zinc-400">redesigned for readability</span>
            </div>
            <div className="space-y-3">
              <NewStatusBar />
              <NewCard />
            </div>
          </div>
        </div>
        <div className="mt-8 text-[11px] text-zinc-500 max-w-3xl space-y-1.5">
          <p><span className="text-zinc-300 font-semibold">Header:</span> two-line layout, full words ("notional", "contracts", "strikes"). Zero counts dropped from the exec chip. Score gets its own labeled slot.</p>
          <p><span className="text-zinc-300 font-semibold">Body:</span> every label spelled out. P/C ratio shows lean inline. Aggressor pill says "Coming soon" with hover explanation.</p>
          <p><span className="text-zinc-300 font-semibold">Top strikes:</span> real table with column headers, right-aligned numbers, friendlier date format ("Apr 24" not "2026-04-24").</p>
          <p><span className="text-zinc-300 font-semibold">Score:</span> 6-row labeled breakdown replaces the cryptic formula string.</p>
          <p><span className="text-zinc-300 font-semibold">Status bar:</span> spaced fields, timestamp now includes time of day.</p>
        </div>
      </div>
    </div>
  );
}
