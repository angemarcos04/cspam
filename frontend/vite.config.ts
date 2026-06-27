import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const devBackendUrl = process.env.VITE_DEV_BACKEND_URL || "https://cspam-eea2.onrender.com";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", "test-results", "e2e", "e2e-live", "e2e-realtime"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: devBackendUrl,
        changeOrigin: true,
      },
      "/sanctum": {
        target: devBackendUrl,
        changeOrigin: true,
      },
      "/broadcasting": {
        target: devBackendUrl,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
