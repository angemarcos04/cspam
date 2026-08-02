import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { useMonitorSubmissionDeepLink } from "@/pages/monitor/useMonitorSubmissionDeepLink";
import type { IndicatorSubmission } from "@/types";

function submission(overrides: Partial<IndicatorSubmission> = {}): IndicatorSubmission {
  return {
    id: "123",
    formType: "indicator",
    status: "draft",
    statusLabel: "Draft",
    reportingPeriod: "ANNUAL",
    version: 1,
    schoolId: "45",
    school: { id: "45", schoolCode: "900001", name: "Santiago School", type: "public" },
    academicYear: { id: "9", name: "2026-2027" },
    notes: null,
    reviewNotes: null,
    summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
    scopeProgress: { requiredScopeIds: ["smea"], submittedScopeIds: ["smea"] },
    scopeReviews: [],
    indicators: [],
    submittedAt: null,
    reviewedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as IndicatorSubmission;
}

function setup(fetchSubmission = vi.fn().mockResolvedValue(submission())) {
  const args = {
    filtersHydrated: true,
    fetchSubmission,
    refreshSubmissions: vi.fn().mockResolvedValue(undefined),
    refreshReviewInbox: vi.fn().mockResolvedValue(undefined),
    setActiveTopNavigator: vi.fn(),
    openSchoolDrawer: vi.fn(),
    setActiveSchoolDrawerTab: vi.fn(),
    setSelectedSchoolDrawerYear: vi.fn(),
    setHighlightedDrawerIndicatorKey: vi.fn(),
    pushToast: vi.fn(),
  };

  function Harness() {
    useMonitorSubmissionDeepLink(args);
    const location = useLocation();
    return <span data-testid="location">{location.pathname}{location.search}</span>;
  }

  return { args, Harness };
}

describe("useMonitorSubmissionDeepLink", () => {
  afterEach(() => cleanup());

  it("loads the authoritative submission and opens its exact school, year, and scope", async () => {
    const { args, Harness } = setup();
    render(
      <MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123&schoolId=999&academicYearId=888&scopeId=smea"]}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(args.fetchSubmission).toHaveBeenCalledWith("123"));
    expect(args.setActiveTopNavigator).toHaveBeenCalledWith("reviews");
    expect(args.openSchoolDrawer).toHaveBeenCalledWith("code:900001", "123");
    expect(args.setSelectedSchoolDrawerYear).toHaveBeenCalledWith("9");
    expect(args.setHighlightedDrawerIndicatorKey).toHaveBeenCalledWith("smea");
  });

  it("opens the submission summary and warns when the requested scope is invalid", async () => {
    const { args, Harness } = setup();
    render(
      <MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123&scopeId=missing_scope"]}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(args.openSchoolDrawer).toHaveBeenCalled());
    expect(args.setHighlightedDrawerIndicatorKey).toHaveBeenCalledWith(null);
    expect(args.pushToast).toHaveBeenCalledWith(
      "The referenced requirement is no longer available in this submission.",
      "warning",
    );
  });

  it("normalizes a missing submission back to Reviews with a controlled message", async () => {
    const fetchSubmission = vi.fn().mockRejectedValue(new ApiError("Not found", 404, null));
    const { args, Harness } = setup(fetchSubmission);
    render(
      <MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=missing"]}>
        <Harness />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/monitor?section=reviews"));
    expect(args.pushToast).toHaveBeenCalledWith(
      "The referenced submission is no longer available.",
      "warning",
    );
  });
});
