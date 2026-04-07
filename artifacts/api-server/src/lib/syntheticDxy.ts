import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.js";
import { getQuoteBySymbol, injectExternalQuote, type LiveQuote } from "./schwabStreamer.js";

const DATA_DIR = join(process.cwd(), ".data");
const CLOSE_FILE = join(DATA_DIR, "dxy_prev_close.json");

const INITIAL_PREV_CLOSE = 99.981;
const EUR_WEIGHT = 0.576;

let prevClose: number = INITIAL_PREV_CLOSE;
let lastSyntheticPrice: number | null = null;
let lastSavedDate: string | null = null;
let initialized = false;
let updateInterval: ReturnType<typeof setInterval> | null = null;
let eodInterval: ReturnType<typeof setInterval> | null = null;

function loadPrevClose(): number {
  try {
    if (existsSync(CLOSE_FILE)) {
      const raw = JSON.parse(readFileSync(CLOSE_FILE, "utf8"));
      if (typeof raw.prevClose === "number" && raw.prevClose > 0) {
        const savedDate = raw.date ?? "";
        lastSavedDate = savedDate;
        logger.info({ prevClose: raw.prevClose, date: savedDate }, "Loaded DXY prev close from disk");
        return raw.prevClose;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to load DXY prev close, using default");
  }
  return INITIAL_PREV_CLOSE;
}

function savePrevClose(price: number, date: string) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(CLOSE_FILE, JSON.stringify({ prevClose: price, date, savedAt: new Date().toISOString() }));
    logger.info({ prevClose: price, date }, "Saved DXY prev close to disk");
  } catch (err) {
    logger.warn({ err }, "Failed to save DXY prev close");
  }
}

function getETDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function getETHour(): number {
  return parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false }));
}

function computeSyntheticDxy(eurLast: number, eurClose: number): { price: number; change: number; changePct: number } | null {
  if (!eurClose || eurClose <= 0 || !eurLast || eurLast <= 0) return null;
  const eurChangePct = ((eurLast - eurClose) / eurClose) * 100;
  const dxyChangePct = -eurChangePct * EUR_WEIGHT;
  const price = Math.round((prevClose * (1 + dxyChangePct / 100)) * 1000) / 1000;
  const change = Math.round((price - prevClose) * 1000) / 1000;
  return { price, change, changePct: Math.round(dxyChangePct * 10000) / 10000 };
}

function updateSyntheticDxy() {
  const sixE = getQuoteBySymbol("/6E");
  if (!sixE || sixE.last === null || sixE.close === null) return;

  const result = computeSyntheticDxy(sixE.last, sixE.close);
  if (!result) return;

  lastSyntheticPrice = result.price;

  const quote: LiveQuote = {
    symbol: "$DXY",
    last: result.price,
    extendedLast: result.price,
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
    change: result.change,
    changePct: result.changePct,
    volume: null,
    high: null,
    low: null,
    close: prevClose,
    ts: Date.now(),
  };

  injectExternalQuote("$DXY", quote);
}

function checkEndOfDay() {
  const hour = getETHour();
  const today = getETDate();

  if (hour >= 16 && lastSyntheticPrice !== null && lastSavedDate !== today) {
    lastSavedDate = today;
    savePrevClose(lastSyntheticPrice, today);
    prevClose = lastSyntheticPrice;
    logger.info({ newPrevClose: prevClose, date: today }, "DXY prev close rolled forward in memory");
  }
}

export function initSyntheticDxy() {
  if (initialized) return;
  initialized = true;

  prevClose = loadPrevClose();
  logger.info({ prevClose }, "Synthetic DXY initialized");

  updateInterval = setInterval(() => {
    updateSyntheticDxy();
  }, 2000);

  eodInterval = setInterval(() => {
    checkEndOfDay();
  }, 5 * 60 * 1000);
}

export function getSyntheticDxyPrevClose(): number {
  return prevClose;
}

export function getLastSyntheticDxyPrice(): number | null {
  return lastSyntheticPrice;
}

export function stopSyntheticDxy() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  if (eodInterval) {
    clearInterval(eodInterval);
    eodInterval = null;
  }
  initialized = false;
}
