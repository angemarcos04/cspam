import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndicatorDataProvider, useIndicatorData } from "@/context/IndicatorData";
import { useAuth } from "@/context/Auth";
import { ApiError, apiRequest, apiRequestRaw, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";

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

describe("IndicatorDataProvider API errors", () => {
  beforeEach(() => {
    mockAuthenticatedMonitor();
    vi.mocked(apiRequest).mockResolvedValue({ data: [] } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows a safe service-unavailable message for indicator 503 responses", async () => {
    vi.mocked(apiRequestRaw).mockRejectedValueOnce(new ApiError("Request failed with status 503.", 503, null));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <IndicatorDataProvider>{children}</IndicatorDataProvider>
    );
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    await act(async () => {
      await expect(result.current.refreshSubmissions()).resolves.toBeUndefined();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(SERVICE_UNAVAILABLE_MESSAGE);
    });

    expect(result.current.error).not.toBe("Request failed with status 503.");
  });

  it("shows the indicator submissions endpoint when diagnostics are enabled", async () => {
    vi.stubEnv("VITE_CSPAMS_API_DIAGNOSTICS", "true");
    vi.mocked(apiRequestRaw).mockRejectedValueOnce(new ApiError("Request failed with status 503.", 503, null, null, {
      method: "GET",
      path: "/api/indicators/submissions?per_page=50",
    }));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <IndicatorDataProvider>{children}</IndicatorDataProvider>
    );
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    await act(async () => {
      await expect(result.current.refreshSubmissions()).resolves.toBeUndefined();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(
        `${SERVICE_UNAVAILABLE_MESSAGE}\nDiagnostic: GET /api/indicators/submissions?per_page=[redacted] returned 503.`,
      );
    });
  });
});
