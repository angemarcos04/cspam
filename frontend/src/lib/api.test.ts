import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiRequest,
  apiRequestVoid,
  COOKIE_SESSION_TOKEN,
  getApiBaseUrl,
  messageForApiError,
  SERVICE_UNAVAILABLE_MESSAGE,
} from "@/lib/api";

describe("api request helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("treats 204 No Content as success for void requests", async () => {
    document.cookie = "XSRF-TOKEN=test-xsrf-token; path=/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequestVoid("/api/auth/logout", {
        method: "POST",
        token: COOKIE_SESSION_TOKEN,
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${getApiBaseUrl()}/api/auth/logout`);
  });

  it("keeps apiRequest strict for endpoints that should return JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiRequest("/api/example")).rejects.toMatchObject({
        message: "No payload was returned for this request.",
        status: 204,
    });
  });

  it("attaches Authorization bearer headers for token-based requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/auth/me", {
      token: "sample-bearer-token",
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(requestInit?.headers as HeadersInit);

    expect(headers.get("Authorization")).toBe("Bearer sample-bearer-token");
    expect(requestInit?.credentials).toBe("omit");
  });

  it("does not run cookie-session csrf recovery for bearer-token 419 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Page Expired",
        }),
        {
          status: 419,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequestVoid("/api/auth/logout", {
        method: "POST",
        token: "sample-bearer-token",
      }),
    ).rejects.toMatchObject({
      status: 419,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supports stateless public auth-entry requests without forcing csrf bootstrap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "demo-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/api/auth/login", {
      method: "POST",
      body: {
        role: "monitor",
        login: "cspamsmonitor@gmail.com",
        password: "Demo@123456",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${getApiBaseUrl()}/api/auth/login`);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(requestInit?.headers as HeadersInit);
    expect(requestInit?.credentials).toBe("omit");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("does not duplicate identical backend message and validation error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        message: "Submission is incomplete. Missing: FM-QAD-001 file.",
        errors: {
          submission: ["Submission is incomplete. Missing: FM-QAD-001 file."],
        },
      }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await expect(
      apiRequest("/api/indicators/submissions/example/submit", {
        method: "POST",
        token: "sample-bearer-token",
      }),
    ).rejects.toMatchObject({
      message: "Submission is incomplete. Missing: FM-QAD-001 file.",
      status: 422,
    });
  });

  it.each([502, 503, 504])("uses safe copy for bare infrastructure status %s responses", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));

    await expect(apiRequest("/api/dashboard/records")).rejects.toMatchObject({
      message: SERVICE_UNAVAILABLE_MESSAGE,
      status,
    });
  });

  it("preserves verified-lock workflow messages from validation responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        message: "The given data was invalid.",
        errors: {
          submission: ["This file or indicator has been verified."],
        },
      }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    await expect(apiRequest("/api/indicators/submissions/example", {
      method: "PUT",
      token: "sample-bearer-token",
    })).rejects.toMatchObject({
      message: "This file or indicator has been verified.",
      status: 422,
    });
  });
});

describe("messageForApiError", () => {
  it("maps infrastructure availability errors to safe user copy", () => {
    expect(messageForApiError(new ApiError("Request failed with status 503.", 503, null), "fallback"))
      .toBe(SERVICE_UNAVAILABLE_MESSAGE);
    expect(messageForApiError(new ApiError("Bad gateway", 502, null), "fallback"))
      .toBe(SERVICE_UNAVAILABLE_MESSAGE);
    expect(messageForApiError(new ApiError("Gateway timeout", 504, null), "fallback"))
      .toBe(SERVICE_UNAVAILABLE_MESSAGE);
  });

  it("preserves workflow and validation messages outside infrastructure failures", () => {
    expect(messageForApiError(
      new ApiError("This file or indicator has been verified.", 422, null),
      "fallback",
    )).toBe("This file or indicator has been verified.");
  });
});
