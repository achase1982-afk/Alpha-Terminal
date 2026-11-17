import { defineConfig } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
  },
  webServer: {
    command: `VITE_QA_HARNESS=true VITE_DEV_BYPASS_AUTH=true pnpm exec vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});