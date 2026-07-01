import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildDataProviderSessionKey, DataProvider, useData } from "@/context/Data";
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

describe("DataProvider school record sync recovery", () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("fetches school records immediately when an authenticated session becomes available", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);

    apiRequestRawMock.mockResolvedValueOnce({
      status: 200,
      data: {
        data: [
          {
            id: "1",
            schoolId: "900001",
            schoolCode: "900001",
            schoolName: "Santiago Elementary",
            level: "Elementary",
            district: "District 1",
            address: "District 1, Santiago City",
            type: "public",
            studentCount: 120,
            teacherCount: 12,
            region: "Region II",
            status: "active",
            submittedBy: "Monitor User",
            lastUpdated: "2026-05-07T06:36:01.000Z",
            deletedAt: null,
            schoolHeadAccount: null,
            indicatorLatest: null,
          },
        ],
        meta: {
          syncedAt: "2026-05-07T06:36:01.000Z",
          scope: "division",
          scopeKey: "division:all|filters:none",
          recordCount: 1,
          targetsMet: null,
          alerts: [],
        },
      },
      headers: new Headers({
        "X-Sync-Etag": "\"etag-1\"",
        "X-Sync-Scope": "division",
        "X-Sync-Scope-Key": "division:all|filters:none",
        "X-Synced-At": "2026-05-07T06:36:01.000Z",
      }),
    });

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(result.current.records).toHaveLength(1);
      expect(result.current.recordCount).toBe(1);
    });

    expect(apiRequestRawMock).toHaveBeenCalledWith(
      "/api/dashboard/records",
      expect.objectContaining({
        token: "test-token",
        timeoutMs: 60_000,
      }),
    );
  });

  it("retries without ETag when sync count is nonzero but records are empty", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);

    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 304,
        data: null,
        headers: new Headers({
          "X-Sync-Record-Count": "46",
          "X-Sync-Etag": "\"etag-46\"",
          "X-Sync-Scope": "division",
          "X-Sync-Scope-Key": "division:all|filters:none",
          "X-Synced-At": "2026-05-07T06:36:00.000Z",
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: "1",
              schoolId: "900001",
              schoolCode: "900001",
              schoolName: "Santiago Elementary",
              level: "Elementary",
              district: "District 1",
              address: "District 1, Santiago City",
              type: "public",
              studentCount: 120,
              teacherCount: 12,
              region: "Region II",
              status: "active",
              submittedBy: "Monitor User",
              lastUpdated: "2026-05-07T06:36:01.000Z",
              deletedAt: null,
              schoolHeadAccount: null,
              indicatorLatest: null,
            },
          ],
          meta: {
            syncedAt: "2026-05-07T06:36:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 46,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({
          "X-Sync-Etag": "\"etag-46-refresh\"",
          "X-Sync-Scope": "division",
          "X-Sync-Scope-Key": "division:all|filters:none",
          "X-Synced-At": "2026-05-07T06:36:01.000Z",
        }),
      });

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await act(async () => {
      await result.current.refreshRecords();
    });

    await waitFor(() => {
      expect(result.current.records).toHaveLength(1);
      expect(result.current.recordCount).toBe(46);
    });

    expect(apiRequestRawMock).toHaveBeenCalledTimes(2);
    expect(apiRequestRawMock.mock.calls[0]?.[0]).toBe("/api/dashboard/records");
    expect(apiRequestRawMock.mock.calls[0]?.[1]).toMatchObject({
      token: "test-token",
      timeoutMs: 60_000,
      extraHeaders: undefined,
    });
    expect(apiRequestRawMock.mock.calls[1]?.[1]).toMatchObject({
      token: "test-token",
      timeoutMs: 60_000,
      extraHeaders: undefined,
    });
    expect(subscribeSharedSyncPolling).toHaveBeenCalled();
  });

  it("forces record refresh after monitor-visible indicator realtime events", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);

    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:36:00.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({
          "X-Sync-Etag": "\"etag-before-send\"",
          "X-Sync-Scope": "division",
          "X-Sync-Scope-Key": "division:all|filters:none",
          "X-Synced-At": "2026-05-07T06:36:00.000Z",
        }),
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [
            {
              id: "1",
              schoolId: "401777",
              schoolCode: "401777",
              schoolName: "AMA Computer College-Santiago City",
              level: "High School",
              district: "Santiago City",
              address: "Santiago City",
              type: "private",
              studentCount: 0,
              teacherCount: 0,
              region: "Region II",
              status: "active",
              submittedBy: "School Head",
              lastUpdated: "2026-06-14T06:39:00.000Z",
              deletedAt: null,
              schoolHeadAccount: null,
              indicatorLatest: {
                id: "submission-77",
                status: "submitted",
                submittedAt: "2026-06-14T06:39:00.000Z",
                reviewedAt: null,
                createdAt: "2026-06-14T06:39:00.000Z",
                updatedAt: "2026-06-14T06:39:00.000Z",
              },
            },
          ],
          meta: {
            syncedAt: "2026-06-14T06:39:00.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 1,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({
          "X-Sync-Etag": "\"etag-after-send\"",
          "X-Sync-Scope": "division",
          "X-Sync-Scope-Key": "division:all|filters:none",
          "X-Synced-At": "2026-06-14T06:39:00.000Z",
        }),
      });

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    const syncListener = vi.mocked(subscribeSharedSyncPolling).mock.calls[0]?.[0];
    expect(syncListener).toBeTypeOf("function");

    await act(async () => {
      syncListener?.("realtime", {
        entity: "indicators",
        eventType: "indicators.scopes_submitted",
        submissionId: "submission-77",
        schoolCode: "401777",
      });
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    });

    await waitFor(() => {
      expect(result.current.records).toHaveLength(1);
    });

    expect(apiRequestRawMock).toHaveBeenCalledTimes(2);
    expect(apiRequestRawMock.mock.calls[1]?.[1]).toMatchObject({
      token: "test-token",
      timeoutMs: 60_000,
      extraHeaders: undefined,
    });
  });

  it("shows a safe service-unavailable message for dashboard record 503 responses", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock.mockRejectedValueOnce(new ApiError("Request failed with status 503.", 503, null));

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe(SERVICE_UNAVAILABLE_MESSAGE);
    });

    expect(result.current.error).not.toBe("Request failed with status 503.");
  });

  it("shows the dashboard records endpoint when diagnostics are enabled", async () => {
    vi.stubEnv("VITE_CSPAMS_API_DIAGNOSTICS", "true");
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock.mockRejectedValueOnce(new ApiError("Request failed with status 503.", 503, null, null, {
      method: "GET",
      path: "/api/dashboard/records",
    }));

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe(
        `${SERVICE_UNAVAILABLE_MESSAGE}\nDiagnostic: GET /api/dashboard/records returned 503.`,
      );
    });
  });

  it("keeps permission-specific messages for dashboard record 403 responses", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock.mockRejectedValueOnce(new ApiError("You may not view these records.", 403, null));

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBe("You may not view these records.");
    });
  });

  it("rejects manual refresh errors only when throwOnError is requested", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:36:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({ "X-Sync-Etag": "\"etag-1\"" }),
      })
      .mockRejectedValueOnce(new ApiError("Refresh failed", 500, null))
      .mockRejectedValueOnce(new ApiError("Manual refresh failed", 500, null));

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refreshRecords();
    });

    await expect(result.current.refreshRecords({ throwOnError: true })).rejects.toThrow("Manual refresh failed");
  });

  it("omits If-None-Match when dashboard record refresh is forced", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:36:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({ "X-Sync-Etag": "\"etag-1\"" }),
      })
      .mockResolvedValueOnce({
        status: 304,
        data: null,
        headers: new Headers({
          "X-Sync-Record-Count": "0",
          "X-Sync-Etag": "\"etag-1\"",
        }),
      });

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refreshRecords({ force: true });
    });

    expect(apiRequestRawMock.mock.calls[1]?.[1]).toMatchObject({
      extraHeaders: undefined,
    });
  });

  it("maps monitor record filters to the dashboard records endpoint", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:36:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({ "X-Sync-Etag": "\"etag-1\"" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:37:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:search",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({ "X-Sync-Etag": "\"etag-filtered\"" }),
      });

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refreshRecords({
        force: true,
        filters: {
          search: "Santiago",
          status: "active",
          dateFrom: "2026-01-01",
          dateTo: "2026-12-31",
          schoolId: "12",
        },
      });
    });

    expect(apiRequestRawMock.mock.calls[1]?.[0]).toBe(
      "/api/dashboard/records?search=Santiago&status=active&date_from=2026-01-01&date_to=2026-12-31&school_id=12",
    );
    expect(apiRequestRawMock.mock.calls[1]?.[1]).toMatchObject({
      extraHeaders: undefined,
    });
  });

  it("reuses the active monitor record filters for later background refreshes", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    apiRequestRawMock
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:36:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:none",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({ "X-Sync-Etag": "\"etag-1\"" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: [],
          meta: {
            syncedAt: "2026-05-07T06:37:01.000Z",
            scope: "division",
            scopeKey: "division:all|filters:active",
            recordCount: 0,
            targetsMet: null,
            alerts: [],
          },
        },
        headers: new Headers({ "X-Sync-Etag": "\"etag-filtered\"" }),
      })
      .mockResolvedValueOnce({
        status: 304,
        data: null,
        headers: new Headers({
          "X-Sync-Record-Count": "0",
          "X-Sync-Etag": "\"etag-filtered\"",
        }),
      });

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.refreshRecords({
        force: true,
        filters: {
          status: "active",
          schoolId: "12",
        },
      });
    });

    await act(async () => {
      await result.current.refreshRecords();
    });

    expect(apiRequestRawMock.mock.calls[2]?.[0]).toBe(
      "/api/dashboard/records?status=active&school_id=12",
    );
    expect(apiRequestRawMock.mock.calls[2]?.[1]).toMatchObject({
      extraHeaders: { "If-None-Match": "etag-filtered" },
    });
  });

  it("keeps confirmed account status visible when the follow-up record refresh is stale", async () => {
    const apiRequestRawMock = vi.mocked(apiRequestRaw);
    const buildRecord = (accountStatus: string) => ({
      id: "school-1",
      schoolId: "900001",
      schoolCode: "900001",
      schoolName: "Santiago Elementary",
      level: "Elementary",
      district: "District 1",
      address: "District 1, Santiago City",
      type: "public",
      studentCount: 120,
      teacherCount: 12,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-06-01T00:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-1",
        name: "School Head",
        email: "head@example.com",
        accountStatus,
        mustResetPassword: false,
        lifecycleState: accountStatus === "suspended" ? "suspended" : "active_ready",
        lifecycleStateLabel: accountStatus === "suspended" ? "Suspended" : "Active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    });
    const recordsResponse = (accountStatus: string) => ({
      status: 200,
      data: {
        data: [buildRecord(accountStatus)],
        meta: {
          syncedAt: "2026-06-01T00:00:00.000Z",
          scope: "division",
          scopeKey: "division:all|filters:none",
          recordCount: 1,
          targetsMet: null,
          alerts: [],
        },
      },
      headers: new Headers({ "X-Sync-Etag": `"etag-${accountStatus}"` }),
    });

    apiRequestRawMock
      .mockResolvedValueOnce(recordsResponse("active"))
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            schoolId: "school-1",
            schoolName: "Santiago Elementary",
            account: buildRecord("suspended").schoolHeadAccount,
            message: "Account suspended.",
          },
        },
        headers: new Headers(),
      })
      .mockResolvedValueOnce(recordsResponse("active"))
      .mockResolvedValueOnce(recordsResponse("suspended"));

    const wrapper = ({ children }: { children: ReactNode }) => <DataProvider>{children}</DataProvider>;
    const { result } = renderHook(() => useData(), { wrapper });

    await waitFor(() => {
      expect(result.current.records[0]?.schoolHeadAccount?.accountStatus).toBe("active");
    });

    await act(async () => {
      await result.current.updateSchoolHeadAccountStatus("school-1", {
        accountStatus: "suspended",
        reason: "Policy hold",
        verificationChallengeId: "challenge-1",
        verificationCode: "123456",
      });
    });

    expect(result.current.records[0]?.status).toBe("active");
    expect(result.current.records[0]?.schoolHeadAccount?.accountStatus).toBe("suspended");

    await act(async () => {
      await result.current.refreshRecords({ force: true });
    });

    expect(result.current.records[0]?.schoolHeadAccount?.accountStatus).toBe("suspended");
  });
});

describe("buildDataProviderSessionKey", () => {
  it("includes assigned school context for School Head users", () => {
    expect(buildDataProviderSessionKey({
      id: 25,
      role: "school_head",
      schoolId: 900123,
      schoolType: "private",
    } as never)).toBe("school_head:25:900123:private");
  });

  it("changes when School Head school context changes", () => {
    const first = buildDataProviderSessionKey({
      id: 25,
      role: "school_head",
      schoolId: 900123,
      schoolType: "private",
    } as never);
    const second = buildDataProviderSessionKey({
      id: 25,
      role: "school_head",
      schoolId: 900124,
      schoolType: "public",
    } as never);

    expect(first).not.toBe(second);
  });

  it("keeps monitor session identity keyed only by role and user id", () => {
    expect(buildDataProviderSessionKey({
      id: 1,
      role: "monitor",
      schoolId: null,
      schoolType: null,
    } as never)).toBe("monitor:1");
  });
});
