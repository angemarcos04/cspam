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

  it("refreshes review inbox on browser focus", async () => {
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
