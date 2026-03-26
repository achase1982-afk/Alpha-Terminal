import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetOptionChain } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DownloadCloud } from "lucide-react";

export function OptionsTab() {
  const { symbol, accessToken } = useTerminalStore();
  const [contractType, setContractType] = useState("ALL");
  const [dte, setDte] = useState("30");
  const [enabled, setEnabled] = useState(false);

  const { data, isLoading, error } = useGetOptionChain(
    { 
      symbol, 
      accessToken: accessToken || '', 
      contractType, 
      daysToExpiration: parseInt(dte) || 30 
    },
    { 
      query: { enabled: !!accessToken && enabled && !!symbol } 
    }
  );

  const handleLoad = () => {
    setEnabled(true);
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-wrap gap-4 items-end bg-card p-4 rounded-xl border border-card-border">
        <div className="space-y-2">
          <Label className="font-mono text-xs text-muted-foreground uppercase">Contract Type</Label>
          <Select value={contractType} onValueChange={setContractType}>
            <SelectTrigger className="w-32 font-mono text-sm bg-background border-card-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL</SelectItem>
              <SelectItem value="CALL">CALL</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label className="font-mono text-xs text-muted-foreground uppercase">Max DTE</Label>
          <Input 
            type="number" 
            value={dte} 
            onChange={(e) => setDte(e.target.value)}
            className="w-24 font-mono text-sm bg-background border-card-border"
          />
        </div>

        <Button 
          onClick={handleLoad} 
          disabled={!accessToken}
          className="font-mono bg-primary/20 text-primary hover:bg-primary/30 border border-primary/50"
        >
          <DownloadCloud className="w-4 h-4 mr-2" />
          LOAD CHAIN
        </Button>
      </div>

      <div className="flex-1 overflow-auto terminal-panel p-0">
        {isLoading && (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-full bg-card-border" />
            <Skeleton className="h-12 w-full bg-card-border" />
            <Skeleton className="h-12 w-full bg-card-border" />
            <Skeleton className="h-12 w-full bg-card-border" />
          </div>
        )}

        {error && (
          <div className="p-10 text-center text-destructive font-mono flex flex-col items-center">
            <div className="p-4 bg-destructive/10 rounded-full mb-4">
              <span className="text-2xl">⚠</span>
            </div>
            FAILED TO LOAD OPTIONS DATA.
          </div>
        )}

        {!isLoading && !error && !data && (
          <div className="p-20 flex flex-col items-center justify-center text-muted-foreground font-mono h-full">
            <Layers className="w-12 h-12 mb-4 opacity-20" />
            CLICK "LOAD CHAIN" TO FETCH OPTIONS DATA.
          </div>
        )}

        {data && (
          <Table>
            <TableHeader className="bg-background/50 sticky top-0 backdrop-blur z-10">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono text-xs text-muted-foreground">TYPE</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground">STRIKE</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">LAST</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">BID/ASK</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">VOL</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">OI</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right">IV%</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right hidden lg:table-cell">DELTA</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right hidden lg:table-cell">GAMMA</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right hidden lg:table-cell">THETA</TableHead>
                <TableHead className="font-mono text-xs text-muted-foreground text-right hidden lg:table-cell">VEGA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {data.calls.map((c, i) => (
                <TableRow key={`call-${i}`} className="border-card-border hover:bg-secondary/30">
                  <TableCell className="text-[#00D4AA] font-bold">CALL</TableCell>
                  <TableCell>${c.strike.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${c.last?.toFixed(2) || '-'}</TableCell>
                  <TableCell className="text-right text-muted-foreground">${c.bid?.toFixed(2)} / ${c.ask?.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{c.volume || 0}</TableCell>
                  <TableCell className="text-right">{c.openInterest || 0}</TableCell>
                  <TableCell className="text-right">{(c.iv || 0).toFixed(1)}%</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(c.delta || 0).toFixed(3)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(c.gamma || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(c.theta || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(c.vega || 0).toFixed(4)}</TableCell>
                </TableRow>
              ))}
              {data.puts.map((p, i) => (
                <TableRow key={`put-${i}`} className="border-card-border hover:bg-secondary/30">
                  <TableCell className="text-[#FF4D4D] font-bold">PUT</TableCell>
                  <TableCell>${p.strike.toFixed(2)}</TableCell>
                  <TableCell className="text-right">${p.last?.toFixed(2) || '-'}</TableCell>
                  <TableCell className="text-right text-muted-foreground">${p.bid?.toFixed(2)} / ${p.ask?.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{p.volume || 0}</TableCell>
                  <TableCell className="text-right">{p.openInterest || 0}</TableCell>
                  <TableCell className="text-right">{(p.iv || 0).toFixed(1)}%</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(p.delta || 0).toFixed(3)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(p.gamma || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(p.theta || 0).toFixed(4)}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{(p.vega || 0).toFixed(4)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
