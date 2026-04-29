/**
 * Load `.env` into `process.env`. Node does not read `.env` automatically.
 * `config({ path })` relative to the package root (`../.env` from `dist/` or `src/`) picks up keys next to this server package.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../.env"),
];

for (const p of candidates) {
  config({ path: p });
}
