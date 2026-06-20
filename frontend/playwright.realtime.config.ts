import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const E2E_FRONTEND_PORT = Number(process.env.CSPAMS_E2E_REALTIME_FRONTEND_PORT ?? 4179);
const E2E_BACKEND_PORT = Number(process.env.CSPAMS_E2E_REALTIME_BACKEND_PORT ?? 8098);
const E2E_REVERB_PORT = Number(process.env.CSPAMS_E2E_REALTIME_REVERB_PORT ?? 8086);
const E2E_HOST = "127.0.0.1";
const frontendURL = `http://${E2E_HOST}:${E2E_FRONTEND_PORT}`;
const backendURL = `http://${E2E_HOST}:${E2E_BACKEND_PORT}`;
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./e2e-realtime",
  globalTeardown: "./e2e-realtime/global-teardown.ts",
  // Reverb delivery follows a real database queue job in this isolated stack.
  timeout: 240_000,
  expect: {
    timeout: 20_000,
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
      // FIX: this harness owns an isolated Laravel, Reverb, and broadcasts queue stack.
      command: `powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\start-cspams-e2e-realtime-backend.ps1 -Port ${E2E_BACKEND_PORT} -ReverbPort ${E2E_REVERB_PORT}`,
      cwd: repoRoot,
      url: `${backendURL}/up`,
      reuseExistingServer: false,
      timeout: 240_000,
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
        VITE_REALTIME_ENABLED: "true",
        VITE_REVERB_APP_KEY: "cspams-e2e-key",
        VITE_REVERB_HOST: E2E_HOST,
        VITE_REVERB_PORT: String(E2E_REVERB_PORT),
        VITE_REVERB_SCHEME: "http",
        VITE_REVERB_TLS: "false",
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
