import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../e2e",
  timeout: 120000,
  use: {
    baseURL: "http://localhost:7060",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "NEXT_PUBLIC_DEV_EMAIL_LOGIN=true pnpm dev",
    url: "http://localhost:7060",
    reuseExistingServer: true,
    timeout: 30000,
    cwd: "/Users/simonbrown/Projects/MPC-POC/web",
  },
});
