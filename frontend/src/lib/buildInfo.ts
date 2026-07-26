export const CSPAMS_BUILD_INFO = {
  source: "frontend",
  buildMode: import.meta.env.MODE,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/",
  buildCommit: import.meta.env.VITE_GIT_COMMIT || "unknown",
} as const;

export function getCspamsBuildIdentifier(): string {
  const commit = CSPAMS_BUILD_INFO.buildCommit.trim();
  return commit || "unknown";
}

declare global {
  interface Window {
    __CSPAMS_BUILD_INFO__?: typeof CSPAMS_BUILD_INFO;
  }
}

export function exposeCspamsBuildInfo(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.__CSPAMS_BUILD_INFO__ = CSPAMS_BUILD_INFO;
}
