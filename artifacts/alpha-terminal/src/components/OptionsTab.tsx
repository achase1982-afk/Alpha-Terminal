import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote, useGetPriceHistory, useGetOptionChain } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DownloadCloud, Table2, BarChart2, ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

export function OptionsTab() {
  const { symbol, accessToken, timeframe, aiModel, aiTemp, strategistResult, setStrategistResult } = useTerminalStore();
  const [contractType, setContractType] = useState("ALL");
  const [dte, setDte] = useState("30");
  const [enabled, setEnabled] = useState(false);
  const [isStrategizing, setIsStrategizing] = useState(false);
  const [strategistExpanded, setStrategistExpanded] = useState(true);

  const { data, isLoading, error } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType, daysToExpiration: parseInt(dte) || 30 },
    { query: { enabled: !!accessToken && enabled && !!symbol } }
  );

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const { data: history } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", timeframe },
    { query: { enabled: !!accessToken } }
  );

  const handleLoad = () => setEnabled(true);

  const handleRunStrategist = async () => {
    if (!quote || !data) return;
    setStrategistResult(null);
    setIsStrategizing(true);
    setStrategistExpanded(true);
    try {
      const res = await fetch(`${API_BASE}/ai/options-strategist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quote,
          candles: history?.candles ?? [],
          chain: data,
          model: aiModel,
          temperature: aiTemp,
        }),
      });
      const result = await res.json() as { response?: string };
      setStrategistResult(result.response ?? "No response received.");
    } catch (err) {
      setStrategistResult(`**Error:** ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsStrategizing(false);
    }
  };

  return (
    <div className="space-y-4 h-full flex flex-col">

      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 items-end bg-card p-4 rounded-xl border border-card-border shrink-0">
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] text-muted-foreground uppercase">Contract Type</Label>
          <Select value={contractType} onValueChange={setContractType}>
            <SelectTrigger className="w-28 font-mono text-xs bg-background border-card-border h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL</SelectItem>
              <SelectItem value="CALL">CALL</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] text-muted-foreground uppercase">Max DTE</Label>
          <Input
            type="number"
            value={dte}
            onChange={e => setDte(e.target.value)}
            className="w-20 font-mono text-xs bg-background border-card-border h-9"
          />
        </div>

        <Button
          onClick={handleLoad}
          disabled={!accessToken}
          className="font-mono text-xs h-9 bg-primary/20 text-primary hover:bg-primary/30 border border-primary/50"
        >
          <DownloadCloud className="w-3.5 h-3.5 mr-2" />
          LOAD CHAIN
        </Button>

        {data && (
          <Button
            onClick={handleRunStrategist}
            disabled={isStrategizing || !accessToken}
            variant="outline"
            className="font-mono text-xs h-9 border-primary/40 text-primary hover:bg-primary/10 ml-auto"
          >
            {isStrategizing ? (
              <><span className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />ANALYZING...</>
            ) : (
              <><BarChart2 className="w-3.5 h-3.5 mr-2" />RUN OPTIONS STRATEGIST</>
            )}
          </Button>
        )}
      </div>

      {/* Strategist Results — above the table */}
      {(strategistResult || isStrategizing) && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden shrink-0">
          <button
            onClick={() => setStrategistExpanded(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 border-b border-card-border hover:bg-secondary/20 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5 text-primary" />
              <span className="font-mono text-xs font-bold text-foreground">OPTIONS STRATEGIST — {symbol}</span>
              {isStrategizing && (
                <span className="w-2.5 h-2.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            {strategistExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {strategistExpanded && (
            <div className="p-4 bg-[#0D1117]">
              {isStrategizing ? (
                <div className="flex items-center justify-center gap-3 py-8">
                  <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="font-mono text-xs text-primary animate-pulse tracking-widest">RUNNING DERIVATIVES STRATEGIST...</span>
                </div>
              ) : strategistResult ? (
                <div className="prose prose-invert prose-primary max-w-none font-sans text-gray-300
                  prose-headings:text-white prose-headings:font-bold prose-headings:tracking-wide prose-headings:mt-3 prose-headings:mb-1
                  prose-h3:text-sm prose-h2:text-base
                  prose-strong:text-white prose-strong:font-bold
                  prose-li:my-0.5
                  prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:rounded prose-code:text-xs"
                >
                  <ReactMarkdown>{strategistResult}</ReactMarkdown>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Options Table */}
      <div className="flex-1 overflow-auto terminal-panel p-0 overflow-x-auto min-h-0">
        {isLoading && (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full bg-card-border" />)}
          </div>
        )}
        {error && (
          <div className="p-10 text-center text-destructive font-mono flex flex-col items-center">
            <span className="text-3xl mb-3">⚠</span>
            FAILED TO LOAD OPTIONS DATA.
          </div>
        )}
        {!isLoading && !error && !data && (
          <div className="p-20 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Table2 className="w-10 h-10 mb-3 opacity-20" />
            <span className="text-sm">CLICK "LOAD CHAIN" TO FETCH OPTIONS DATA.</span>
          </div>
        )}
        {data && (
          <Table>
            <TableHeader className="bg-background/50 sticky top-0 backdrop-blur z-10">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono text-[10px] text-muted-foreground">TYPE</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground">STRIKE</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right">LAST</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right">BID/ASK</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right">VOL</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right">OI</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right">IV%</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right hidden lg:table-cell">DELTA</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right hidden lg:table-cell">THETA</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right hidden xl:table-cell">GAMMA</TableHead>
                <TableHead className="font-mono text-[10px] text-muted-foreground text-right hidden xl:table-cell">VEGA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-xs">
              {data.calls.map((c, i) => (
                <TableRow key={`call-${i}`} className="border-card-border hover:bg-primary/5">
                  <TableCell className="text-primary font-bold py-2">CALL</TableCell>
                  <TableCell className="py-2">${c.strike.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2">${c.last?.toFixed(2) || "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground py-2">${c.bid?.toFixed(2)} / ${c.ask?.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2">{c.volume || 0}</TableCell>
                  <TableCell className="text-right py-2">{c.openInterest || 0}</TableCell>
                  <TableCell className="text-right py-2">{(c.iv || 0).toFixed(1)}%</TableCell>
                  <TableCell className="text-right hidden lg:table-cell py-2">{(c.delta || 0).toFixed(3)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell py-2">{(c.theta || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden xl:table-cell py-2">{(c.gamma || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden xl:table-cell py-2">{(c.vega || 0).toFixed(4)}</TableCell>
                </TableRow>
              ))}
              {data.puts.map((p, i) => (
                <TableRow key={`put-${i}`} className="border-card-border hover:bg-destructive/5">
                  <TableCell className="text-destructive font-bold py-2">PUT</TableCell>
                  <TableCell className="py-2">${p.strike.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2">${p.last?.toFixed(2) || "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground py-2">${p.bid?.toFixed(2)} / ${p.ask?.toFixed(2)}</TableCell>
                  <TableCell className="text-right py-2">{p.volume || 0}</TableCell>
                  <TableCell className="text-right py-2">{p.openInterest || 0}</TableCell>
                  <TableCell className="text-right py-2">{(p.iv || 0).toFixed(1)}%</TableCell>
                  <TableCell className="text-right hidden lg:table-cell py-2">{(p.delta || 0).toFixed(3)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell py-2">{(p.theta || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden xl:table-cell py-2">{(p.gamma || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden xl:table-cell py-2">{(p.vega || 0).toFixed(4)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
