import { getApiBaseUrl } from "@/lib/api";

export type BackendWarmupStatus = "idle" | "warming" | "ready" | "unavailable";

export interface BackendWarmupResult {
  status: "ready";
  warmedAt: number;
}

export const BACKEND_WARMUP_WINDOW_MS = 90_000;
export const BACKEND_HEALTH_REQUEST_TIMEOUT_MS = 10_000;
export const BACKEND_WARMUP_RETRY_DELAY_MS = 2_000;
export const BACKEND_READY_CACHE_MS = 45_000;

export class BackendWarmupError extends Error {
  constructor() {
    super("The secure server could not be reached.");
    this.name = "BackendWarmupError";
  }
}

let warmupStatus: BackendWarmupStatus = "idle";
let warmupPromise: Promise<BackendWarmupResult> | null = null;
let warmupController: AbortController | null = null;
let lastReadyAt: number | null = null;

function createAbortError(): Error {
  const error = new Error("Backend warm-up was cancelled.");
  error.name = "AbortError";
  return error;
}

function healthUrl(): string {
  const baseUrl = getApiBaseUrl().replace(/\/+$/, "");
  return `${baseUrl}/api/health`;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

async function checkBackendHealth(
  timeoutMs: number,
  warmupSignal: AbortSignal,
): Promise<boolean> {
  const controller = new AbortController();
  const handleWarmupAbort = () => controller.abort();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  warmupSignal.addEventListener("abort", handleWarmupAbort, { once: true });

  try {
    const response = await fetch(healthUrl(), {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return false;
    }

    const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      return false;
    }

    try {
      const payload = await response.json() as { status?: unknown };
      return payload !== null && typeof payload === "object" && payload.status === "ok";
    } catch {
      return false;
    }
  } catch {
    if (warmupSignal.aborted) {
      throw createAbortError();
    }

    return false;
  } finally {
    window.clearTimeout(timeoutId);
    warmupSignal.removeEventListener("abort", handleWarmupAbort);
  }
}

async function runWarmup(signal: AbortSignal): Promise<BackendWarmupResult> {
  const startedAt = Date.now();

  while (!signal.aborted) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = BACKEND_WARMUP_WINDOW_MS - elapsedMs;
    if (remainingMs <= 0) {
      break;
    }

    const isReady = await checkBackendHealth(
      Math.min(BACKEND_HEALTH_REQUEST_TIMEOUT_MS, remainingMs),
      signal,
    );
    if (isReady) {
      return {
        status: "ready",
        warmedAt: Date.now(),
      };
    }

    const remainingAfterAttemptMs = BACKEND_WARMUP_WINDOW_MS - (Date.now() - startedAt);
    if (remainingAfterAttemptMs <= 0) {
      break;
    }

    await waitForRetry(
      Math.min(BACKEND_WARMUP_RETRY_DELAY_MS, remainingAfterAttemptMs),
      signal,
    );
  }

  if (signal.aborted) {
    throw createAbortError();
  }

  throw new BackendWarmupError();
}

export function warmBackend(): Promise<BackendWarmupResult> {
  const now = Date.now();
  if (lastReadyAt !== null && now - lastReadyAt <= BACKEND_READY_CACHE_MS) {
    warmupStatus = "ready";
    return Promise.resolve({
      status: "ready",
      warmedAt: lastReadyAt,
    });
  }

  if (warmupPromise) {
    return warmupPromise;
  }

  warmupStatus = "warming";
  const controller = new AbortController();
  warmupController = controller;

  let currentPromise: Promise<BackendWarmupResult>;
  currentPromise = runWarmup(controller.signal)
    .then((result) => {
      lastReadyAt = result.warmedAt;
      warmupStatus = "ready";
      return result;
    })
    .catch((error: unknown) => {
      warmupStatus = controller.signal.aborted ? "idle" : "unavailable";
      throw error;
    })
    .finally(() => {
      if (warmupPromise === currentPromise) {
        warmupPromise = null;
      }
      if (warmupController === controller) {
        warmupController = null;
      }
    });

  warmupPromise = currentPromise;
  return currentPromise;
}

export function getBackendWarmupStatus(): BackendWarmupStatus {
  return warmupStatus;
}

export function cancelBackendWarmup(): void {
  warmupController?.abort();
  warmupController = null;
  warmupPromise = null;
  if (warmupStatus === "warming") {
    warmupStatus = "idle";
  }
}

export function resetBackendWarmup(): void {
  cancelBackendWarmup();
  lastReadyAt = null;
  warmupStatus = "idle";
}
