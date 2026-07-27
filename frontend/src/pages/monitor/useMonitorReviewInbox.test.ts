import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/context/Auth";
import { apiRequest } from "@/lib/api";
import {
  buildMonitorReviewInboxUrl,
  useMonitorReviewInbox,
} from "@/pages/monitor/useMonitorReviewInbox";

vi.mock("@/context/Auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

const emptyResponse = {
  data: [],
  meta: {
    currentPage: 1,
    lastPage: 1,
    perPage: 10,
    total: 0,
    from: null,
    to: null,
    hasMorePages: false,
  },
};

const submittedResponse = {
  data: [{ schoolCode: "SCH-001", schoolName: "Submitted School" }],
  meta: {
    ...emptyResponse.meta,
    total: 1,
    from: 1,
    to: 1,
  },
};

const actionableRow = {
  schoolKey: "code:sch-001",
  schoolCode: "SCH-001",
  schoolName: "Action School",
  region: "Region IV-A",
  schoolLevel: "Kindergarten / Elementary",
  schoolType: "public",
  schoolStatus: "active" as const,
  packageSchoolType: "public" as const,
  requirementModeLabel: "Public",
  activePackageLabel: "Public",
  hasComplianceRecord: true,
  indicatorStatus: "returned",
  hasActivePackageSubmission: true,
  hasAnySubmitted: true,
  isComplete: false,
  awaitingReviewCount: 0,
  missingCount: 1,
  lastActivityAt: "2026-07-28T00:00:00.000Z",
  lastActivityTime: 1,
};

const actionableResponse = {
  data: [actionableRow],
  meta: {
    currentPage: 1,
    lastPage: 1,
    perPage: 10,
    total: 1,
    from: 1,
    to: 1,
    hasMorePages: false,
    requirementCounts: {
      total: 1,
      submittedAny: 1,
      complete: 0,
      awaitingReview: 0,
      missing: 1,
      returned: 1,
    },
    workflowStatusCounts: {
      all: 1,
      missing: 1,
      waiting: 0,
      returned: 0,
      submitted: 0,
      validated: 0,
    },
    schoolStatusCounts: { all: 1, active: 1, inactive: 0, pending: 0 },
    queueLaneCounts: { all: 1, urgent: 1, returned: 1, for_review: 0, waiting_data: 1 },
    schoolPresetCounts: { all: 1, pending: 0, missing: 1, returned: 1, no_submission: 0 },
    schoolCategoryCounts: {
      total: 1,
      public: 1,
      private: 0,
      publicKindergarten: 1,
      publicElementary: 1,
      publicJuniorHigh: 0,
      publicSeniorHigh: 0,
      publicLegacyHighSchool: 0,
      privateKindergarten: 0,
      privateElementary: 0,
      privateJuniorHigh: 0,
      privateSeniorHigh: 0,
      privateLegacyHighSchool: 0,
    },
    needsActionCount: 1,
  },
};

function renderReviewInbox(enabled = true) {
  return renderHook(
    ({ isEnabled }) => useMonitorReviewInbox({
      enabled: isEnabled,
      filters: {},
      page: 1,
      perPage: 10,
    }),
    { initialProps: { isEnabled: enabled } },
  );
}

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
  cleanup();
  vi.clearAllMocks();
});

describe("buildMonitorReviewInboxUrl", () => {
  it("maps URL-backed monitor filters to the review inbox API params", () => {
    const url = buildMonitorReviewInboxUrl(
      {
        search: "Santiago",
        status: "active",
        workflow: "waiting",
        lane: "for_review",
        preset: "pending",
        sector: "public",
        level: "elementary",
        schoolId: "42",
        dateFrom: "2026-01-01",
        dateTo: "2026-12-31",
        academicYearId: "7",
      },
      3,
      25,
    );

    expect(url).toBe(
      "/api/dashboard/review-inbox?search=Santiago&status=active&workflow=waiting&lane=for_review&preset=pending&sector=public&level=elementary&school_id=42&date_from=2026-01-01&date_to=2026-12-31&academic_year_id=7&page=3&per_page=25",
    );
  });

  it("omits all/default filters and keeps pagination", () => {
    expect(buildMonitorReviewInboxUrl({
      search: "",
      status: "all",
      workflow: "all",
      lane: "all",
      preset: "all",
      sector: "all",
      level: "all",
    }, 1, 10)).toBe("/api/dashboard/review-inbox?page=1&per_page=10");
  });
});

describe("useMonitorReviewInbox", () => {
  it("reuses an identical in-flight request for normal refreshes", async () => {
    let resolveRequest: ((value: typeof emptyResponse) => void) | null = null;
    vi.mocked(apiRequest).mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    let firstRefresh: Promise<unknown>;
    let secondRefresh: Promise<unknown>;
    act(() => {
      firstRefresh = result.current.refresh();
      secondRefresh = result.current.refresh();
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(firstRefresh!).toBe(secondRefresh!);

    await act(async () => {
      resolveRequest?.(emptyResponse);
      await Promise.all([firstRefresh!, secondRefresh!]);
    });
  });

  it("aborts a same-URL request when a forced refresh supersedes it", async () => {
    const pendingRequests: Array<{
      resolve: (value: typeof emptyResponse | typeof submittedResponse) => void;
      signal?: AbortSignal;
    }> = [];
    vi.mocked(apiRequest).mockImplementation((_url, options) => new Promise((resolve) => {
      pendingRequests.push({ resolve, signal: options?.signal });
    }));

    const { result } = renderReviewInbox();
    await waitFor(() => {
      expect(pendingRequests).toHaveLength(1);
    });

    let forcedRefresh: Promise<unknown>;
    act(() => {
      forcedRefresh = result.current.refresh({ force: true });
    });

    await waitFor(() => {
      expect(pendingRequests).toHaveLength(2);
    });
    expect(pendingRequests[0]?.signal?.aborted).toBe(true);
    expect(pendingRequests[1]?.signal?.aborted).toBe(false);

    await act(async () => {
      pendingRequests[1]?.resolve(submittedResponse);
      await forcedRefresh!;
    });

    expect(result.current.rows[0]).toEqual(expect.objectContaining({ schoolCode: "SCH-001" }));
    expect(result.current.error).toBe("");
  });

  it("aborts a stale filtered request and keeps the newer result", async () => {
    const pendingRequests: Array<{
      resolve: (value: typeof emptyResponse | typeof submittedResponse) => void;
      signal?: AbortSignal;
    }> = [];
    vi.mocked(apiRequest).mockImplementation((_url, options) => new Promise((resolve) => {
      pendingRequests.push({ resolve, signal: options?.signal });
    }));

    const { result, rerender } = renderHook(
      ({ search }) => useMonitorReviewInbox({
        enabled: true,
        filters: { search },
        page: 1,
        perPage: 10,
      }),
      { initialProps: { search: "first" } },
    );

    await waitFor(() => {
      expect(pendingRequests).toHaveLength(1);
    });

    rerender({ search: "second" });

    await waitFor(() => {
      expect(pendingRequests).toHaveLength(2);
      expect(pendingRequests[0]?.signal?.aborted).toBe(true);
    });

    await act(async () => {
      pendingRequests[1]?.resolve(submittedResponse);
      await Promise.resolve();
    });

    expect(result.current.rows[0]).toEqual(expect.objectContaining({ schoolCode: "SCH-001" }));

    await act(async () => {
      pendingRequests[0]?.resolve(emptyResponse);
      await Promise.resolve();
    });

    expect(result.current.rows[0]).toEqual(expect.objectContaining({ schoolCode: "SCH-001" }));
  });

  it("refreshes review inbox rows on realtime indicator updates", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(submittedResponse);

    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "indicators",
          eventType: "indicators.submitted",
          submissionId: "submission-1",
          schoolId: "school-1",
          schoolCode: "SCH-001",
          academicYearId: "year-1",
        },
      }));
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(2);
      expect(result.current.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ schoolCode: "SCH-001" }),
      ]));
    });
  });

  it("does not duplicate a just-completed request on focus and refreshes after the freshness window", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(submittedResponse);

    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await new Promise((resolve) => window.setTimeout(resolve, 50));
    expect(apiRequest).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(2);
      expect(result.current.rows[0]).toEqual(expect.objectContaining({ schoolCode: "SCH-001" }));
    });
  });

  it("ignores irrelevant realtime entities", async () => {
    vi.mocked(apiRequest).mockResolvedValue(emptyResponse);

    renderReviewInbox();

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: { entity: "students", eventType: "students.updated" },
      }));
    });

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("removes a confirmed deleted school locally without waiting for another inbox request", async () => {
    vi.mocked(apiRequest).mockResolvedValue(submittedResponse);
    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
      expect(result.current.meta.total).toBe(1);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: {
          id: "12",
          schoolId: "SCH-001",
          schoolCode: "SCH-001",
          mutationId: "local-review-delete",
        },
      }));
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "dashboard",
          eventType: "school_head_account_and_school.removed",
          schoolId: "12",
          schoolCode: "SCH-001",
          mutationId: "local-review-delete",
        },
      }));
    });

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.meta.total).toBe(0);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps a deleted school hidden when an older Review Inbox response resolves", async () => {
    const pendingRequests: Array<{
      resolve: (value: typeof actionableResponse | typeof emptyResponse) => void;
      signal?: AbortSignal;
    }> = [];
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(actionableResponse)
      .mockImplementation((_url, options) => new Promise((resolve) => {
        pendingRequests.push({ resolve, signal: options?.signal });
      }));
    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
    });

    let staleRefresh: Promise<unknown>;
    act(() => {
      staleRefresh = result.current.refresh({ force: true });
    });
    expect(pendingRequests).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: {
          id: "12",
          schoolCode: "SCH-001",
          mutationId: "mutation-race",
        },
      }));
    });

    await waitFor(() => {
      expect(pendingRequests).toHaveLength(2);
    });
    expect(pendingRequests[0]?.signal?.aborted).toBe(true);
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.meta.total).toBe(0);

    await act(async () => {
      pendingRequests[0]?.resolve(actionableResponse);
      await staleRefresh!;
    });

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.meta.total).toBe(0);
    expect(result.current.error).toBe("");

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: {
          id: "12",
          schoolCode: "SCH-001",
          mutationId: "mutation-race",
        },
      }));
    });
    expect(pendingRequests).toHaveLength(2);

    await act(async () => {
      pendingRequests[1]?.resolve(emptyResponse);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: {
          id: "12",
          schoolCode: "SCH-001",
          mutationId: "mutation-race",
        },
      }));
    });
    await waitFor(() => {
      expect(pendingRequests).toHaveLength(3);
    });
  });

  it("updates deterministic metadata once for a deleted public Kindergarten and Elementary school", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(actionableResponse)
      .mockResolvedValueOnce(emptyResponse);
    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
    });

    const deletionDetail = {
      id: "12",
      schoolCode: "SCH-001",
      mutationId: "metadata-mutation",
    };
    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", { detail: deletionDetail }));
    });

    expect(result.current.meta.total).toBe(0);
    expect(result.current.meta.needsActionCount).toBe(0);
    expect(result.current.meta.requirementCounts).toMatchObject({
      total: 0,
      submittedAny: 0,
      missing: 0,
      returned: 0,
    });
    expect(result.current.meta.workflowStatusCounts).toMatchObject({ all: 0, missing: 0 });
    expect(result.current.meta.schoolStatusCounts).toMatchObject({ all: 0, active: 0 });
    expect(result.current.meta.queueLaneCounts).toMatchObject({
      all: 0,
      urgent: 0,
      returned: 0,
      waiting_data: 0,
    });
    expect(result.current.meta.schoolPresetCounts).toMatchObject({
      all: 0,
      missing: 0,
      returned: 0,
    });
    expect(result.current.meta.schoolCategoryCounts).toMatchObject({
      total: 0,
      public: 0,
      publicKindergarten: 0,
      publicElementary: 0,
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", { detail: deletionDetail }));
    });
    expect(result.current.meta.total).toBe(0);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(2);
    });
  });

  it("coalesces synchronous batch deletion events into one forced inbox reconciliation", async () => {
    const secondRow = {
      ...actionableRow,
      schoolKey: "code:sch-002",
      schoolId: "13",
      schoolCode: "SCH-002",
      schoolName: "Second Action School",
    };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        ...actionableResponse,
        data: [actionableRow, secondRow],
        meta: {
          ...actionableResponse.meta,
          total: 2,
          from: 1,
          to: 2,
        },
      })
      .mockResolvedValueOnce(emptyResponse);
    const { result } = renderReviewInbox();

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(2);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: { id: "12", schoolCode: "SCH-001", mutationId: "batch-review-1" },
      }));
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: { id: "13", schoolCode: "SCH-002", mutationId: "batch-review-2" },
      }));
    });

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.meta.total).toBe(0);
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(2);
    });
  });

  it("shrinks the last Review Inbox page after its only row is deleted", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        ...actionableResponse,
        meta: {
          ...actionableResponse.meta,
          currentPage: 2,
          lastPage: 2,
          total: 11,
          from: 11,
          to: 11,
        },
      })
      .mockResolvedValueOnce(emptyResponse);
    const { result } = renderHook(() => useMonitorReviewInbox({
      enabled: true,
      filters: {},
      page: 2,
      perPage: 10,
    }));

    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:school-deleted", {
        detail: { id: "12", schoolCode: "SCH-001", mutationId: "last-page" },
      }));
    });

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.meta.total).toBe(10);
    expect(result.current.meta.lastPage).toBe(1);
    expect(result.current.meta.currentPage).toBe(1);
    expect(result.current.meta.from).toBeNull();
    expect(result.current.meta.to).toBeNull();
  });

  it("stops shared refreshes when the review inbox is disabled", async () => {
    vi.mocked(apiRequest).mockResolvedValue(emptyResponse);

    const { rerender } = renderReviewInbox();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    rerender({ isEnabled: false });
    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: { entity: "indicators", eventType: "indicators.submitted" },
      }));
      window.dispatchEvent(new Event("focus"));
    });

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
