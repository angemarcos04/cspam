import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { getCspamsBuildIdentifier } from "@/lib/buildInfo";

const LAZY_RECOVERY_STORAGE_PREFIX = "cspams.lazy-recovery";

interface LazyRecoveryOptions {
  buildIdentifier?: string;
  storage?: Storage | null;
  reload?: () => void;
}

export function buildLazyRecoveryKey(routeKey: string, buildIdentifier = getCspamsBuildIdentifier()): string {
  return `${LAZY_RECOVERY_STORAGE_PREFIX}:${buildIdentifier}:${routeKey}`;
}

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function browserReload(): void {
  window.location.reload();
}

export async function loadRouteWithRecovery<T extends ComponentType>(
  routeKey: string,
  importer: () => Promise<{ default: T }>,
  options: LazyRecoveryOptions = {},
): Promise<{ default: T }> {
  const buildIdentifier = options.buildIdentifier ?? getCspamsBuildIdentifier();
  const recoveryKey = buildLazyRecoveryKey(routeKey, buildIdentifier);
  const storage = options.storage === undefined ? browserSessionStorage() : options.storage;

  try {
    const module = await importer();
    try {
      storage?.removeItem(recoveryKey);
    } catch {
      // Storage may be unavailable in restricted browsing modes.
    }
    return module;
  } catch (error) {
    let recoveryAlreadyAttempted = true;

    if (storage) {
      try {
        recoveryAlreadyAttempted = storage.getItem(recoveryKey) === "1";
        if (!recoveryAlreadyAttempted) {
          storage.setItem(recoveryKey, "1");
        }
      } catch {
        recoveryAlreadyAttempted = true;
      }
    }

    if (!recoveryAlreadyAttempted && typeof window !== "undefined") {
      const reload = options.reload ?? browserReload;
      reload();

      // Keep Suspense active while the browser replaces the stale application.
      return new Promise<{ default: T }>(() => undefined);
    }

    throw error;
  }
}

export function lazyRouteWithRecovery<T extends ComponentType>(
  routeKey: string,
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => loadRouteWithRecovery(routeKey, importer));
}
