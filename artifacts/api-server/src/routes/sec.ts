import { Router, type IRouter } from "express";

const router: IRouter = Router();

const HEADERS = {
  "User-Agent": "AlphaTerminal support@alphaterminal.app",
  "Accept": "application/json",
};

const FETCH_TIMEOUT_MS = 10_000;

interface EdgarFiling {
  id: string;
  formType: string;
  filedAt: string;
  description: string;
  url: string;
  accessionNo: string;
}

let tickerToCik: Map<string, string> | null = null;
let tickerMapLoadedAt = 0;
const TICKER_MAP_TTL = 24 * 60 * 60 * 1000;

const filingsCache = new Map<string, { filings: EdgarFiling[]; ts: number }>();
const FILINGS_CACHE_TTL = 3 * 60 * 1000;

async function loadTickerMap(log?: any): Promise<Map<string, string>> {
  if (tickerToCik && Date.now() - tickerMapLoadedAt < TICKER_MAP_TTL) {
    return tickerToCik;
  }

  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: HEADERS,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    log?.warn({ status: res.status }, "SEC company_tickers.json failed");
    if (tickerToCik) return tickerToCik;
    throw new Error(`SEC company_tickers.json returned ${res.status}`);
  }
  const data = (await res.json()) as Record<
    string,
    { cik_str: number; ticker: string; title: string }
  >;

  const map = new Map<string, string>();
  for (const entry of Object.values(data)) {
    map.set(
      entry.ticker.toUpperCase(),
      String(entry.cik_str).padStart(10, "0"),
    );
  }

  tickerToCik = map;
  tickerMapLoadedAt = Date.now();
  return map;
}

async function fetchEdgarFilings(
  ticker: string,
  log?: any,
): Promise<EdgarFiling[]> {
  const tickerUpper = ticker.toUpperCase().replace(/^\$/, "");

  const cached = filingsCache.get(tickerUpper);
  if (cached && Date.now() - cached.ts < FILINGS_CACHE_TTL) {
    return cached.filings;
  }

  const map = await loadTickerMap(log);
  const cik = map.get(tickerUpper);
  if (!cik) {
    log?.info({ ticker }, "Ticker not found in SEC company_tickers.json");
    return [];
  }

  const submissionsRes = await fetch(
    `https://data.sec.gov/submissions/CIK${cik}.json`,
    {
      headers: HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!submissionsRes.ok) {
    log?.warn(
      { status: submissionsRes.status, cik },
      "SEC submissions fetch failed",
    );
    if (cached) return cached.filings;
    throw new Error(`SEC submissions returned ${submissionsRes.status}`);
  }
  const submissions = (await submissionsRes.json()) as any;

  const recent = submissions.filings?.recent;
  if (!recent) return [];

  const filings: EdgarFiling[] = [];
  const count = Math.min(recent.accessionNumber?.length ?? 0, 50);

  for (let i = 0; i < count; i++) {
    const formType = recent.form?.[i] ?? "";
    const filingDate = recent.filingDate?.[i] ?? "";
    const accession = recent.accessionNumber?.[i] ?? "";
    const primaryDoc = recent.primaryDocument?.[i] ?? "";
    const description = recent.primaryDocDescription?.[i] || formType;

    const accessionDash = accession.replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accessionDash}/${primaryDoc}`;

    filings.push({
      id: accession,
      formType,
      filedAt: filingDate,
      description,
      url,
      accessionNo: accession,
    });
  }

  filingsCache.set(tickerUpper, { filings, ts: Date.now() });
  return filings;
}

router.get("/filings", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim();
  if (!symbol) {
    return res.status(400).json({ error: "symbol required" });
  }

  try {
    const map = await loadTickerMap(req.log);
    const cik = map.get(symbol.toUpperCase().replace(/^\$/, "")) || null;
    const filings = await fetchEdgarFilings(symbol, req.log);
    return res.json({ filings, cik, symbol: symbol.toUpperCase() });
  } catch (err: any) {
    req.log?.error({ err }, "SEC filings endpoint error");
    return res.status(502).json({ error: "SEC upstream unavailable", filings: [], cik: null });
  }
});

router.get("/company", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim();
  if (!symbol) {
    return res.status(400).json({ error: "symbol required" });
  }

  try {
    const map = await loadTickerMap(req.log);
    const tickerUpper = symbol.toUpperCase().replace(/^\$/, "");
    const cik = map.get(tickerUpper);
    if (!cik) {
      return res.json({ cik: null, name: null, sic: null, sicDescription: null, stateOfIncorporation: null, fiscalYearEnd: null, category: null });
    }

    const submissionsRes = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!submissionsRes.ok) {
      return res.json({ cik, name: null });
    }
    const data = (await submissionsRes.json()) as any;

    return res.json({
      cik,
      name: data.name || null,
      sic: data.sic || null,
      sicDescription: data.sicDescription || null,
      stateOfIncorporation: data.stateOfIncorporation || null,
      fiscalYearEnd: data.fiscalYearEnd || null,
      category: data.category || null,
      ein: data.ein || null,
      exchanges: data.exchanges || [],
      tickers: data.tickers || [],
    });
  } catch (err: any) {
    req.log?.error({ err }, "SEC company endpoint error");
    return res.status(502).json({ error: "SEC upstream unavailable" });
  }
});

const SEC_DARK_CSS = `
*{box-sizing:border-box;border-color:#27272a!important}
html,body{background:#000!important;color:#d4d4d8!important;margin:0;padding:12px 16px;font-family:'SFMono-Regular','SF Mono',ui-monospace,'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace!important;font-size:12px;line-height:1.6;overflow-x:hidden;word-break:break-word}
table{border-collapse:collapse;width:100%;font-size:11px;margin:8px 0}
td,th{padding:4px 8px;border:1px solid #27272a;vertical-align:top;color:#d4d4d8!important;background:transparent!important}
th{color:#a1a1aa!important;font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:0.5px}
tr:nth-child(even) td{background:#0a0a0a!important}
a{color:#FFB800!important;text-decoration:none!important}
h1,h2,h3,h4,h5,h6{color:#e4e4e7!important;font-weight:700;margin:16px 0 8px}
p{margin:6px 0}
hr{border:none;border-top:1px solid #27272a;margin:12px 0}
pre,code{font-size:11px;background:#0a0a0a!important;padding:2px 4px}
span,div,font,b,i,u,em,strong{color:inherit!important;background:transparent!important}
ix\\:nonfraction,ix\\:nonnumeric{color:#FFB800!important;font-weight:600}
.FormData,.FormDataR,.FormDataC,.smallFormData{color:#d4d4d8!important;font-size:11px}
.FormName,.FormTitle{color:#e4e4e7!important;font-weight:700}
.FormText,.SmallFormText{color:#a1a1aa!important;font-size:10px}
`;

router.get("/filing-content", async (req, res) => {
  const url = (req.query.url as string || "").trim();
  if (!url || !url.startsWith("https://www.sec.gov/")) {
    return res.status(400).send("<html><body style='background:#000;color:#f87171;padding:40px;font-family:monospace'>Invalid SEC URL</body></html>");
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "AlphaTerminal support@alphaterminal.app",
        "Accept": "text/html, application/xhtml+xml, text/plain, */*",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      return res.status(resp.status).send(`<html><body style='background:#000;color:#f87171;padding:40px;font-family:monospace'>SEC returned ${resp.status}</body></html>`);
    }

    const contentType = resp.headers.get("content-type") || "";
    const raw = await resp.text();

    let bodyContent: string;
    if (contentType.includes("html") || contentType.includes("xml") || raw.trimStart().startsWith("<")) {
      bodyContent = raw;
      const bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) bodyContent = bodyMatch[1];
      bodyContent = bodyContent
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<link[^>]*>/gi, "")
        .replace(/<img[^>]*>/gi, "")
        .replace(/<meta[^>]*>/gi, "");
    } else {
      bodyContent = `<pre style="white-space:pre-wrap;word-break:break-word;margin:0">${raw.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</pre>`;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${SEC_DARK_CSS}</style></head><body>${bodyContent.trim()}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    req.log?.error({ err }, "SEC filing content fetch error");
    return res.status(502).send("<html><body style='background:#000;color:#f87171;padding:40px;font-family:monospace'>Failed to fetch filing content</body></html>");
  }
});

export default router;
