/**
 * Compare fixture ladder screenshot to pre-label baseline, masking caption pixels only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASELINE = path.join(__dirname, "../fixtures/at-ladder-pre-heat-caption-440x956.png");

function maskRect(data, width, x0, y0, x1, y1, fill = 0) {
  const xMin = Math.max(0, Math.floor(x0));
  const yMin = Math.max(0, Math.floor(y0));
  const xMax = Math.min(width, Math.ceil(x1));
  const yMax = Math.min(data.height, Math.ceil(y1));
  for (let y = yMin; y < yMax; y += 1) {
    for (let x = xMin; x < xMax; x += 1) {
      const idx = (width * y + x) << 2;
      data.data[idx] = fill;
      data.data[idx + 1] = fill;
      data.data[idx + 2] = fill;
      data.data[idx + 3] = 255;
    }
  }
}

/**
 * @param {{ currentPngPath: string, outDir: string, captionRect?: { x: number, y: number, w: number, h: number }, baselinePath?: string, maxDiffPixels?: number }} opts
 */
export async function ladderHeatPixelDiff(opts) {
  const baselinePath = opts.baselinePath ?? DEFAULT_BASELINE;
  if (!existsSync(baselinePath)) {
    return { skipped: true, reason: `missing baseline ${baselinePath}` };
  }
  const [baseBuf, curBuf] = await Promise.all([readFile(baselinePath), readFile(opts.currentPngPath)]);
  const expected = PNG.sync.read(baseBuf);
  const actual = PNG.sync.read(curBuf);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      skipped: false,
      pass: false,
      reason: `size mismatch ${expected.width}x${expected.height} vs ${actual.width}x${actual.height}`,
    };
  }

  const pad = 4;
  const rect = opts.captionRect;
  if (rect) {
    maskRect(expected, expected.width, rect.x - pad, rect.y - pad, rect.x + rect.w + pad, rect.y + rect.h + pad);
    maskRect(actual, actual.width, rect.x - pad, rect.y - pad, rect.x + rect.w + pad, rect.y + rect.h + pad);
  }

  const diff = new PNG({ width: expected.width, height: expected.height });
  const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, {
    threshold: 0.12,
    includeAA: false,
  });
  const maxAllowed = opts.maxDiffPixels ?? 120;
  const pass = diffPixels <= maxAllowed;
  const diffPath = path.join(opts.outDir, "at-ladder-heat-pixel-diff.png");
  await writeFile(diffPath, PNG.sync.write(diff));
  return {
    skipped: false,
    pass,
    diffPixels,
    maxAllowed,
    diffPath,
    baselinePath,
  };
}