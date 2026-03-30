import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

export function requireAccessToken(req: Request, res: Response, next: NextFunction) {
  const token = req.query["accessToken"] as string | undefined
    || req.body?.accessToken as string | undefined
    || req.headers.authorization?.replace("Bearer ", "");

  if (!token || typeof token !== "string" || token.length < 10) {
    return res.status(401).json({ error: "unauthorized", message: "Valid access token required" });
  }
  next();
}

export function requireInternalOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "OPTIONS") {
    return next();
  }
  const xRequestedWith = req.headers["x-requested-with"];
  if (xRequestedWith === "AlphaTerminal") {
    return next();
  }
  return res.status(403).json({ error: "forbidden", message: "Direct API access not allowed" });
}

export const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited", message: "AI request limit exceeded, please wait" },
});

export function sanitizeSymbol(symbol: string): string | null {
  if (!symbol || typeof symbol !== "string") return null;
  const cleaned = symbol.trim().toUpperCase().replace(/[^A-Z0-9/.$^-]/g, "");
  if (cleaned.length === 0 || cleaned.length > 20) return null;
  if (/[<>"';&|]/.test(symbol)) return null;
  return cleaned;
}

export function validateSymbolParam(req: Request, res: Response, next: NextFunction) {
  const raw = (req.query["symbol"] as string) || (req.body?.symbol as string);
  if (raw) {
    const cleaned = sanitizeSymbol(raw);
    if (!cleaned) {
      return res.status(400).json({ error: "invalid_symbol", message: "Invalid symbol format" });
    }
    if (req.query["symbol"]) req.query["symbol"] = cleaned;
    if (req.body?.symbol) req.body.symbol = cleaned;
  }
  next();
}
