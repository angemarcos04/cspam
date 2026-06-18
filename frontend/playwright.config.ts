import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = Number(process.env.CSPAMS_E2E_PORT ?? 4177);
const E2E_HOST = "127.0.0.1";
const baseURL = `http://${E2E_HOST}:${E2E_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 7_500,
  },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm.cmd run dev -- --host ${E2E_HOST} --port ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_REALTIME_ENABLED: "false",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
