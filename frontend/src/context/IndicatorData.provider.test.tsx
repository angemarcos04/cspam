import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndicatorDataProvider, useIndicatorData } from "@/context/IndicatorData";
import { useAuth } from "@/context/Auth";
import { ApiError, apiRequest, apiRequestRaw, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import type { IndicatorSubmission } from "@/types";

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

function mockAuthenticatedSchoolHead() {
  vi.mocked(useAuth).mockReturnValue({
    role: "school_head",
    username: "School Head",
    user: {
      id: 25,
      name: "School Head",
      email: "school-head@cspams.local",
      role: "school_head",
      schoolId: 1,
      schoolCode: "SCH-001",
      schoolName: "Submitted School",
      schoolType: "public",
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

function buildSchoolHeadSubmission(overrides: Partial<IndicatorSubmission> = {}): IndicatorSubmission {
  return {
    id: "sub-1",
    formType: "indicator",
    status: "submitted",
    statusLabel: "Submitted",
    reportingPeriod: "ANNUAL",
    version: 1,
    schoolId: "1",
    schoolType: "public",
    academicYear: { id: "ay-1", name: "2025-2026" },
    academicYearId: "ay-1",
    notes: null,
    reviewNotes: null,
    summary: {
      totalIndicators: 1,
      metIndicators: 1,
      belowTargetIndicators: 0,
      complianceRatePercent: 100,
    },
    completion: {
      hasImetaFormData: true,
      hasBmefFile: false,
      hasSmeaFile: true,
      isComplete: true,
      requiredFileTypes: ["smea"],
      uploadedFileTypes: ["smea"],
      missingFileTypes: [],
    },
    scopeProgress: {
      requiredScopeIds: ["smea"],
      submittedScopeIds: ["smea"],
      pendingScopeIds: [],
      submittedRequiredScopeCount: 1,
      totalRequiredScopeCount: 1,
    },
    scopeReviews: [],
    indicators: [],
    submittedAt: "2026-07-10T10:00:00.000Z",
    reviewedAt: null,
    createdAt: "2026-07-10T09:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z",
    ...overrides,
  };
}

function submissionSnapshot(rows: IndicatorSubmission[]) {
  return {
    status: 200,
    data: {
      data: rows,
      meta: {
        current_page: 1,
        last_page: 1,
        per_page: 100,
        total: rows.length,
      },
    },
    headers: new Headers({
      "X-Sync-Etag": "\"school-head-submissions-2\"",
      "X-Synced-At": "2026-07-10T10:01:00.000Z",
    }),
  };
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

describe("IndicatorDataProvider School Head realtime review sync", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequestRaw).mockReset();
    mockAuthenticatedSchoolHead();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("does not suppress monitor review realtime events after a local school-head mutation", async () => {
    const localSubmission = buildSchoolHeadSubmission();
    const verifiedSubmission = buildSchoolHeadSubmission({
      version: 2,
      scopeReviews: [{
        id: "review-1",
        scopeId: "smea",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedAt: "2026-07-10T10:01:00.000Z",
        updatedAt: "2026-07-10T10:01:00.000Z",
      }],
      reviewedAt: "2026-07-10T10:01:00.000Z",
      updatedAt: "2026-07-10T10:01:00.000Z",
    });
    const apiRequestMock = vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/api/indicators/submissions/sub-1/submit-scopes") {
        return { data: localSubmission } as never;
      }
      if (path === "/api/indicators/submissions/sub-1") {
        return { data: verifiedSubmission } as never;
      }
      return { data: [] } as never;
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <IndicatorDataProvider>{children}</IndicatorDataProvider>
    );
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    await act(async () => {
      await result.current.submitSubmissionScopes("sub-1", ["smea"]);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "indicators",
          eventType: "indicators.scope_verified",
          submissionId: "sub-1",
          academicYearId: "ay-1",
        },
      }));
    });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/api/indicators/submissions/sub-1", {
        token: "test-token",
      });
      expect(result.current.submissions[0]?.scopeReviews?.[0]?.decision).toBe("verified");
    });
  });

  it("suppresses matching school-head local echo events during the post-mutation grace window", async () => {
    const localSubmission = buildSchoolHeadSubmission();
    const apiRequestMock = vi.mocked(apiRequest).mockImplementation(async (path) => {
      if (path === "/api/indicators/submissions/sub-1/submit-scopes") {
        return { data: localSubmission } as never;
      }
      return { data: localSubmission } as never;
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <IndicatorDataProvider>{children}</IndicatorDataProvider>
    );
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    await act(async () => {
      await result.current.submitSubmissionScopes("sub-1", ["smea"]);
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "indicators",
          eventType: "indicators.scopes_submitted",
          submissionId: "sub-1",
          academicYearId: "ay-1",
        },
      }));
      await Promise.resolve();
    });

    expect(apiRequestMock).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).not.toHaveBeenCalledWith("/api/indicators/submissions/sub-1", expect.anything());
  });

  it.each([
    ["indicators.returned", "returned", "Returned"],
    ["indicators.validated", "validated", "Validated"],
  ])("hydrates %s package realtime events for School Head users", async (eventType, status, statusLabel) => {
    const reviewedSubmission = buildSchoolHeadSubmission({
      status,
      statusLabel,
      version: 2,
      reviewNotes: status === "returned" ? "Please revise the package." : null,
      reviewedAt: "2026-07-10T10:01:00.000Z",
      updatedAt: "2026-07-10T10:01:00.000Z",
    });
    const apiRequestMock = vi.mocked(apiRequest).mockResolvedValue({
      data: reviewedSubmission,
    } as never);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <IndicatorDataProvider>{children}</IndicatorDataProvider>
    );
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "indicators",
          eventType,
          submissionId: "sub-1",
          academicYearId: "ay-1",
        },
      }));
    });

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith("/api/indicators/submissions/sub-1", {
        token: "test-token",
      });
      expect(result.current.submissions[0]?.status).toBe(status);
    });
  });

  it("forces a School Head submission sync on focus after missing hidden-tab indicator updates", async () => {
    const returnedSubmission = buildSchoolHeadSubmission({
      status: "returned",
      statusLabel: "Returned",
      version: 2,
      reviewedAt: "2026-07-10T10:01:00.000Z",
      updatedAt: "2026-07-10T10:01:00.000Z",
    });
    const visibilityStateSpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.mocked(apiRequest).mockResolvedValue({ data: [] } as never);
    vi.mocked(apiRequestRaw).mockResolvedValue(submissionSnapshot([returnedSubmission]));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <IndicatorDataProvider>{children}</IndicatorDataProvider>
    );
    const { result } = renderHook(() => useIndicatorData(), { wrapper });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "indicators",
          eventType: "indicators.scope_returned",
          submissionId: "sub-1",
          academicYearId: "ay-1",
        },
      }));
    });

    expect(apiRequest).not.toHaveBeenCalledWith("/api/indicators/submissions/sub-1", expect.anything());
    expect(apiRequestRaw).not.toHaveBeenCalled();

    visibilityStateSpy.mockReturnValue("visible");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(apiRequestRaw).toHaveBeenCalledWith(
        "/api/indicators/submissions?page=1&per_page=100",
        expect.objectContaining({
          token: "test-token",
          extraHeaders: undefined,
        }),
      );
      expect(result.current.submissions[0]?.status).toBe("returned");
    });
  });
});
