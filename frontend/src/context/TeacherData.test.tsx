import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeacherDataProvider, useTeacherData } from "@/context/TeacherData";
import { useAuth } from "@/context/Auth";
import { ApiError, apiRequestRaw, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { subscribeSharedSyncPolling } from "@/lib/sharedSyncPolling";

vi.mock("@/context/Auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    apiRequestRaw: vi.fn(),
  };
});

vi.mock("@/lib/sharedSyncPolling", () => ({
  subscribeSharedSyncPolling: vi.fn(() => () => {}),
}));

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

describe("TeacherDataProvider API errors", () => {
  beforeEach(() => {
    mockAuthenticatedMonitor();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a safe service-unavailable message for teacher 503 responses", async () => {
    vi.mocked(apiRequestRaw).mockRejectedValueOnce(new ApiError("Request failed with status 503.", 503, null));

    const wrapper = ({ children }: { children: ReactNode }) => <TeacherDataProvider>{children}</TeacherDataProvider>;
    const { result } = renderHook(() => useTeacherData(), { wrapper });

    await act(async () => {
      await result.current.refreshTeachers();
    });

    await waitFor(() => {
      expect(result.current.error).toBe(SERVICE_UNAVAILABLE_MESSAGE);
    });

    expect(result.current.error).not.toBe("Request failed with status 503.");
    expect(subscribeSharedSyncPolling).toHaveBeenCalled();
  });

  it("rejects manual teacher refresh errors when throwOnError is requested", async () => {
    vi.mocked(apiRequestRaw)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: { currentPage: 1, lastPage: 1, perPage: 100, total: 0, syncedAt: "2026-05-07T06:36:01.000Z" },
        },
        headers: new Headers({ "X-Sync-Etag": "\"teachers-1\"" }),
      })
      .mockRejectedValueOnce(new ApiError("Teacher refresh failed", 500, null));

    const wrapper = ({ children }: { children: ReactNode }) => <TeacherDataProvider>{children}</TeacherDataProvider>;
    const { result } = renderHook(() => useTeacherData(), { wrapper });

    await act(async () => {
      await result.current.refreshTeachers();
    });

    await expect(result.current.refreshTeachers({ throwOnError: true })).rejects.toThrow("Teacher refresh failed");
  });

  it("omits If-None-Match when teacher refresh is forced", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: { currentPage: 1, lastPage: 1, perPage: 100, total: 0, syncedAt: "2026-05-07T06:36:01.000Z" },
        },
        headers: new Headers({ "X-Sync-Etag": "\"teachers-1\"" }),
      })
      .mockResolvedValueOnce({
        status: 304,
        data: null,
        headers: new Headers({ "X-Sync-Etag": "\"teachers-1\"" }),
      });

    const wrapper = ({ children }: { children: ReactNode }) => <TeacherDataProvider>{children}</TeacherDataProvider>;
    const { result } = renderHook(() => useTeacherData(), { wrapper });

    await act(async () => {
      await result.current.refreshTeachers();
    });

    await act(async () => {
      await result.current.refreshTeachers({ force: true });
    });

    expect(apiRequestRawMock.mock.calls[1]?.[1]).toMatchObject({
      extraHeaders: undefined,
    });
  });
});
