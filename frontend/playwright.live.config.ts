import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const E2E_FRONTEND_PORT = Number(process.env.CSPAMS_E2E_LIVE_FRONTEND_PORT ?? 4178);
const E2E_BACKEND_PORT = Number(process.env.CSPAMS_E2E_LIVE_BACKEND_PORT ?? 8097);
const E2E_HOST = "127.0.0.1";
const frontendURL = `http://${E2E_HOST}:${E2E_FRONTEND_PORT}`;
const backendURL = `http://${E2E_HOST}:${E2E_BACKEND_PORT}`;
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./e2e-live",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: frontendURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\start-cspams-e2e-backend.ps1 -Port ${E2E_BACKEND_PORT}`,
      cwd: repoRoot,
      url: `${backendURL}/up`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm.cmd run dev -- --host ${E2E_HOST} --port ${E2E_FRONTEND_PORT}`,
      cwd: frontendRoot,
      url: frontendURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_DEV_BACKEND_URL: backendURL,
        VITE_ENABLE_STATEFUL_SPA_API: "true",
        VITE_E2E_SKIP_DRAWER_COUNTS: "true",
        VITE_REALTIME_ENABLED: "false",
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
