import { createElement, Suspense } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLazyRecoveryKey,
  lazyRouteWithRecovery,
  loadRouteWithRecovery,
} from "@/lib/lazyRouteWithRecovery";

const RouteComponent = () => createElement("p", null, "Dashboard route ready");

describe("lazy route recovery", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns a successful route and clears its recovery marker", async () => {
    const recoveryKey = buildLazyRecoveryKey("monitor", "build-a");
    window.sessionStorage.setItem(recoveryKey, "1");
    const reload = vi.fn();

    await expect(loadRouteWithRecovery(
      "monitor",
      async () => ({ default: RouteComponent }),
      {
        buildIdentifier: "build-a",
        storage: window.sessionStorage,
        reload,
      },
    )).resolves.toEqual({ default: RouteComponent });

    expect(window.sessionStorage.getItem(recoveryKey)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps a visible Suspense transition while a route module is loading", async () => {
    let resolveImport!: (module: { default: typeof RouteComponent }) => void;
    const importer = vi.fn(() => new Promise<{ default: typeof RouteComponent }>((resolve) => {
      resolveImport = resolve;
    }));
    const LazyRoute = lazyRouteWithRecovery("monitor-slow-test", importer);

    render(createElement(
      Suspense,
      { fallback: createElement("p", null, "Opening Division Monitor Dashboard...") },
      createElement(LazyRoute),
    ));

    expect(screen.getByText("Opening Division Monitor Dashboard...")).toBeTruthy();
    resolveImport({ default: RouteComponent });
    expect(await screen.findByText("Dashboard route ready")).toBeTruthy();
  });

  it("marks the first failed import and requests one recovery reload", async () => {
    const reload = vi.fn();
    const failure = new TypeError("Failed to fetch dynamically imported module");

    void loadRouteWithRecovery(
      "monitor",
      async () => {
        throw failure;
      },
      {
        buildIdentifier: "build-a",
        storage: window.sessionStorage,
        reload,
      },
    );

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
    expect(window.sessionStorage.getItem(buildLazyRecoveryKey("monitor", "build-a"))).toBe("1");
  });

  it("throws the original error instead of reloading after one attempt", async () => {
    const reload = vi.fn();
    const failure = new Error("Loading chunk failed");
    window.sessionStorage.setItem(buildLazyRecoveryKey("monitor", "build-a"), "1");

    await expect(loadRouteWithRecovery(
      "monitor",
      async () => {
        throw failure;
      },
      {
        buildIdentifier: "build-a",
        storage: window.sessionStorage,
        reload,
      },
    )).rejects.toBe(failure);

    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps recovery attempts independent across builds and routes", async () => {
    const reload = vi.fn();
    window.sessionStorage.setItem(buildLazyRecoveryKey("monitor", "build-a"), "1");

    void loadRouteWithRecovery(
      "monitor",
      async () => {
        throw new Error("new deployment");
      },
      {
        buildIdentifier: "build-b",
        storage: window.sessionStorage,
        reload,
      },
    );
    void loadRouteWithRecovery(
      "school-admin",
      async () => {
        throw new Error("other route");
      },
      {
        buildIdentifier: "build-a",
        storage: window.sessionStorage,
        reload,
      },
    );

    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(2);
    });
    expect(window.sessionStorage.getItem(buildLazyRecoveryKey("monitor", "build-b"))).toBe("1");
    expect(window.sessionStorage.getItem(buildLazyRecoveryKey("school-admin", "build-a"))).toBe("1");
  });

  it("fails safely without reloading when session storage is unavailable", async () => {
    const reload = vi.fn();
    const failure = new Error("Importing a module script failed");

    await expect(loadRouteWithRecovery(
      "monitor",
      async () => {
        throw failure;
      },
      {
        buildIdentifier: "build-a",
        storage: null,
        reload,
      },
    )).rejects.toBe(failure);

    expect(reload).not.toHaveBeenCalled();
  });
});
