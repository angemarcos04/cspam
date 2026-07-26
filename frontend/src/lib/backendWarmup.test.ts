import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKEND_READY_CACHE_MS,
  BACKEND_WARMUP_RETRY_DELAY_MS,
  BACKEND_WARMUP_WINDOW_MS,
  cancelBackendWarmup,
  getBackendWarmupStatus,
  resetBackendWarmup,
  warmBackend,
} from "@/lib/backendWarmup";

function healthResponse(
  payload: unknown = { status: "ok", app: "cspams" },
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });
}

describe("backend warm-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00.000Z"));
    resetBackendWarmup();
  });

  afterEach(() => {
    resetBackendWarmup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves immediately after one successful anonymous health request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(healthResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(warmBackend()).resolves.toMatchObject({ status: "ready" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/health");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("GET");
    expect(request.cache).toBe("no-store");
    expect(request.credentials).toBe("omit");
    expect(request.body).toBeUndefined();
    expect(new Headers(request.headers).get("Authorization")).toBeNull();
    expect(getBackendWarmupStatus()).toBe("ready");
  });

  it("retries failed health checks until a later attempt reports ready", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(healthResponse());
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = warmBackend();
    await vi.advanceTimersByTimeAsync(BACKEND_WARMUP_RETRY_DELAY_MS);

    await expect(resultPromise).resolves.toMatchObject({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight warm-up loop across concurrent callers", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = warmBackend();
    const second = warmBackend();
    const third = warmBackend();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(healthResponse());
    await expect(first).resolves.toMatchObject({ status: "ready" });
    await expect(second).resolves.toMatchObject({ status: "ready" });
    await expect(third).resolves.toMatchObject({ status: "ready" });
  });

  it("stops after the finite warm-up window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      healthResponse({ status: "starting" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = expect(warmBackend()).rejects.toThrow(
      "The secure server could not be reached.",
    );

    await vi.advanceTimersByTimeAsync(BACKEND_WARMUP_WINDOW_MS);

    await result;
    expect(getBackendWarmupStatus()).toBe("unavailable");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("rejects HTML, malformed JSON, and non-success responses as unhealthy", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html>Vercel fallback</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }))
      .mockResolvedValueOnce(new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(healthResponse({ status: "starting" }, { status: 503 }))
      .mockResolvedValueOnce(healthResponse());
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = warmBackend();
    await vi.advanceTimersByTimeAsync(BACKEND_WARMUP_RETRY_DELAY_MS * 3);

    await expect(resultPromise).resolves.toMatchObject({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses a short readiness cache and checks again after it expires", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => healthResponse());
    vi.stubGlobal("fetch", fetchMock);

    await warmBackend();
    await warmBackend();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BACKEND_READY_CACHE_MS + 1);
    await warmBackend();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels polling when the login page no longer needs warm-up", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, request: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = expect(warmBackend()).rejects.toMatchObject({ name: "AbortError" });
    cancelBackendWarmup();
    await result;
    await vi.advanceTimersByTimeAsync(BACKEND_WARMUP_WINDOW_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getBackendWarmupStatus()).toBe("idle");
  });
});
