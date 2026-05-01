import { Router, type IRouter } from "express";
import { logFailure } from "../lib/telemetry.js";

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

/**
 * Partial typings for SEC `data.sec.gov` JSON — full schemas are larger than this file consumes.
 * Submissions: `data.sec.gov/submissions/CIK##########.json`
 */
interface SecSubmissionsRecent {
  accessionNumber?: string[];
  filingDate?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
}

/** `data.sec.gov/submissions/CIK##########.json` — partial envelope for company + filings. */
interface SecSubmissionsJson {
  name?: string;
  sic?: string | number | null;
  sicDescription?: string | null;
  stateOfIncorporation?: string | null;
  fiscalYearEnd?: string | null;
  category?: string | null;
  ein?: string | null;
  exchanges?: string[];
  tickers?: string[];
  filings?: {
    recent?: SecSubmissionsRecent;
  };
}

/** `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` — partial XBRL companyfacts. */
interface XbrlFactUnitEntry {
  end?: string;
  val?: number;
  form?: string;
  fy?: number;
  fp?: string;
  filed?: string;
}

interface XbrlTagData {
  units?: Record<string, XbrlFactUnitEntry[]>;
}

interface SecCompanyFactsJson {
  facts?: {
    "us-gaap"?: Record<string, XbrlTagData>;
  };
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
  const submissions = (await submissionsRes.json()) as SecSubmissionsJson;

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
    const data = (await submissionsRes.json()) as SecSubmissionsJson;

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
*{box-sizing:border-box}
html,body{background:#000!important;color:#d4d4d8!important;margin:0;padding:0;font-family:'SFMono-Regular','SF Mono',ui-monospace,'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace!important;font-size:12px;line-height:1.5}
body{padding:10px;overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;font-size:11px;margin:6px 0;border-color:#333!important}
td,th{padding:4px 6px;border:1px solid #333!important;vertical-align:top;color:#d4d4d8!important;background:transparent!important;word-wrap:break-word}
th{color:#a1a1aa!important;font-weight:700;text-transform:uppercase;font-size:9px;letter-spacing:0.5px}
tr:nth-child(even) td{background:#0a0a0a!important}
a{color:#FFB800!important;text-decoration:none!important}
h1,h2,h3,h4,h5,h6{color:#e4e4e7!important;font-weight:700;margin:14px 0 6px}
p{margin:4px 0}
hr{border:none;border-top:1px solid #333;margin:10px 0}
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
    let originalStyles = "";
    if (contentType.includes("html") || contentType.includes("xml") || raw.trimStart().startsWith("<")) {
      const styleMatches = raw.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
      originalStyles = styleMatches.map(s => {
        const inner = s.replace(/<\/?style[^>]*>/gi, "");
        return inner;
      }).join("\n");

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

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${originalStyles}</style><style>${SEC_DARK_CSS}</style></head><body>${bodyContent.trim()}</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err: any) {
    req.log?.error({ err }, "SEC filing content fetch error");
    return res.status(502).send("<html><body style='background:#000;color:#f87171;padding:40px;font-family:monospace'>Failed to fetch filing content</body></html>");
  }
});

// ─── INSIDER TRANSACTIONS (Form 4 parsing) ───────────────────────────────────

interface InsiderTransaction {
  ownerName: string;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string;
  transactionDate: string;
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  acquiredOrDisposed: string;
  sharesAfter: number | null;
  filingUrl: string;
}

function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>\\s*(?:<value>)?([^<]*)(?:<\\/value>)?`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseForm4Xml(xml: string, filingUrl: string): InsiderTransaction[] {
  const results: InsiderTransaction[] = [];

  const ownerName = xmlText(xml, "rptOwnerName");
  const isDirector = xmlText(xml, "isDirector") === "1";
  const isOfficer = xmlText(xml, "isOfficer") === "1";
  const officerTitle = xmlText(xml, "officerTitle");

  const txnRegex = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi;
  let m;
  while ((m = txnRegex.exec(xml)) !== null) {
    const block = m[1];
    const dateMatch = block.match(/<transactionDate>\s*<value>([^<]*)<\/value>/i);
    const codeMatch = block.match(/<transactionCode>([^<]*)<\/transactionCode>/i);
    const sharesMatch = block.match(/<transactionShares>\s*<value>([^<]*)<\/value>/i);
    const priceMatch = block.match(/<transactionPricePerShare>\s*<value>([^<]*)<\/value>/i);
    const adMatch = block.match(/<transactionAcquiredDisposedCode>\s*<value>([^<]*)<\/value>/i);
    const afterMatch = block.match(/<sharesOwnedFollowingTransaction>\s*<value>([^<]*)<\/value>/i);

    const code = codeMatch?.[1] || "";
    if (code === "L" || code === "Z") continue;

    const price = priceMatch ? parseFloat(priceMatch[1]) : null;

    results.push({
      ownerName,
      isDirector,
      isOfficer,
      officerTitle: officerTitle || (isDirector ? "Director" : ""),
      transactionDate: dateMatch?.[1] || "",
      transactionCode: code,
      shares: sharesMatch ? parseInt(sharesMatch[1]) : 0,
      pricePerShare: price && price > 0 ? price : null,
      acquiredOrDisposed: adMatch?.[1] || "",
      sharesAfter: afterMatch ? parseInt(afterMatch[1]) : null,
      filingUrl,
    });
  }
  return results;
}

const insiderCache = new Map<string, { transactions: InsiderTransaction[]; ts: number }>();
const INSIDER_CACHE_TTL = 5 * 60 * 1000;

router.get("/insider-transactions", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const cached = insiderCache.get(symbol);
    if (cached && Date.now() - cached.ts < INSIDER_CACHE_TTL) {
      return res.json({ transactions: cached.transactions, symbol });
    }

    const map = await loadTickerMap(req.log);
    const cik = map.get(symbol);
    if (!cik) return res.json({ transactions: [], symbol });

    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!subRes.ok) return res.json({ transactions: [], symbol });
    const subs = (await subRes.json()) as SecSubmissionsJson;
    const recent = subs.filings?.recent;
    if (!recent) return res.json({ transactions: [], symbol });

    const cikNum = parseInt(cik);
    const form4Entries: { xmlUrl: string; viewerUrl: string }[] = [];
    for (let i = 0; i < (recent.form?.length ?? 0) && form4Entries.length < 15; i++) {
      const formVal = recent.form?.[i];
      if (formVal === "4" || formVal === "4/A") {
        const acc = recent.accessionNumber?.[i]?.replace(/-/g, "") ?? "";
        const primaryDoc = recent.primaryDocument?.[i] || "";
        const rawDoc = primaryDoc.replace(/^xsl[^/]*\//, "");
        if (rawDoc) {
          const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${rawDoc}`;
          const viewerUrl = primaryDoc.startsWith("xsl")
            ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${primaryDoc}`
            : xmlUrl;
          form4Entries.push({ xmlUrl, viewerUrl });
        }
      }
    }

    const allTransactions: InsiderTransaction[] = [];
    const fetches = form4Entries.map(async ({ xmlUrl, viewerUrl }) => {
      try {
        const r = await fetch(xmlUrl, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        const xml = await r.text();
        const txns = parseForm4Xml(xml, viewerUrl);
        allTransactions.push(...txns);
      } catch { /* skip failed fetches */ }
    });

    await Promise.all(fetches);

    allTransactions.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));

    insiderCache.set(symbol, { transactions: allTransactions, ts: Date.now() });
    return res.json({ transactions: allTransactions, symbol });
  } catch (err: any) {
    req.log?.error({ err }, "Insider transactions endpoint error");
    void logFailure("SEC_EDGAR", "ERROR", `SEC insider transaction fetch failed for ${symbol}`, { symbol, error: String(err) });
    return res.status(502).json({ error: "SEC upstream unavailable", transactions: [] });
  }
});


// ─── INSTITUTIONAL HOLDERS (SC 13G/D parsing) ───────────────────────────────

interface InstitutionalHolder {
  name: string;
  shares: number;
  percentOfClass: number;
  filingDate: string;
  formType: string;
}

function parse13GXml(xml: string, filingDate: string, formType: string): InstitutionalHolder | null {
  const nameMatch = xml.match(/<reportingPersonName>([^<]*)<\/reportingPersonName>/i) ||
    xml.match(/<NAME>([^<]*)<\/NAME>/i);
  if (!nameMatch) return null;

  const sharesMatch = xml.match(/<reportingPersonBeneficiallyOwnedAggregateNumberOfShares>([^<]*)<\/reportingPersonBeneficiallyOwnedAggregateNumberOfShares>/i) ||
    xml.match(/<amountBeneficiallyOwned>([^<]*)<\/amountBeneficiallyOwned>/i);
  const pctMatch = xml.match(/<classPercent>([^<]*)<\/classPercent>/i);

  const shares = sharesMatch ? parseInt(sharesMatch[1].replace(/,/g, "")) : 0;
  const pct = pctMatch ? parseFloat(pctMatch[1]) : 0;

  if (!nameMatch[1].trim()) return null;

  return {
    name: nameMatch[1].trim(),
    shares,
    percentOfClass: pct,
    filingDate,
    formType,
  };
}

const holdersCache = new Map<string, { holders: InstitutionalHolder[]; ts: number }>();
const HOLDERS_CACHE_TTL = 10 * 60 * 1000;

router.get("/institutional-holders", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const cached = holdersCache.get(symbol);
    if (cached && Date.now() - cached.ts < HOLDERS_CACHE_TTL) {
      return res.json({ holders: cached.holders, symbol });
    }

    const map = await loadTickerMap(req.log);
    const cik = map.get(symbol);
    if (!cik) return res.json({ holders: [], symbol });

    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!subRes.ok) return res.json({ holders: [], symbol });
    const subs = (await subRes.json()) as SecSubmissionsJson;
    const recent = subs.filings?.recent;
    if (!recent) return res.json({ holders: [], symbol });

    const cikNum = parseInt(cik);
    const filingInfos: { url: string; date: string; form: string }[] = [];
    for (let i = 0; i < (recent.form?.length ?? 0) && filingInfos.length < 20; i++) {
      const form = recent.form?.[i] || "";
      if (form.includes("SC 13G") || form.includes("SC 13D") ||
          form.includes("SCHEDULE 13G") || form.includes("SCHEDULE 13D") ||
          form.includes("13G") || form.includes("13D")) {
        const acc = recent.accessionNumber?.[i]?.replace(/-/g, "") ?? "";
        const rawDoc = (recent.primaryDocument?.[i] || "").replace(/^xsl[^/]*\//, "");
        if (rawDoc) {
          filingInfos.push({
            url: `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${rawDoc}`,
            date: recent.filingDate?.[i] || "",
            form,
          });
        }
      }
    }

    const holders: InstitutionalHolder[] = [];
    const seen = new Set<string>();

    const fetches = filingInfos.map(async (info) => {
      try {
        const r = await fetch(info.url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
        if (!r.ok) return;
        const xml = await r.text();
        const holder = parse13GXml(xml, info.date, info.form);
        if (holder && !seen.has(holder.name.toLowerCase())) {
          seen.add(holder.name.toLowerCase());
          holders.push(holder);
        }
      } catch { /* skip */ }
    });

    await Promise.all(fetches);

    holders.sort((a, b) => b.percentOfClass - a.percentOfClass);

    holdersCache.set(symbol, { holders, ts: Date.now() });
    return res.json({ holders, symbol });
  } catch (err: any) {
    req.log?.error({ err }, "Institutional holders endpoint error");
    return res.status(502).json({ error: "SEC upstream unavailable", holders: [] });
  }
});


// ─── COMPANY FINANCIALS (XBRL companyfacts) ──────────────────────────────────

interface FinancialPeriod {
  end: string;
  val: number;
  form: string;
  fy: number;
  fp: string;
  filed: string;
}

export interface CompanyFinancials {
  revenue: FinancialPeriod[];
  netIncome: FinancialPeriod[];
  operatingIncome: FinancialPeriod[];
  eps: FinancialPeriod[];
  totalAssets: FinancialPeriod[];
  totalLiabilities: FinancialPeriod[];
  stockholdersEquity: FinancialPeriod[];
  cash: FinancialPeriod[];
  sharesOutstanding: FinancialPeriod[];
  grossProfit: FinancialPeriod[];
  /** Net cash from operating activities (US-GAAP) */
  operatingCashFlow: FinancialPeriod[];
  capitalExpenditures: FinancialPeriod[];
  financingCashFlow: FinancialPeriod[];
  investingCashFlow: FinancialPeriod[];
  assetsCurrent: FinancialPeriod[];
  liabilitiesCurrent: FinancialPeriod[];
  longTermDebt: FinancialPeriod[];
  debtCurrent: FinancialPeriod[];
}

function extractFacts(facts: SecCompanyFactsJson["facts"], tag: string, unit: string = "USD"): FinancialPeriod[] {
  const tagData = facts?.["us-gaap"]?.[tag];
  if (!tagData) return [];
  const entries = tagData.units?.[unit] || tagData.units?.["USD/shares"] || tagData.units?.["shares"] || [];
  return entries
    .filter((e: XbrlFactUnitEntry) => (e.form === "10-K" || e.form === "10-Q") && e.end && e.val !== undefined)
    .map((e: XbrlFactUnitEntry) => ({
      end: e.end!,
      val: e.val!,
      form: e.form!,
      fy: e.fy!,
      fp: e.fp!,
      filed: e.filed!,
    }));
}

function deduplicatePeriods(periods: FinancialPeriod[]): FinancialPeriod[] {
  const map = new Map<string, FinancialPeriod>();
  for (const p of periods) {
    const key = `${p.end}-${p.form}`;
    const existing = map.get(key);
    if (!existing || p.filed > existing.filed) {
      map.set(key, p);
    }
  }
  const result = Array.from(map.values());
  result.sort((a, b) => a.end.localeCompare(b.end));
  return result;
}

const financialsCache = new Map<string, { data: CompanyFinancials; ts: number }>();
const FINANCIALS_CACHE_TTL = 15 * 60 * 1000;

/** Server-side fetch for strategist / internal callers (same cache as HTTP route). */
export async function fetchCompanyFinancialsForSymbol(symbol: string): Promise<CompanyFinancials | null> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (!sym) return null;
  const cached = financialsCache.get(sym);
  if (cached && Date.now() - cached.ts < FINANCIALS_CACHE_TTL) {
    return cached.data;
  }
  const map = await loadTickerMap(undefined);
  const cik = map.get(sym);
  if (!cik) return null;
  const factsRes = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!factsRes.ok) return null;
  const factsData = (await factsRes.json()) as SecCompanyFactsJson;
  const facts = factsData.facts;
  if (!facts) return null;

  const revCandidates = [
    extractFacts(facts, "Revenues"),
    extractFacts(facts, "RevenueFromContractWithCustomerExcludingAssessedTax"),
    extractFacts(facts, "SalesRevenueNet"),
  ].filter((arr) => arr.length > 0);
  const revenueRaw =
    revCandidates.length > 0
      ? revCandidates.reduce((best, cur) => {
          const bestLatest = best[best.length - 1]?.end || "";
          const curLatest = cur[cur.length - 1]?.end || "";
          return curLatest > bestLatest ? cur : best;
        })
      : [];

  const ocfCandidates = [
    extractFacts(facts, "NetCashProvidedByUsedInOperatingActivities"),
    extractFacts(facts, "CashProvidedByUsedInOperatingActivities"),
  ].filter((arr) => arr.length > 0);
  const operatingCashFlowRaw =
    ocfCandidates.length > 0
      ? ocfCandidates.reduce((best, cur) => {
          const bestLatest = best[best.length - 1]?.end || "";
          const curLatest = cur[cur.length - 1]?.end || "";
          return curLatest > bestLatest ? cur : best;
        })
      : [];

  const capexCandidates = [
    extractFacts(facts, "PaymentsToAcquirePropertyPlantAndEquipment"),
    extractFacts(facts, "PaymentsForCapitalImprovements"),
  ].filter((arr) => arr.length > 0);
  const capexRaw =
    capexCandidates.length > 0
      ? capexCandidates.reduce((best, cur) => {
          const bestLatest = best[best.length - 1]?.end || "";
          const curLatest = cur[cur.length - 1]?.end || "";
          return curLatest > bestLatest ? cur : best;
        })
      : [];

  const financingCandidates = [
    extractFacts(facts, "NetCashProvidedByUsedInFinancingActivities"),
    extractFacts(facts, "CashProvidedByUsedInFinancingActivities"),
  ].filter((arr) => arr.length > 0);
  const financingRaw =
    financingCandidates.length > 0
      ? financingCandidates.reduce((best, cur) => {
          const bestLatest = best[best.length - 1]?.end || "";
          const curLatest = cur[cur.length - 1]?.end || "";
          return curLatest > bestLatest ? cur : best;
        })
      : [];

  const investingCandidates = [
    extractFacts(facts, "NetCashProvidedByUsedInInvestingActivities"),
    extractFacts(facts, "CashProvidedByUsedInInvestingActivities"),
  ].filter((arr) => arr.length > 0);
  const investingRaw =
    investingCandidates.length > 0
      ? investingCandidates.reduce((best, cur) => {
          const bestLatest = best[best.length - 1]?.end || "";
          const curLatest = cur[cur.length - 1]?.end || "";
          return curLatest > bestLatest ? cur : best;
        })
      : [];

  const currentAssetsRaw = extractFacts(facts, "AssetsCurrent");
  const currentLiabRaw = extractFacts(facts, "LiabilitiesCurrent");
  const ltdRaw =
    extractFacts(facts, "LongTermDebtNoncurrent").length > 0
      ? extractFacts(facts, "LongTermDebtNoncurrent")
      : extractFacts(facts, "LongTermDebt");
  const debtCurrentRaw = extractFacts(facts, "DebtCurrent");

  const financials: CompanyFinancials = {
    revenue: deduplicatePeriods(revenueRaw),
    netIncome: deduplicatePeriods(extractFacts(facts, "NetIncomeLoss")),
    operatingIncome: deduplicatePeriods(extractFacts(facts, "OperatingIncomeLoss")),
    eps: deduplicatePeriods(extractFacts(facts, "EarningsPerShareDiluted", "USD/shares")),
    totalAssets: deduplicatePeriods(extractFacts(facts, "Assets")),
    totalLiabilities: deduplicatePeriods(extractFacts(facts, "Liabilities")),
    stockholdersEquity: deduplicatePeriods(
      extractFacts(facts, "StockholdersEquity").length > 0
        ? extractFacts(facts, "StockholdersEquity")
        : extractFacts(facts, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    ),
    cash: deduplicatePeriods(extractFacts(facts, "CashAndCashEquivalentsAtCarryingValue")),
    sharesOutstanding: deduplicatePeriods(extractFacts(facts, "CommonStockSharesOutstanding", "shares")),
    grossProfit: deduplicatePeriods(extractFacts(facts, "GrossProfit")),
    operatingCashFlow: deduplicatePeriods(operatingCashFlowRaw),
    capitalExpenditures: deduplicatePeriods(capexRaw),
    financingCashFlow: deduplicatePeriods(financingRaw),
    investingCashFlow: deduplicatePeriods(investingRaw),
    assetsCurrent: deduplicatePeriods(currentAssetsRaw),
    liabilitiesCurrent: deduplicatePeriods(currentLiabRaw),
    longTermDebt: deduplicatePeriods(ltdRaw),
    debtCurrent: deduplicatePeriods(debtCurrentRaw),
  };
  financialsCache.set(sym, { data: financials, ts: Date.now() });
  return financials;
}

router.get("/company-financials", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const financials = await fetchCompanyFinancialsForSymbol(symbol);
    if (financials === null) {
      return res.json({ financials: null, symbol });
    }
    return res.json({ financials, symbol });
  } catch (err: any) {
    req.log?.error({ err }, "Company financials endpoint error");
    return res.status(502).json({ error: "SEC upstream unavailable", financials: null });
  }
});

export default router;
