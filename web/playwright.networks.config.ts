import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:7061", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --port 7061",
    url: "http://localhost:7061",
    reuseExistingServer: false,
  },
});
