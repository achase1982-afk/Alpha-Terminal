import { Router, type IRouter } from "express";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/quote", (_req, res) => {
  res.json({ symbol: "", error: "not_configured" });
});

router.get("/history", (_req, res) => {
  res.json({ symbol: "", candles: [], error: "not_configured" });
});

router.get("/options", (_req, res) => {
  res.json({ symbol: "", calls: [], puts: [], error: "not_configured" });
});

router.get("/pc-ratio", (_req, res) => {
  res.json({ symbol: "", pcRatio: null, error: "not_configured" });
});

router.get("/fundamentals", (_req, res) => {
  res.json({ symbol: "", error: "not_configured" });
});

router.get("/earnings-date", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();

  if (!symbol) {
    return res.status(400).json({ symbol: "", earningsDate: null });
  }

  const cleanSymbol = symbol.replace(/^\$/, "");

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=calendarEvents`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      req.log.warn({ status: response.status, symbol }, "Yahoo earnings fetch failed, trying scrape fallback");

      const pageUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(cleanSymbol)}/`;
      const pageRes = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (pageRes.ok) {
        const html = await pageRes.text();
        const dateMatch = html.match(/Earnings Date.*?(\w{3} \d{1,2}, \d{4})/s);
        if (dateMatch) {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) {
            const iso = parsed.toISOString().slice(0, 10);
            return res.json({ symbol: cleanSymbol, earningsDate: iso });
          }
        }
      }

      return res.json({ symbol: cleanSymbol, earningsDate: null });
    }

    const json = await response.json() as Record<string, unknown>;
    const result = (json as any)?.quoteSummary?.result?.[0];
    const earnings = result?.calendarEvents?.earnings;
    const earningsDateArr = earnings?.earningsDate;

    if (Array.isArray(earningsDateArr) && earningsDateArr.length > 0) {
      const rawTs = earningsDateArr[0]?.raw;
      if (typeof rawTs === "number") {
        const d = new Date(rawTs * 1000);
        const iso = d.toISOString().slice(0, 10);
        return res.json({ symbol: cleanSymbol, earningsDate: iso });
      }
      const fmt = earningsDateArr[0]?.fmt;
      if (typeof fmt === "string") {
        return res.json({ symbol: cleanSymbol, earningsDate: fmt });
      }
    }

    res.json({ symbol: cleanSymbol, earningsDate: null });
  } catch (err) {
    req.log.error({ err, symbol }, "Earnings date fetch error");
    res.json({ symbol: cleanSymbol, earningsDate: null });
  }
});

const FUTURES_NEWS_MAP: Record<string, string> = {
  "/ES": "SPY",
  "/MES": "SPY",
  "/NQ": "QQQ",
  "/MNQ": "QQQ",
  "/YM": "DIA",
  "/MYM": "DIA",
  "/RTY": "IWM",
  "/M2K": "IWM",
  "/CL": "USO",
  "/MCL": "USO",
  "/GC": "GLD",
  "/MGC": "GLD",
  "/SI": "SLV",
  "/ZB": "TLT",
  "/ZN": "TLT",
  "/BZ": "BNO",
  "/NG": "UNG",
  "/HG": "CPER",
  "/6E": "FXE",
  "/6J": "FXY",
};

function futuresNewsSymbol(sym: string): string {
  const upper = sym.toUpperCase().trim();
  if (FUTURES_NEWS_MAP[upper]) return FUTURES_NEWS_MAP[upper];
  const base = upper.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  if (FUTURES_NEWS_MAP[base]) return FUTURES_NEWS_MAP[base];
  return upper;
}

interface NormalizedArticle {
  id: number;
  source: string;
  headline: string;
  summary: string;
  url: string;
  image: string;
  datetime: number;
  related: string;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function polygonNewsTicker(symbol: string): string {
  if (symbol.startsWith("/")) {
    const futuresMap: Record<string, string> = {
      "/ES": "I:SPX", "/NQ": "I:NDX", "/YM": "I:DJI", "/RTY": "I:RUT",
      "/CL": "X:CLUSD", "/GC": "X:GCUSD", "/SI": "X:SIUSD", "/NG": "X:NGUSD",
    };
    const base = symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
    return futuresMap[base] || futuresMap[symbol] || "";
  }
  if (symbol.startsWith("$")) {
    const indexMap: Record<string, string> = {
      "$SPX": "I:SPX", "$NDX": "I:NDX", "$DJI": "I:DJI", "$RUT": "I:RUT", "$VIX": "I:VIX",
    };
    return indexMap[symbol] || "";
  }
  return symbol;
}

async function fetchPolygonNews(symbol: string, apiKey: string, log: any): Promise<NormalizedArticle[]> {
  const polygonTicker = polygonNewsTicker(symbol);
  const tickerParam = polygonTicker ? `&ticker=${encodeURIComponent(polygonTicker)}` : "";
  const url = `https://api.polygon.io/v2/reference/news?limit=50${tickerParam}&order=desc&sort=published_utc&apiKey=${apiKey}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      log.warn({ status: response.status, symbol }, "Polygon news API error");
      return [];
    }

    const data = await response.json() as {
      results?: Array<{
        id: string;
        publisher: { name: string };
        title: string;
        article_url: string;
        image_url?: string;
        description?: string;
        published_utc: string;
        tickers?: string[];
      }>;
    };

    const results = data.results || [];
    log.info({ symbol, count: results.length }, "Polygon news fetched");

    return results.map(a => ({
      id: Math.abs(hashString(a.id || a.article_url)),
      source: (a.publisher?.name || "Polygon").toUpperCase(),
      headline: a.title || "",
      summary: (a.description || "").slice(0, 300),
      url: a.article_url || "",
      image: a.image_url || "",
      datetime: a.published_utc ? Math.floor(new Date(a.published_utc).getTime() / 1000) : Math.floor(Date.now() / 1000),
      related: polygonTicker || symbol,
    }));
  } catch (err) {
    log.warn({ err, symbol }, "Polygon news fetch failed");
    return [];
  }
}

async function fetchFinnhubNews(cleanSymbol: string, apiKey: string, log: any): Promise<NormalizedArticle[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cleanSymbol)}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      log.warn({ status: response.status, symbol: cleanSymbol }, "Finnhub news API error");
      return [];
    }

    const raw = await response.json() as Array<{
      id: number;
      category: string;
      datetime: number;
      headline: string;
      image: string;
      related: string;
      source: string;
      summary: string;
      url: string;
    }>;

    return (Array.isArray(raw) ? raw : []).slice(0, 30).map(a => ({
      id: a.id,
      source: (a.source || "Unknown").toUpperCase(),
      headline: a.headline || "",
      summary: a.summary || "",
      url: a.url || "",
      image: a.image || "",
      datetime: a.datetime || 0,
      related: a.related || "",
    }));
  } catch (err) {
    log.warn({ err, symbol: cleanSymbol }, "Finnhub news fetch failed");
    return [];
  }
}

router.get("/news", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();

  if (!symbol) {
    return res.status(400).json({ articles: [], error: "symbol is required" });
  }

  const isFuturesNews = symbol.startsWith("/");
  const finnhubSymbol = isFuturesNews ? futuresNewsSymbol(symbol) : symbol.replace(/^\$/, "");
  const finnhubKey = process.env["FINNHUB_API_KEY"];
  const polygonKey = process.env["POLYGON_API_KEY"];

  const [finnhubArticles, polygonArticles] = await Promise.all([
    finnhubKey ? fetchFinnhubNews(finnhubSymbol, finnhubKey, req.log) : Promise.resolve([]),
    polygonKey ? fetchPolygonNews(symbol, polygonKey, req.log) : Promise.resolve([]),
  ]);

  const seenHeadlines = new Set<string>();
  const merged: NormalizedArticle[] = [];

  for (const a of finnhubArticles) {
    const key = a.headline.toLowerCase().slice(0, 60);
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      merged.push(a);
    }
  }

  for (const a of polygonArticles) {
    const key = a.headline.toLowerCase().slice(0, 60);
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      merged.push(a);
    }
  }

  merged.sort((a, b) => b.datetime - a.datetime);

  res.json({ articles: merged.slice(0, 50) });
});

async function resolveArticleUrl(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    return resp.url || url;
  } catch {
    return url;
  }
}

function isSafeUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const blocked = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|169\.254\.|\[::1\]|\[fc|\[fd)/i;
    if (blocked.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

router.get("/proxy-article", async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    if (!isSafeUrl(url)) {
      return res.status(400).json({ error: "blocked host" });
    }

    const parsed = new URL(url);
    const isFinnhub = parsed.hostname === "finnhub.io" && parsed.pathname.startsWith("/api/news");

    let articleUrl = url;
    if (isFinnhub) {
      articleUrl = await resolveArticleUrl(url);
      if (!isSafeUrl(articleUrl)) {
        return res.status(400).json({ error: "blocked host" });
      }
    }

    const response = await fetch(articleUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    const finalUrl = response.url || articleUrl;

    if (!response.ok) {
      const rawTitle = (req.query.title as string) || "Article";
      const rawSource = (req.query.source as string) || "";
      const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const fallbackHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:#1C1C1E;color:#e4e4e7}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:20px 16px 80px;max-width:680px;margin:0 auto}
.s{color:#FFB800;font-size:10px;text-transform:uppercase;letter-spacing:.15em;font-family:"SF Mono",monospace;font-weight:600;margin-bottom:8px}
h1{color:#fff;font-size:22px;font-weight:700;line-height:1.3;margin-bottom:24px}
p{color:#a1a1aa;line-height:1.7;margin-bottom:16px}
a{color:#FFB800;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
</style></head><body>
${rawSource ? `<div class="s">${escH(rawSource)}</div>` : ""}
<h1>${escH(rawTitle)}</h1>
<p>This article requires a subscription or could not be accessed directly.</p>
<p><a href="${escH(articleUrl)}">Read on ${escH(new URL(articleUrl).hostname.replace(/^www\./, ""))} →</a></p>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(fallbackHtml);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(502).json({ error: "not html" });
    }

    const rawHtml = await response.text();

    const { Readability } = await import("@mozilla/readability");
    const { parseHTML } = await import("linkedom");

    function extractArticle(html: string) {
      const { document: doc } = parseHTML(html);
      const reader = new Readability(doc as any, { charThreshold: 100 });
      return reader.parse();
    }

    function sanitizeContent(html: string): string {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/<object[\s\S]*?<\/object>/gi, "")
        .replace(/<embed[\s\S]*?>/gi, "")
        .replace(/<form[\s\S]*?<\/form>/gi, "")
        .replace(/<input[\s\S]*?>/gi, "")
        .replace(/<textarea[\s\S]*?<\/textarea>/gi, "")
        .replace(/<button[\s\S]*?<\/button>/gi, "")
        .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "")
        .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")
        .replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
        .replace(/javascript\s*:/gi, "void:")
        .replace(/data\s*:\s*text\/html/gi, "data:text/plain");
    }

    let article = extractArticle(rawHtml);
    const textLen = article?.textContent?.trim().length ?? 0;

    if (textLen < 200) {
      try {
        const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(finalUrl)}`;
        const cacheResp = await fetch(cacheUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        if (cacheResp.ok) {
          const cacheHtml = await cacheResp.text();
          const cacheArticle = extractArticle(cacheHtml);
          const cacheLen = cacheArticle?.textContent?.trim().length ?? 0;
          if (cacheLen > textLen) {
            article = cacheArticle;
            req.log.info({ textLen, cacheLen }, "Used Google cache for better content");
          }
        }
      } catch {}
    }

    const baseObj = new URL(finalUrl);
    const siteName = article?.siteName || baseObj.hostname.replace(/^www\./, "");
    const rawTitle = (req.query.title as string) || article?.title || "Article";
    const rawSource = (req.query.source as string) || siteName;
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const title = escHtml(rawTitle);
    const source = escHtml(rawSource);

    const finalTextLen = article?.textContent?.trim().length ?? 0;
    let articleContent: string;
    if (finalTextLen < 100) {
      articleContent = `<p style="color:#a1a1aa;margin-top:24px;">This article is behind a paywall or could not be fully extracted.</p>
<p style="margin-top:16px;"><a href="${escHtml(finalUrl)}" style="color:#FFB800;text-decoration:none;font-weight:600;">Read full article on ${escHtml(baseObj.hostname.replace(/^www\./, ""))} →</a></p>`;
    } else {
      articleContent = sanitizeContent(article?.content || "<p>Could not extract article content.</p>");
    }

    const readerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=yes">
  <meta name="referrer" content="no-referrer">
  <meta name="format-detection" content="telephone=no">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <base href="${baseObj.origin}/">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #1C1C1E; color: #e4e4e7; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
    html { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      line-height: 1.75; font-size: 16px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
      padding: 20px 16px 80px; padding: 20px max(16px, env(safe-area-inset-left)) calc(80px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-right));
      max-width: 680px; margin: 0 auto; min-height: 100%;
      word-wrap: break-word; overflow-wrap: break-word;
    }
    .reader-source { color: #FFB800; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em;
      font-family: "SF Mono", SFMono-Regular, ui-monospace, monospace; font-weight: 600; margin-bottom: 8px; }
    .reader-title { color: #fff; font-size: 22px; font-weight: 700; line-height: 1.3; margin-bottom: 12px; }
    .reader-meta { color: #71717a; font-size: 12px; font-family: "SF Mono", monospace; margin-bottom: 24px;
      padding-bottom: 16px; border-bottom: 1px solid #2A2A2C; }
    .reader-content { color: #d4d4d8; }
    .reader-content p { margin-bottom: 1.2em; }
    .reader-content h1, .reader-content h2, .reader-content h3, .reader-content h4 { color: #fff; margin: 1.5em 0 0.5em; font-weight: 600; }
    .reader-content h2 { font-size: 20px; }
    .reader-content h3 { font-size: 18px; }
    .reader-content a { color: #FFB800; text-decoration: none; }
    .reader-content a:hover { text-decoration: underline; }
    .reader-content img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
    .reader-content figure { margin: 16px 0; }
    .reader-content figcaption { color: #71717a; font-size: 13px; margin-top: 6px; }
    .reader-content blockquote { border-left: 3px solid #FFB800; padding-left: 16px; margin: 16px 0; color: #a1a1aa; font-style: italic; }
    .reader-content pre, .reader-content code { background: #151517; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    .reader-content pre { padding: 12px; overflow-x: auto; }
    .reader-content ul, .reader-content ol { margin: 0.8em 0; padding-left: 1.5em; }
    .reader-content li { margin-bottom: 0.4em; }
    .reader-content table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .reader-content th, .reader-content td { padding: 8px 12px; border: 1px solid #2A2A2C; text-align: left; }
    .reader-content th { background: #151517; color: #fff; font-weight: 600; }
    ::selection { background: #FFB800; color: #0a0a0a; }
    @media (max-width: 480px) { body { padding: 16px 12px 60px; } .reader-title { font-size: 19px; } }
  </style>
</head>
<body>
  <div class="reader-source">${source}</div>
  <h1 class="reader-title">${title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h1>
  <div class="reader-meta">${siteName} · ${new URL(finalUrl).hostname}</div>
  <div class="reader-content">${articleContent}</div>
  <script>document.addEventListener("click",function(e){var a=e.target;while(a&&a.tagName!=="A")a=a.parentElement;if(!a||!a.href)return;var h=a.href;if(!h.match(/^https?:\\/\\//))return;e.preventDefault();e.stopPropagation();if(window.parent!==window){try{window.parent.postMessage({type:"proxy-navigate",url:h},document.referrer||"*")}catch(x){window.parent.postMessage({type:"proxy-navigate",url:h},"*")}}},true);</script>
</body>
</html>`;

    function setSecurityHeaders(r: typeof res) {
      r.setHeader("Content-Type", "text/html; charset=utf-8");
      r.setHeader("Cache-Control", "private, max-age=300");
      r.setHeader("X-Content-Type-Options", "nosniff");
      r.setHeader("X-Frame-Options", "SAMEORIGIN");
      r.setHeader("Referrer-Policy", "no-referrer");
      r.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()");
      r.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; base-uri 'self'; form-action 'none'; frame-ancestors 'self'");
    }

    setSecurityHeaders(res);
    res.send(readerHtml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    req.log.error({ err: msg, url }, "proxy-article error");
    const rawTitle = (req.query.title as string) || "Article";
    const rawSource = (req.query.source as string) || "";
    const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const errorHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:#1C1C1E;color:#e4e4e7}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:20px 16px 80px;padding:20px max(16px,env(safe-area-inset-left)) 80px max(16px,env(safe-area-inset-right));max-width:680px;margin:0 auto}
.s{color:#FFB800;font-size:10px;text-transform:uppercase;letter-spacing:.15em;font-family:"SF Mono",monospace;font-weight:600;margin-bottom:8px}
h1{color:#fff;font-size:22px;font-weight:700;line-height:1.3;margin-bottom:24px}
p{color:#a1a1aa;line-height:1.7;margin-bottom:16px}
a{color:#FFB800;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
</style></head><body>
${rawSource ? `<div class="s">${escH(rawSource)}</div>` : ""}
<h1>${escH(rawTitle)}</h1>
<p>Could not load this article.</p>
<p><a href="${escH(url || "")}">Open in browser →</a></p>
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'none'; frame-ancestors 'self'");
    res.send(errorHtml);
  }
});

export default router;
