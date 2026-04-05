import { CompanyResearchHub } from "@/components/CompanyResearchHub";

interface Candle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  candles?: Candle[];
  stickyOffset?: number;
}

export function CompanySwipablePages({ candles }: Props) {
  return <CompanyResearchHub candles={candles} />;
}
