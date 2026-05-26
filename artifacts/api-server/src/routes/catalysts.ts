import { Router } from "express";
import {
  normalizeCatalystGateSettings,
  type CatalystGateSettings,
} from "@workspace/catalysts-types";
import { buildCatalystsFeed } from "../lib/catalysts/buildCatalystsFeed.js";
import {
  getCatalystGateSettings,
  loadCatalystGateSettings,
  saveCatalystGateSettings,
} from "../lib/catalysts/catalystGateSettingsStore.js";
import { getLatestCatalystsFeed, persistCatalystsFeed } from "../lib/catalysts/catalystsFeedStore.js";

const router = Router();

router.get("/settings", async (_req, res) => {
  try {
    return res.json({ settings: getCatalystGateSettings() });
  } catch (err) {
    _req.log?.error({ err }, "Catalysts settings read failed");
    return res.status(500).json({ error: "Failed to load catalyst settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const body = req.body as { settings?: Partial<CatalystGateSettings> };
    const settings = await saveCatalystGateSettings(body.settings ?? {});
    return res.json({ ok: true, settings });
  } catch (err) {
    req.log?.error({ err }, "Catalysts settings save failed");
    return res.status(500).json({ error: "Failed to save catalyst settings" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const feed = await getLatestCatalystsFeed();
    return res.json(feed);
  } catch (err) {
    _req.log?.error({ err }, "Catalysts feed read failed");
    return res.status(500).json({ error: "Failed to load catalysts feed" });
  }
});

async function rebuildAndReturnFeed(settingsOverride?: Partial<CatalystGateSettings>) {
  const feed = await buildCatalystsFeed(new Date(), settingsOverride);
  await persistCatalystsFeed(feed);
  return feed;
}

/** Rebuild catalysts feed from harvest + tradeability gates (same as nightly job). */
router.post("/rebuild", async (req, res) => {
  try {
    const override = parseSettingsBody(req.body);
    const feed = await rebuildAndReturnFeed(override);
    return res.json({ ok: true, feed });
  } catch (err) {
    req.log?.error({ err }, "Catalysts rebuild request failed");
    return res.status(500).json({ error: "Failed to rebuild catalysts feed" });
  }
});

/** UI refresh — awaits full rebuild using saved (or body) gate settings. */
router.post("/refresh", async (req, res) => {
  try {
    const override = parseSettingsBody(req.body);
    const feed = await rebuildAndReturnFeed(override);
    return res.json({ ok: true, feed });
  } catch (err) {
    req.log?.error({ err }, "Catalysts refresh request failed");
    return res.status(500).json({ error: "Failed to refresh catalysts feed" });
  }
});

function parseSettingsBody(body: unknown): Partial<CatalystGateSettings> | undefined {
  if (!body || typeof body !== "object") return undefined;
  const settings = (body as { settings?: Partial<CatalystGateSettings> }).settings;
  if (!settings || typeof settings !== "object") return undefined;
  return normalizeCatalystGateSettings(settings);
}

export async function ensureCatalystGateSettingsLoaded(): Promise<void> {
  await loadCatalystGateSettings();
}

export default router;
