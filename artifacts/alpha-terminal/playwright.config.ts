import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 1,
  },
});