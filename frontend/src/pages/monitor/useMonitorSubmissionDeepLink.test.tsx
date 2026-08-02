import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
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
    const deepLink = useMonitorSubmissionDeepLink(args);
    const location = useLocation();
    const navigate = useNavigate();
    return <>
      <span data-testid="location">{location.pathname}{location.search}</span>
      {deepLink.error?.retryable && <button type="button" onClick={deepLink.retry}>Retry</button>}
      <button type="button" onClick={() => navigate("/monitor?section=reviews")}>General reviews</button>
      <button type="button" onClick={() => navigate("/monitor?section=schools")}>Schools</button>
      <button type="button" onClick={() => navigate("/monitor?section=reviews&submissionId=456&scopeId=smea")}>Second target</button>
    </>;
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
      "The referenced requirement has not been submitted or is no longer available for review.",
      "warning",
    );
  });

  it.each(["fm_qad_003", "smea", "targets_met"])("accepts submitted scope %s", async (scopeId) => {
    const fetchSubmission = vi.fn().mockResolvedValue(submission({
      scopeProgress: { requiredScopeIds: [scopeId], submittedScopeIds: [scopeId] },
    }));
    const { args, Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={[`/monitor?section=reviews&submissionId=123&scopeId=${scopeId}`]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(args.setHighlightedDrawerIndicatorKey).toHaveBeenCalledWith(scopeId));
  });

  it("rejects a required scope that was never submitted", async () => {
    const fetchSubmission = vi.fn().mockResolvedValue(submission({
      scopeProgress: { requiredScopeIds: ["fm_qad_003"], submittedScopeIds: [] },
    }));
    const { args, Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123&scopeId=fm_qad_003"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(args.setHighlightedDrawerIndicatorKey).toHaveBeenCalledWith(null));
    expect(args.pushToast).toHaveBeenCalledWith(
      "The referenced requirement has not been submitted or is no longer available for review.",
      "warning",
    );
  });

  it("accepts a previously reviewed scope even when it is no longer submitted", async () => {
    const fetchSubmission = vi.fn().mockResolvedValue(submission({
      scopeProgress: { requiredScopeIds: ["smea"], submittedScopeIds: [] },
      scopeReviews: [{ scopeId: "smea", decision: "verified" } as never],
    }));
    const { args, Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123&scopeId=smea"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(args.setHighlightedDrawerIndicatorKey).toHaveBeenCalledWith("smea"));
    expect(args.pushToast).toHaveBeenCalledWith("This requirement has already been reviewed.", "info");
  });

  it("opens a package target as a summary without selecting a scope", async () => {
    const { args, Harness } = setup();
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(args.openSchoolDrawer).toHaveBeenCalled());
    expect(args.setHighlightedDrawerIndicatorKey).toHaveBeenCalledWith(null);
  });

  it("normalizes a forbidden submission without disclosing target existence", async () => {
    const fetchSubmission = vi.fn().mockRejectedValue(new ApiError("Forbidden", 403, null));
    const { args, Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=forbidden"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/monitor?section=reviews"));
    expect(args.pushToast).toHaveBeenCalledWith("The referenced submission could not be opened.", "warning");
  });

  it("keeps a transient target and retries it successfully", async () => {
    const fetchSubmission = vi.fn()
      .mockRejectedValueOnce(new ApiError("Server unavailable", 500, null))
      .mockResolvedValueOnce(submission());
    const { args, Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123&scopeId=smea"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    expect(screen.getByTestId("location").textContent).toContain("submissionId=123");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(fetchSubmission).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(args.openSchoolDrawer).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it.each(["General reviews", "Schools"])("clears transient Retry state after navigating to %s", async (destination) => {
    const fetchSubmission = vi.fn().mockRejectedValue(new ApiError("Server unavailable", 500, null));
    const { Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: destination }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    expect(fetchSubmission).toHaveBeenCalledTimes(1);
  });

  it("clears the first error and opens a second notification target", async () => {
    const fetchSubmission = vi.fn()
      .mockRejectedValueOnce(new ApiError("Server unavailable", 500, null))
      .mockResolvedValueOnce(submission({ id: "456" }));
    const { args, Harness } = setup(fetchSubmission);
    render(<MemoryRouter initialEntries={["/monitor?section=reviews&submissionId=123"]}><Harness /></MemoryRouter>);

    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Second target" }));
    await waitFor(() => expect(fetchSubmission).toHaveBeenLastCalledWith("456"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
    expect(args.openSchoolDrawer).toHaveBeenCalledWith("code:900001", "456");
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
