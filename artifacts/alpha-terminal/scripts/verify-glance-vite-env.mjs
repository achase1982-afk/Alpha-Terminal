/**
 * Prod bundle check: VITE_AT_GLANCE_TOP=1 must change the OptionsTab chunk (glance gate).
 * Docker not available on all agents; this mirrors Dockerfile ENV + vite build.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PKG = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function optionsTabHash(env) {
  rmSync(path.join(PKG, "dist"), { recursive: true, force: true });
  execSync("pnpm run build", {
    cwd: PKG,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "production", ...env },
  });
  const assets = path.join(PKG, "dist/public/assets");
  const file = readdirSync(assets).find((f) => f.startsWith("OptionsTab-") && f.endsWith(".js"));
  if (!file) throw new Error("OptionsTab chunk missing");
  const buf = readFileSync(path.join(assets, file));
  return createHash("sha256").update(buf).digest("hex");
}

const on = optionsTabHash({ VITE_AT_GLANCE_TOP: "1" });
const off = optionsTabHash({});
if (on === off) {
  console.error("FAIL: VITE_AT_GLANCE_TOP=1 did not change prod bundle");
  process.exit(1);
}
console.log("OK: OptionsTab hash on=", on.slice(0, 12), "off=", off.slice(0, 12));