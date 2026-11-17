import { useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { OptionsTab } from "@/components/OptionsTab";

// Mock option chain data with crossed bid/ask for SPX
const mockOptionChainData = {
  symbol: "SPX",
  status: "SUCCESS",
  underlying: {
    symbol: "SPX",
    last: 5900.50,
    bid: 5900.25,
    ask: 5900.75,
  },
  strategy: "SINGLE",
  interval: 0,
  isDelayed: false,
  isIndex: true,
  daysToExpiration: 0,
  interestRate: 0.05,
  underlyingPrice: 5900.50,
  volatility: 15.5,
  callExpDateMap: {
    "2026-11-18:0": {
      "5900.0": [{
        putCall: "CALL",
        symbol: "SPXW  261118C05900000",
        description: "SPXW Nov 18 2026 5900 Call",
        exchangeName: "OPR",
        bid: 15.80,  // Crossed: bid > ask
        ask: 15.20,
        last: 15.50,
        mark: 15.50,
        bidSize: 25,
        askSize: 30,
        bidAskSize: "25X30",
        lastSize: 10,
        highPrice: 16.00,
        lowPrice: 15.00,
        openPrice: 15.30,
        closePrice: 15.40,
        totalVolume: 1250,
        tradeDate: null,
        tradeTimeInLong: Date.now(),
        quoteTimeInLong: Date.now(),
        netChange: 0.10,
        volatility: 15.8,
        delta: 0.52,
        gamma: 0.003,
        theta: -2.5,
        vega: 8.2,
        rho: 1.5,
        openInterest: 5420,
        timeValue: 15.50,
        theoreticalOptionValue: 15.50,
        theoreticalVolatility: 15.8,
        optionDeliverablesList: null,
        strikePrice: 5900.0,
        expirationDate: 1732060800000,
        daysToExpiration: 1,
        expirationType: "W",
        lastTradingDay: 1732060800000,
        multiplier: 100.0,
        settlementType: "P",
        deliverableNote: "",
        isIndexOption: true,
        percentChange: 0.65,
        markChange: 0.10,
        markPercentChange: 0.65,
        intrinsicValue: 0.50,
        pennyPilot: true,
        inTheMoney: true,
        mini: false,
        nonStandard: false,
      }]
    }
  },
  putExpDateMap: {
    "2026-11-18:0": {
      "5900.0": [{
        putCall: "PUT",
        symbol: "SPXW  261118P05900000",
        description: "SPXW Nov 18 2026 5900 Put",
        exchangeName: "OPR",
        bid: 14.30,
        ask: 14.70,
        last: 14.50,
        mark: 14.50,
        bidSize: 40,
        askSize: 35,
        bidAskSize: "40X35",
        lastSize: 15,
        highPrice: 15.00,
        lowPrice: 14.00,
        openPrice: 14.20,
        closePrice: 14.40,
        totalVolume: 2100,
        tradeDate: null,
        tradeTimeInLong: Date.now(),
        quoteTimeInLong: Date.now(),
        netChange: 0.10,
        volatility: 15.5,
        delta: -0.48,
        gamma: 0.003,
        theta: -2.3,
        vega: 8.0,
        rho: -1.4,
        openInterest: 7320,
        timeValue: 14.50,
        theoreticalOptionValue: 14.50,
        theoreticalVolatility: 15.5,
        optionDeliverablesList: null,
        strikePrice: 5900.0,
        expirationDate: 1732060800000,
        daysToExpiration: 1,
        expirationType: "W",
        lastTradingDay: 1732060800000,
        multiplier: 100.0,
        settlementType: "P",
        deliverableNote: "",
        isIndexOption: true,
        percentChange: 0.69,
        markChange: 0.10,
        markPercentChange: 0.69,
        intrinsicValue: 0,
        pennyPilot: true,
        inTheMoney: false,
        mini: false,
        nonStandard: false,
      }]
    }
  },
  numberOfContracts: 2,
};

export default function QAHarness() {
  const setTokens = useTerminalStore((s) => s.setTokens);

  useEffect(() => {
    if (!import.meta.env.DEV || import.meta.env.VITE_QA_HARNESS !== "true") return;
    // Set mock tokens so components think we're authenticated
    setTokens("mock-qa-access-token", "mock-qa-refresh-token");
    
    // Inject mock API responses
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      
      // Mock option chain endpoint
      if (url.includes('/api/schwab/marketdata/chains')) {
        return new Response(JSON.stringify(mockOptionChainData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Mock quote endpoint
      if (url.includes('/api/schwab/marketdata/quotes')) {
        return new Response(JSON.stringify({
          SPX: {
            symbol: "SPX",
            description: "S&P 500 Index",
            last: 5900.50,
            bid: 5900.25,
            ask: 5900.75,
            change: 12.50,
            percentChange: 0.21,
            high: 5910.00,
            low: 5890.00,
            open: 5895.00,
            close: 5888.00,
            volume: 0,
            quoteTimeInLong: Date.now(),
          }
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      // Pass through other requests
      return originalFetch(input, init);
    };
    
    return () => {
      window.fetch = originalFetch;
    };
  }, [setTokens]);

  return (
    <div style={{ minHeight: "100vh", background: "#000000" }}>
      <div style={{ 
        padding: "12px 20px", 
        background: "#0a0a0a", 
        borderBottom: "1px solid #1a1a1a",
        color: "#fbbf24",
        fontFamily: "monospace",
        fontSize: "11px",
        letterSpacing: "0.5px",
      }}>
        QA HARNESS · SPX Options with Crossed Quotes
      </div>
      <OptionsTab subscribeOptionSymbols={async () => {}} />
    </div>
  );
}
