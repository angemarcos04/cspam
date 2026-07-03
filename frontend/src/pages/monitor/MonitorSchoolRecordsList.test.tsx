import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorSchoolRecordsList } from "@/pages/monitor/MonitorSchoolRecordsList";
import type { MonitorSchoolRecordsListProps, MonitorSchoolRequirementSummary } from "@/pages/monitor/MonitorSchoolRecordsList";
import type { SchoolHeadAccountSummary, SchoolRecord, SchoolStatus } from "@/types";

afterEach(() => {
  cleanup();
});

function buildSummary(overrides: Partial<MonitorSchoolRequirementSummary> = {}): MonitorSchoolRequirementSummary {
  return {
    schoolKey: "school-1",
    schoolCode: "108323",
    schoolName: "Abra Elementary School",
    region: "Region II",
    schoolLevel: "Elementary",
    schoolType: "public",
    schoolStatus: "active",
    packageSchoolType: "public",
    requirementModeLabel: "Active package requirements: BMEF and SMEA.",
    activePackageLabel: "BMEF and SMEA",
    hasComplianceRecord: true,
    indicatorStatus: "validated",
    hasActivePackageSubmission: true,
    hasAnySubmitted: true,
    isComplete: true,
    awaitingReviewCount: 0,
    missingCount: 0,
    submissionProgress: {
      submitted: 4,
      total: 4,
      label: "Submitted 4/4",
      title: "4 out of 4 requirements have been submitted.",
      tone: "border border-emerald-200 bg-emerald-50 text-emerald-700",
    },
    lastActivityAt: "2026-06-18T08:00:00.000Z",
    lastActivityTime: 1771228800000,
    hasReminderRecipient: true,
    reminderRecipientStatus: "available",
    latestReminder: null,
    ...overrides,
  };
}

function buildSchoolHeadAccount(accountStatus: string, lifecycleState = accountStatus): SchoolHeadAccountSummary {
  return {
    id: `account-${accountStatus}-${lifecycleState}`,
    name: "School Head",
    email: "head@cspams.local",
    emailVerifiedAt: "2026-05-01T08:00:00.000Z",
    lastLoginAt: null,
    accountStatus,
    mustResetPassword: false,
    lifecycleState,
    lifecycleStateLabel: null,
    recommendedAction: "none",
    verifiedAt: "2026-05-01T08:00:00.000Z",
    verifiedByUserId: "1",
    verifiedByName: "Monitor User",
    verificationNotes: null,
    flagged: false,
    flaggedAt: null,
    flagReason: null,
    deleteRecordFlagged: false,
    deleteRecordFlaggedAt: null,
    deleteRecordReason: null,
    setupLinkExpiresAt: null,
  };
}

function buildRecord(overrides: Partial<SchoolRecord> = {}): SchoolRecord {
  return {
    id: "record-1",
    schoolId: "108323",
    schoolCode: "108323",
    schoolName: "Abra Elementary School",
    level: "Elementary",
    district: null,
    address: null,
    type: "public",
    studentCount: 0,
    teacherCount: 0,
    region: "Region II",
    status: "active",
    submittedBy: "Monitor User",
    lastUpdated: "2026-06-18T08:00:00.000Z",
    schoolHeadAccount: buildSchoolHeadAccount("active", "active_ready"),
    indicatorLatest: null,
    ...overrides,
  };
}

function renderList(overrides: Partial<MonitorSchoolRecordsListProps> = {}) {
  const props: MonitorSchoolRecordsListProps = {
    showLoadingSkeleton: false,
    scopeSchoolsCount: 1,
    hasDashboardFilters: false,
    compactSchoolRowsCount: 1,
    paginatedRows: [{ summary: buildSummary(), record: buildRecord() }],
    statusFilter: "all",
    requirementFilter: "all",
    schoolQuickPreset: "all",
    safeRecordsPage: 1,
    totalRecordPages: 1,
    canGoPrevious: false,
    canGoNext: false,
    onResetQueueFilters: vi.fn(),
    onClearAllFilters: vi.fn(),
    onToggleStatusFilter: vi.fn(),
    onToggleRequirementFilter: vi.fn(),
    onToggleSchoolQuickPreset: vi.fn(),
    onOpenSchool: vi.fn(),
    onReviewSchool: vi.fn(),
    onPreviousPage: vi.fn(),
    onNextPage: vi.fn(),
    formatDateTime: (value) => value,
    statusTone: (status: SchoolStatus) => {
      if (status === "inactive") return "bg-rose-50 text-rose-700";
      if (status === "pending") return "bg-amber-50 text-amber-700";
      return "bg-primary-50 text-primary-700";
    },
    statusLabel: (status: SchoolStatus) => {
      if (status === "inactive") return "Inactive";
      if (status === "pending") return "Pending";
      return "Active";
    },
    isUrgentRequirement: () => false,
    urgencyRowTone: () => "bg-white",
    ...overrides,
  };

  render(<MonitorSchoolRecordsList {...props} />);
  return props;
}

describe("MonitorSchoolRecordsList", () => {
  it("explains how to restore in-scope schools when filters narrow visible rows to zero", () => {
    const onResetQueueFilters = vi.fn();
    const onClearAllFilters = vi.fn();

    render(
      <MonitorSchoolRecordsList
        showLoadingSkeleton={false}
        scopeSchoolsCount={46}
        hasDashboardFilters
        compactSchoolRowsCount={0}
        paginatedRows={[]}
        statusFilter="all"
        requirementFilter="all"
        schoolQuickPreset="missing"
        safeRecordsPage={1}
        totalRecordPages={1}
        canGoPrevious={false}
        canGoNext={false}
        onResetQueueFilters={onResetQueueFilters}
        onClearAllFilters={onClearAllFilters}
        onToggleStatusFilter={vi.fn()}
        onToggleRequirementFilter={vi.fn()}
        onToggleSchoolQuickPreset={vi.fn()}
        onOpenSchool={vi.fn()}
        onReviewSchool={vi.fn()}
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
        formatDateTime={(value) => value}
        statusTone={() => "bg-white text-slate-900"}
        statusLabel={() => "Active"}
        isUrgentRequirement={() => false}
        urgencyRowTone={() => "bg-white"}
      />,
    );

    expect(screen.getByText("No visible school records")).toBeTruthy();
    expect(
      screen.getByText(
        "No schools match the current Submission Incomplete preset. Use Reset queue filters or Clear all to show schools in scope again.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reset queue filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onResetQueueFilters).toHaveBeenCalledTimes(1);
    expect(onClearAllFilters).toHaveBeenCalledTimes(1);
  });

  it("renders operational status without the School prefix", () => {
    renderList();

    expect(screen.getByRole("button", { name: "Active" })).toBeTruthy();
    expect(screen.queryByText("School Active")).toBeNull();
  });

  it("displays inactive as Suspended without mutating the underlying status", () => {
    const inactiveSummary = buildSummary({
      schoolStatus: "inactive",
      submissionProgress: {
        submitted: 1,
        total: 4,
        label: "Submitted 1/4",
        title: "1 out of 4 requirements have been submitted.",
        tone: "border border-amber-200 bg-amber-50 text-amber-700",
      },
    });
    const props = renderList({
      paginatedRows: [{ summary: inactiveSummary, record: null }],
    });

    expect(screen.getByRole("button", { name: "Suspended" })).toBeTruthy();
    expect(inactiveSummary.schoolStatus).toBe("inactive");
    fireEvent.click(screen.getByRole("button", { name: "Suspended" }));
    expect(props.onToggleStatusFilter).toHaveBeenCalledWith("inactive");
  });

  it("displays pending operational status", () => {
    renderList({
      paginatedRows: [{ summary: buildSummary({ schoolStatus: "pending" }), record: null }],
    });

    expect(screen.getByRole("button", { name: "Pending" })).toBeTruthy();
  });

  it("uses workflow overrides before progress badges", () => {
    const onToggleRequirementFilter = vi.fn();
    const onReviewSchool = vi.fn();
    renderList({
      paginatedRows: [
        { summary: buildSummary({ schoolKey: "returned", schoolName: "Returned School", indicatorStatus: "returned" }), record: null },
        { summary: buildSummary({ schoolKey: "review", schoolName: "Review School", indicatorStatus: "submitted", awaitingReviewCount: 2 }), record: null },
      ],
      onToggleRequirementFilter,
      onReviewSchool,
    });

    expect(screen.getByRole("button", { name: "Returned" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "For Review" })).toBeTruthy();
    expect(screen.queryByText(/Incomplete/)).toBeNull();
    expect(screen.queryByText("OK")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Returned" }));
    fireEvent.click(screen.getByRole("button", { name: "For Review" }));
    expect(onToggleRequirementFilter).toHaveBeenCalledWith("returned");
    expect(onToggleRequirementFilter).toHaveBeenCalledWith("waiting");

    fireEvent.click(screen.getByRole("button", { name: "For Review" }), { shiftKey: true });
    expect(onReviewSchool).toHaveBeenCalled();
  });

  it("renders concise public and private submission progress badges", () => {
    renderList({
      paginatedRows: [
        { summary: buildSummary({ schoolKey: "public", schoolName: "Public School" }), record: null },
        {
          summary: buildSummary({
            schoolKey: "private",
            schoolName: "Private School",
            schoolType: "private",
            packageSchoolType: "private",
            submissionProgress: {
              submitted: 1,
              total: 2,
              label: "Submitted 1/2",
              title: "1 out of 2 requirements have been submitted.",
              tone: "border border-amber-200 bg-amber-50 text-amber-700",
            },
          }),
          record: null,
        },
      ],
    });

    expect(screen.getByText("Submitted 4/4")).toBeTruthy();
    expect(screen.getByText("Submitted 1/2")).toBeTruthy();
    expect(screen.queryByText(/Incomplete/)).toBeNull();
    expect(screen.queryByText("OK")).toBeNull();
  });

  it("renders School Head account badges separately from submission progress badges", () => {
    renderList({
      paginatedRows: [
        {
          summary: buildSummary({ schoolKey: "active", schoolName: "Active Head School" }),
          record: buildRecord({ id: "active", schoolHeadAccount: buildSchoolHeadAccount("active", "active_ready") }),
        },
        {
          summary: buildSummary({ schoolKey: "setup", schoolName: "Setup Head School" }),
          record: buildRecord({ id: "setup", schoolHeadAccount: buildSchoolHeadAccount("pending_setup", "pending_setup") }),
        },
        {
          summary: buildSummary({ schoolKey: "verify", schoolName: "Verify Head School" }),
          record: buildRecord({ id: "verify", schoolHeadAccount: buildSchoolHeadAccount("pending_verification", "pending_verification") }),
        },
        {
          summary: buildSummary({ schoolKey: "suspended", schoolName: "Suspended Head School" }),
          record: buildRecord({ id: "suspended", schoolHeadAccount: buildSchoolHeadAccount("suspended", "suspended") }),
        },
        {
          summary: buildSummary({ schoolKey: "missing", schoolName: "Missing Head School" }),
          record: buildRecord({ id: "missing", schoolHeadAccount: null }),
        },
      ],
    });

    expect(screen.getByText("School Head: Active")).toBeTruthy();
    expect(screen.getAllByText("School Head: Activation Needed")).toHaveLength(2);
    expect(screen.getByText("School Head: Suspended")).toBeTruthy();
    expect(screen.getByText("No School Head Account")).toBeTruthy();
    expect(screen.getAllByText("Submitted 4/4")).toHaveLength(5);
    expect(screen.queryByText("Setup Needed")).toBeNull();
  });
});
