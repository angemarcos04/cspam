import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndicatorDataProvider, useIndicatorData } from "@/context/IndicatorData";
import { useAuth } from "@/context/Auth";
import { ApiError, apiRequest, apiRequestRaw } from "@/lib/api";

vi.mock("@/context/Auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    apiRequest: vi.fn(),
    apiRequestRaw: vi.fn(),
  };
});

function mockAuthenticatedMonitor() {
  vi.mocked(useAuth).mockReturnValue({
    role: "monitor",
    username: "Monitor User",
    user: {
      id: 1,
      name: "Monitor User",
      email: "monitor@cspams.local",
      role: "monitor",
      schoolId: null,
      schoolCode: null,
      schoolName: null,
    },
    apiToken: "test-token",
    authError: "",
    authErrorCode: null,
    accountStatus: null,
    isLoading: false,
    isAuthenticating: false,
    isLoggingOut: false,
    clearAuthError: vi.fn(),
    handleUnauthorizedResponse: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    requestMonitorPasswordReset: vi.fn(),
    resetMonitorPassword: vi.fn(),
    requestMonitorMfaReset: vi.fn(),
    completeMonitorMfaReset: vi.fn(),
    completeAccountSetup: vi.fn(),
    resetRequiredPassword: vi.fn(),
    logout: vi.fn(),
    listActiveSessions: vi.fn(),
    revokeSessionDevice: vi.fn(),
    revokeOtherSessions: vi.fn(),
  });
}

function mockSubmissionSnapshot(etag = "submissions-1") {
  return {
    status: 200,
    data: {
      data: [],
      meta: {
        current_page: 1,
        last_page: 1,
        per_page: 100,
        total: 0,
      },
    },
    headers: new Headers({
      "X-Sync-Etag": `"${etag}"`,
      "X-Synced-At": "2026-05-07T06:36:01.000Z",
    }),
  };
}

describe("IndicatorDataProvider manual refresh", () => {
  beforeEach(() => {
    mockAuthenticatedMonitor();
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects manual submission refresh errors when throwOnError is requested", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce(mockSubmissionSnapshot())
      .mockRejectedValueOnce(new ApiError("Indicator refresh failed", 500, null));

    const wrapper = ({ children }: { children: ReactNode }) => <IndicatorDataProvider>{children}</IndicatorDataProvider>;
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    await act(async () => {
      await result.current.refreshSubmissions();
    });

    await expect(result.current.refreshSubmissions({ throwOnError: true })).rejects.toThrow("Indicator refresh failed");
  });

  it("omits If-None-Match when submission refresh is forced", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce(mockSubmissionSnapshot("submissions-1"))
      .mockResolvedValueOnce(mockSubmissionSnapshot("submissions-2"));

    const wrapper = ({ children }: { children: ReactNode }) => <IndicatorDataProvider>{children}</IndicatorDataProvider>;
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    await act(async () => {
      await result.current.refreshSubmissions();
    });

    await act(async () => {
      await result.current.refreshSubmissions({ force: true });
    });

    expect(apiRequestRawMock.mock.calls[1]?.[1]).toMatchObject({
      extraHeaders: undefined,
    });
  });
});
