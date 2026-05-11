import { Router, type IRouter } from "express";
import { logFailure } from "../lib/telemetry.js";

const router: IRouter = Router();

const HEADERS = {
  "User-Agent": "AlphaTerminal support@alphaterminal.app",
  "Accept": "application/json",
};

const FETCH_TIMEOUT_MS = 10_000;

export interface EdgarFiling {
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

export async function fetchEdgarFilings(
  ticker: string,
  log?: any,
  signal?: AbortSignal,
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
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
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

/** Decode common XML/HTML entities from SEC EDGAR text (no extra deps). */
function decodeXmlEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'");
}

interface InsiderTransaction {
  ownerName: string;
  isDirector: boolean;
  isOfficer: boolean;
  officerTitle: string;
  transactionDate: string;
  transactionCode: string;
  shares: number;
  pricePerShare: number | null;
  /** shares * pricePerShare when both are valid; otherwise null. */
  transactionValueUsd: number | null;
  acquiredOrDisposed: string;
  sharesAfter: number | null;
  filingUrl: string;
  /** True when footnotes reference Rule 10b5-1 (planned trading). */
  rule10b51Plan: boolean;
  /** Open-market Form 4 codes P and S only; default Ownership table. */
  showInOpenMarketDefault: boolean;
}

function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>\\s*(?:<value>)?([^<]*)(?:<\\/value>)?`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function stripXmlInner(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseForm4Footnotes(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<footnote\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/footnote>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    map.set(m[1].trim(), stripXmlInner(m[2]));
  }
  return map;
}

function collectFootnoteIds(block: string): string[] {
  const ids: string[] = [];
  const re = /footnoteId[^>]*\bid="([^"]+)"/gi;
  let m;
  while ((m = re.exec(block)) !== null) ids.push(m[1].trim());
  // SEC XML often uses self-closing tags: <footnoteId id="F1"/>
  const re2 = /<footnoteId\s+id="([^"]+)"\s*\/?>/gi;
  while ((m = re2.exec(block)) !== null) ids.push(m[1].trim());
  return [...new Set(ids)];
}

function footnotesMention10b51(footnotes: Map<string, string>, ids: string[]): boolean {
  for (const id of ids) {
    const t = footnotes.get(id) || "";
    if (/\b10\s*b\s*5\s*-?\s*1\b/i.test(t)) return true;
    if (/rule\s*10b5/i.test(t) && /plan/i.test(t)) return true;
    if (/10b5\s*-?\s*1/i.test(t)) return true;
  }
  return false;
}

function extractTransactionCode(block: string): string {
  const coding = block.match(/<transactionCoding[^>]*>([\s\S]*?)<\/transactionCoding>/i);
  const inner = coding ? coding[1] : block;
  const m = inner.match(/<transactionCode>(?:\s*<value>)?\s*([^<\s]+)\s*(?:<\/value>)?\s*<\/transactionCode>/i)
    || inner.match(/<transactionCode>\s*([^<]+)<\/transactionCode>/i);
  return (m?.[1] || "").trim().toUpperCase();
}

function parseForm4Xml(xml: string, filingUrl: string): InsiderTransaction[] {
  const results: InsiderTransaction[] = [];
  const footnotes = parseForm4Footnotes(xml);

  const ownerName = decodeXmlEntities(xmlText(xml, "rptOwnerName"));
  const isDirector = xmlText(xml, "isDirector") === "1";
  const isOfficer = xmlText(xml, "isOfficer") === "1";
  const officerTitle = decodeXmlEntities(xmlText(xml, "officerTitle"));

  const txnRegex = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi;
  let m;
  while ((m = txnRegex.exec(xml)) !== null) {
    const block = m[1];
    const dateMatch = block.match(/<transactionDate>\s*<value>([^<]*)<\/value>/i);
    const code = extractTransactionCode(block);
    const sharesMatch = block.match(/<transactionShares>\s*<value>([^<]*)<\/value>/i);
    const priceMatch = block.match(/<transactionPricePerShare>\s*<value>([^<]*)<\/value>/i);
    const adMatch = block.match(/<transactionAcquiredDisposedCode>\s*<value>([^<]*)<\/value>/i);
    const afterMatch = block.match(/<sharesOwnedFollowingTransaction>\s*<value>([^<]*)<\/value>/i);

    if (code === "L" || code === "Z") continue;

    const fnIds = collectFootnoteIds(block);
    const rule10b51Plan = footnotesMention10b51(footnotes, fnIds);
    const showInOpenMarketDefault = code === "P" || code === "S";

    const price = priceMatch ? parseFloat(priceMatch[1]) : null;
    const sharesRaw = sharesMatch ? parseInt(sharesMatch[1].replace(/,/g, ""), 10) : 0;
    const absShares = Math.abs(sharesRaw);
    const priceOk = price != null && Number.isFinite(price) && price > 0;
    const transactionValueUsd = priceOk && absShares > 0 ? absShares * price : null;

    results.push({
      ownerName,
      isDirector,
      isOfficer,
      officerTitle: officerTitle || (isDirector ? "Director" : ""),
      transactionDate: dateMatch?.[1] || "",
      transactionCode: code,
      shares: absShares,
      pricePerShare: priceOk ? price : null,
      transactionValueUsd,
      acquiredOrDisposed: (adMatch?.[1] || "").trim().toUpperCase(),
      sharesAfter: afterMatch ? parseInt(afterMatch[1].replace(/,/g, ""), 10) : null,
      filingUrl,
      rule10b51Plan,
      showInOpenMarketDefault,
    });
  }
  return results;
}

const insiderCache = new Map<string, { transactions: InsiderTransaction[]; ts: number; version: number }>();
const INSIDER_CACHE_TTL = 5 * 60 * 1000;
const INSIDER_PARSE_VERSION = 5;

router.get("/insider-transactions", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const cached = insiderCache.get(symbol);
    if (cached && cached.version === INSIDER_PARSE_VERSION && Date.now() - cached.ts < INSIDER_CACHE_TTL) {
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

    insiderCache.set(symbol, { transactions: allTransactions, ts: Date.now(), version: INSIDER_PARSE_VERSION });
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

  const sharesParsed = sharesMatch ? parseInt(sharesMatch[1].replace(/,/g, ""), 10) : NaN;
  const pctParsed = pctMatch ? parseFloat(pctMatch[1]) : NaN;
  const shares = Number.isFinite(sharesParsed) && sharesParsed > 0 ? sharesParsed : 0;
  const pct = Number.isFinite(pctParsed) && pctParsed > 0 ? pctParsed : 0;

  if (!nameMatch[1].trim()) return null;

  return {
    name: decodeXmlEntities(nameMatch[1].trim()),
    shares,
    percentOfClass: pct,
    filingDate,
    formType,
  };
}

const holdersCache = new Map<string, { holders: InstitutionalHolder[]; ts: number }>();
const HOLDERS_CACHE_TTL = 10 * 60 * 1000;

/** Keep rows that have at least one of percent or shares to display (suppress all-dash rows). */
function filterInstitutionalHoldersForDisplay(holders: InstitutionalHolder[]): InstitutionalHolder[] {
  return holders.filter((h) => {
    const pctOk = h.percentOfClass != null && Number.isFinite(h.percentOfClass) && h.percentOfClass > 0;
    const shOk = h.shares != null && Number.isFinite(h.shares) && h.shares > 0;
    return pctOk || shOk;
  });
}

router.get("/institutional-holders", async (req, res) => {
  const symbol = (req.query.symbol as string || "").trim().toUpperCase().replace(/^\$/, "");
  if (!symbol) return res.status(400).json({ error: "symbol required" });

  try {
    const cached = holdersCache.get(symbol);
    if (cached && Date.now() - cached.ts < HOLDERS_CACHE_TTL) {
      return res.json({ holders: filterInstitutionalHoldersForDisplay(cached.holders), symbol });
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

    const holdersOut = filterInstitutionalHoldersForDisplay(holders);
    holdersCache.set(symbol, { holders, ts: Date.now() });
    return res.json({ holders: holdersOut, symbol });
  } catch (err: any) {
    req.log?.error({ err }, "Institutional holders endpoint error");
    return res.status(502).json({ error: "SEC upstream unavailable", holders: [] });
  }
});


// ─── COMPANY FINANCIALS (XBRL companyfacts) ──────────────────────────────────

interface FinancialPeriod {
  end: string;
  val: number | null;
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
  /** Sum of long-term and current debt components per FY (10-K FY only). */
  totalDebt?: FinancialPeriod[];
}

/** Annual 10-K fiscal-year facts only (no 10-Q backfill). */
function extractFacts10KFY(facts: SecCompanyFactsJson["facts"], tag: string, unit: string = "USD"): FinancialPeriod[] {
  const tagData = facts?.["us-gaap"]?.[tag];
  if (!tagData) return [];
  const entries = tagData.units?.[unit] || tagData.units?.["USD/shares"] || tagData.units?.["shares"] || [];
  return entries
    .filter((e: XbrlFactUnitEntry) =>
      e.form === "10-K"
      && (e.fp === "FY" || e.fp === undefined || e.fp === "")
      && e.fy != null
      && e.end
      && e.val !== undefined
      && e.filed
    )
    .map((e: XbrlFactUnitEntry) => ({
      end: e.end!,
      val: e.val!,
      form: "10-K",
      fy: e.fy!,
      fp: e.fp || "FY",
      filed: e.filed!,
    }));
}

/** One row per fiscal year (latest filing wins). Sorted ascending by FY. */
function dedupeByFyLatestFiled(periods: FinancialPeriod[]): FinancialPeriod[] {
  const byFy = new Map<number, FinancialPeriod>();
  for (const p of periods) {
    const cur = byFy.get(p.fy);
    if (!cur || p.filed > cur.filed) byFy.set(p.fy, p);
  }
  return Array.from(byFy.entries()).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function lastNFiscalYears(periods: FinancialPeriod[], n: number): FinancialPeriod[] {
  const d = dedupeByFyLatestFiled(periods);
  return d.slice(-n);
}

function mergeRevenueSeries(facts: SecCompanyFactsJson["facts"]): FinancialPeriod[] {
  const candidates = [
    extractFacts10KFY(facts, "Revenues"),
    extractFacts10KFY(facts, "RevenueFromContractWithCustomerExcludingAssessedTax"),
    extractFacts10KFY(facts, "SalesRevenueNet"),
  ].filter(a => a.length > 0);
  if (candidates.length === 0) return [];
  const byFy = new Map<number, FinancialPeriod>();
  for (const arr of candidates) {
    for (const p of dedupeByFyLatestFiled(arr)) {
      if (!byFy.has(p.fy)) byFy.set(p.fy, p);
    }
  }
  const merged = Array.from(byFy.entries()).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return lastNFiscalYears(merged, 5);
}

function valForFy(facts: SecCompanyFactsJson["facts"], tag: string, fy: number, unit = "USD"): number | null {
  const arr = dedupeByFyLatestFiled(extractFacts10KFY(facts, tag, unit));
  const p = arr.find(x => x.fy === fy);
  return p?.val ?? null;
}

function debtForFy(facts: SecCompanyFactsJson["facts"], fy: number): number | null {
  const ltdN = valForFy(facts, "LongTermDebtNoncurrent", fy);
  const ltdC = valForFy(facts, "LongTermDebtCurrent", fy);
  const stB = valForFy(facts, "ShortTermBorrowings", fy);
  const debtC = valForFy(facts, "DebtCurrent", fy);
  const parts = [ltdN, ltdC, stB, debtC].filter((v): v is number => v != null && !Number.isNaN(v));
  if (parts.length > 0) return parts.reduce((s, v) => s + v, 0);
  const ltd = valForFy(facts, "LongTermDebt", fy);
  return ltd != null ? ltd : null;
}

function liabilitiesSeries(facts: SecCompanyFactsJson["facts"]): FinancialPeriod[] {
  const direct = dedupeByFyLatestFiled(extractFacts10KFY(facts, "Liabilities"));
  if (direct.length > 0) return lastNFiscalYears(direct, 5);

  const alt = dedupeByFyLatestFiled(extractFacts10KFY(facts, "TotalLiabilitiesNet"));
  if (alt.length > 0) return lastNFiscalYears(alt, 5);

  const assets = dedupeByFyLatestFiled(extractFacts10KFY(facts, "Assets"));
  const equity = dedupeByFyLatestFiled(
    extractFacts10KFY(facts, "StockholdersEquity").length > 0
      ? extractFacts10KFY(facts, "StockholdersEquity")
      : extractFacts10KFY(facts, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
  );
  const am = new Map(assets.map(p => [p.fy, p]));
  const em = new Map(equity.map(p => [p.fy, p]));
  const fys = new Set<number>([...am.keys(), ...em.keys()]);
  const out: FinancialPeriod[] = [];
  for (const fy of Array.from(fys).sort((a, b) => a - b)) {
    const a = am.get(fy);
    const e = em.get(fy);
    if (a && e && a.val != null && e.val != null) {
      out.push({
        end: a.end,
        val: a.val - e.val,
        form: "10-K",
        fy,
        fp: "FY",
        filed: a.filed > e.filed ? a.filed : e.filed,
      });
    }
  }
  return lastNFiscalYears(out, 5);
}

function totalDebtSeries(facts: SecCompanyFactsJson["facts"]): FinancialPeriod[] {
  const fys = new Set<number>();
  for (const tag of ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtCurrent", "ShortTermBorrowings", "DebtCurrent"]) {
    for (const p of dedupeByFyLatestFiled(extractFacts10KFY(facts, tag))) fys.add(p.fy);
  }
  const sorted = Array.from(fys).sort((a, b) => a - b);
  const out: FinancialPeriod[] = [];
  for (const fy of sorted) {
    const v = debtForFy(facts, fy);
    if (v == null) continue;
    const meta = ["LongTermDebtNoncurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "DebtCurrent", "LongTermDebt"]
      .map(t => dedupeByFyLatestFiled(extractFacts10KFY(facts, t)).find(x => x.fy === fy))
      .filter((x): x is FinancialPeriod => !!x)
      .sort((a, b) => b.filed.localeCompare(a.filed))[0];
    if (meta) out.push({ end: meta.end, val: v, form: "10-K", fy, fp: "FY", filed: meta.filed });
  }
  return lastNFiscalYears(out, 5);
}

function mergeCashFlowTagPair(
  facts: SecCompanyFactsJson["facts"],
  tagA: string,
  tagB: string,
): FinancialPeriod[] {
  const byFy = new Map<number, FinancialPeriod>();
  for (const arr of [extractFacts10KFY(facts, tagA), extractFacts10KFY(facts, tagB)]) {
    for (const p of dedupeByFyLatestFiled(arr)) {
      if (!byFy.has(p.fy)) byFy.set(p.fy, p);
    }
  }
  return lastNFiscalYears(Array.from(byFy.entries()).sort((x, y) => x[0] - y[0]).map(([, v]) => v), 5);
}

function ocfSeries(facts: SecCompanyFactsJson["facts"]): FinancialPeriod[] {
  return mergeCashFlowTagPair(facts, "NetCashProvidedByUsedInOperatingActivities", "CashProvidedByUsedInOperatingActivities");
}

function capexSeries(facts: SecCompanyFactsJson["facts"]): FinancialPeriod[] {
  return mergeCashFlowTagPair(facts, "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForCapitalImprovements");
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

  const equitySeries = dedupeByFyLatestFiled(
    extractFacts10KFY(facts, "StockholdersEquity").length > 0
      ? extractFacts10KFY(facts, "StockholdersEquity")
      : extractFacts10KFY(facts, "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
  );

  const financials: CompanyFinancials = {
    revenue: mergeRevenueSeries(facts),
    netIncome: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "NetIncomeLoss")), 5),
    operatingIncome: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "OperatingIncomeLoss")), 5),
    eps: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "EarningsPerShareDiluted", "USD/shares")), 5),
    totalAssets: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "Assets")), 5),
    totalLiabilities: liabilitiesSeries(facts),
    stockholdersEquity: lastNFiscalYears(equitySeries, 5),
    cash: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "CashAndCashEquivalentsAtCarryingValue")), 5),
    sharesOutstanding: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "CommonStockSharesOutstanding", "shares")), 5),
    grossProfit: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "GrossProfit")), 5),
    operatingCashFlow: ocfSeries(facts),
    capitalExpenditures: capexSeries(facts),
    financingCashFlow: mergeCashFlowTagPair(facts, "NetCashProvidedByUsedInFinancingActivities", "CashProvidedByUsedInFinancingActivities"),
    investingCashFlow: mergeCashFlowTagPair(facts, "NetCashProvidedByUsedInInvestingActivities", "CashProvidedByUsedInInvestingActivities"),
    assetsCurrent: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "AssetsCurrent")), 5),
    liabilitiesCurrent: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "LiabilitiesCurrent")), 5),
    longTermDebt: lastNFiscalYears(
      dedupeByFyLatestFiled(
        extractFacts10KFY(facts, "LongTermDebtNoncurrent").length > 0
          ? extractFacts10KFY(facts, "LongTermDebtNoncurrent")
          : extractFacts10KFY(facts, "LongTermDebt"),
      ),
      5,
    ),
    debtCurrent: lastNFiscalYears(dedupeByFyLatestFiled(extractFacts10KFY(facts, "DebtCurrent")), 5),
    totalDebt: totalDebtSeries(facts),
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
