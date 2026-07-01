import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ALL_SCHOOL_SCOPE } from "@/pages/monitor/monitorFilters";
import {
  buildMonitorRequirementSummaryState,
  buildSchoolCategoryCounts,
  matchesSchoolCategoryFilter,
  normalizeSchoolLevel,
  normalizeSchoolSector,
  useMonitorRequirementData,
} from "@/pages/monitor/useMonitorRequirementData";
import type { IndicatorSubmission, SchoolHeadAccountSummary, SchoolRecord, SchoolStatus } from "@/types";

const REQUIREMENT_FILTER_OPTIONS = [
  { id: "all" as const, label: "All" },
  { id: "missing" as const, label: "Missing" },
  { id: "waiting" as const, label: "Waiting" },
  { id: "returned" as const, label: "Returned" },
  { id: "submitted" as const, label: "Submitted" },
  { id: "validated" as const, label: "Validated" },
];

function buildRecord(
  status: "submitted" | "validated" | "returned",
  overrides: Partial<SchoolRecord> = {},
): SchoolRecord {
  return {
    id: "record-1",
    schoolId: "108323",
    schoolCode: "108323",
    schoolName: "Abra Elementary School",
    level: "Elementary",
    district: null,
    address: null,
    type: "public",
    studentCount: 125,
    teacherCount: 9,
    region: "Region II",
    status: "active",
    submittedBy: "School Head",
    lastUpdated: "2026-06-18T08:00:00.000Z",
    indicatorLatest: {
      id: "submission-1",
      status,
      submittedAt: "2026-06-18T08:00:00.000Z",
      reviewedAt: status === "submitted" ? null : "2026-06-18T09:00:00.000Z",
      createdAt: "2026-06-18T07:30:00.000Z",
      updatedAt: status === "submitted" ? "2026-06-18T08:00:00.000Z" : "2026-06-18T09:00:00.000Z",
    },
    ...overrides,
  };
}

function buildSubmission(overrides: Partial<IndicatorSubmission> = {}): IndicatorSubmission {
  return {
    id: "submission-1",
    formType: "indicator",
    status: "validated",
    statusLabel: "Validated",
    reportingPeriod: null,
    version: 1,
    schoolId: "108323",
    schoolType: "public",
    school: {
      id: "108323",
      schoolCode: "108323",
      name: "Abra Elementary School",
      type: "public",
    },
    academicYear: {
      id: "2026",
      name: "SY 2025-2026",
    },
    notes: null,
    reviewNotes: null,
    summary: {
      totalIndicators: 0,
      metIndicators: 0,
      belowTargetIndicators: 0,
      complianceRatePercent: 0,
    },
    indicators: [],
    submittedAt: "2026-06-18T08:00:00.000Z",
    reviewedAt: "2026-06-18T09:00:00.000Z",
    createdAt: "2026-06-18T07:30:00.000Z",
    updatedAt: "2026-06-18T09:00:00.000Z",
    ...overrides,
  };
}

function buildSchoolHeadAccount(accountStatus: string): SchoolHeadAccountSummary {
  return {
    id: `account-${accountStatus}`,
    name: "School Head",
    email: `${accountStatus}@cspams.local`,
    emailVerifiedAt: "2026-05-01T08:00:00.000Z",
    lastLoginAt: null,
    accountStatus,
    mustResetPassword: false,
    lifecycleState: accountStatus === "suspended" ? "suspended" : "active_ready",
    lifecycleStateLabel: accountStatus === "suspended" ? "Suspended" : "Active",
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

function renderRequirementHook(
  records: SchoolRecord[],
  allSubmissions: IndicatorSubmission[] = [],
  statusFilter: SchoolStatus | "all" = "all",
) {
  return renderHook(({ currentRecords, currentSubmissions }: { currentRecords: SchoolRecord[]; currentSubmissions: IndicatorSubmission[] }) =>
    useMonitorRequirementData({
      records: currentRecords,
      scopedRecords: currentRecords,
      allSubmissions: currentSubmissions,
      scopedSchoolKeys: null,
      selectedSchoolScopeKey: ALL_SCHOOL_SCOPE,
      hasSelectedSchoolScope: false,
      filterDateFrom: "",
      filterDateTo: "",
      requirementFilter: "all",
      statusFilter,
      schoolQuickPreset: "all",
      schoolSectorFilter: "all",
      schoolLevelFilter: "all",
      queueLane: "all",
      effectiveSearch: "",
      activeTopNavigator: "reviews",
      requirementsPage: 1,
      recordsPage: 1,
      requirementPageSize: 10,
      recordPageSize: 10,
      allSchoolScopeKey: ALL_SCHOOL_SCOPE,
      requirementFilterOptions: REQUIREMENT_FILTER_OPTIONS,
    }),
    { initialProps: { currentRecords: records, currentSubmissions: allSubmissions } },
  );
}

describe("buildMonitorRequirementSummaryState", () => {
  it("makes private active package meaning explicit in monitor summary state", () => {
    const result = buildMonitorRequirementSummaryState(
      {
        type: "private",
        indicatorLatest: null,
      },
      true,
    );

    expect(result.packageSchoolType).toBe("private");
    expect(result.activePackageLabel).toBe("FM-QAD uploads only");
    expect(result.requirementModeLabel).toBe("Active package requirements: FM-QAD uploads only.");
    expect(result.missingCount).toBe(1);
  });

  it("treats only monitor-relevant submitted states as active package submission truth", () => {
    const draftState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "draft",
          submittedAt: null,
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );
    const returnedState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-2",
          status: "returned",
          submittedAt: null,
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );

    expect(draftState.hasActivePackageSubmission).toBe(false);
    expect(returnedState.hasActivePackageSubmission).toBe(true);
    expect(returnedState.hasAnySubmitted).toBe(true);
  });

  it("derives queue and school badge state from refreshed indicator status", () => {
    const forReviewState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "submitted",
          submittedAt: "2026-06-18T08:00:00.000Z",
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );
    const verifiedState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "validated",
          submittedAt: "2026-06-18T08:00:00.000Z",
          reviewedAt: "2026-06-18T09:00:00.000Z",
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );
    const returnedState = buildMonitorRequirementSummaryState(
      {
        type: "public",
        indicatorLatest: {
          id: "sub-1",
          status: "returned",
          submittedAt: "2026-06-18T08:00:00.000Z",
          reviewedAt: "2026-06-18T09:00:00.000Z",
          createdAt: null,
          updatedAt: null,
        },
      },
      true,
    );

    expect(forReviewState.indicatorStatus).toBe("submitted");
    expect(forReviewState.awaitingReviewCount).toBe(1);
    expect(forReviewState.missingCount).toBe(0);

    expect(verifiedState.indicatorStatus).toBe("validated");
    expect(verifiedState.awaitingReviewCount).toBe(0);
    expect(verifiedState.missingCount).toBe(0);

    expect(returnedState.indicatorStatus).toBe("returned");
    expect(returnedState.awaitingReviewCount).toBe(0);
    expect(returnedState.missingCount).toBe(0);
    expect(returnedState.hasActivePackageSubmission).toBe(true);
  });

  it("updates visible queue rows and school badges when refreshed records change after review", () => {
    const { result, rerender } = renderRequirementHook([buildRecord("submitted")]);

    expect(result.current.queueLaneCounts.for_review).toBe(1);
    expect(result.current.requirementCounts.awaitingReview).toBe(1);
    expect(result.current.paginatedRequirementRows).toHaveLength(1);
    expect(result.current.paginatedRequirementRows[0].indicatorStatus).toBe("submitted");
    expect(result.current.paginatedRequirementRows[0].awaitingReviewCount).toBe(1);
    expect(result.current.paginatedCompactSchoolRows[0].summary.indicatorStatus).toBe("submitted");

    rerender({ currentRecords: [buildRecord("validated")], currentSubmissions: [] });

    expect(result.current.queueLaneCounts.for_review).toBe(0);
    expect(result.current.requirementCounts.awaitingReview).toBe(0);
    expect(result.current.requirementCounts.missing).toBe(0);
    expect(result.current.requirementCounts.complete).toBe(1);
    expect(result.current.paginatedRequirementRows).toHaveLength(0);
    expect(result.current.paginatedCompactSchoolRows[0].summary.indicatorStatus).toBe("validated");

    rerender({ currentRecords: [buildRecord("returned")], currentSubmissions: [] });

    expect(result.current.queueLaneCounts.returned).toBe(1);
    expect(result.current.requirementCounts.returned).toBe(1);
    expect(result.current.requirementCounts.awaitingReview).toBe(0);
    expect(result.current.paginatedRequirementRows).toHaveLength(1);
    expect(result.current.paginatedRequirementRows[0].indicatorStatus).toBe("returned");
    expect(result.current.paginatedCompactSchoolRows[0].summary.indicatorStatus).toBe("returned");
  });

  it("builds public submission progress from the four monitor-visible units", () => {
    const fullPublicSubmission = buildSubmission({
      scopeProgress: {
        requiredScopeIds: [
          "school_achievements_learning_outcomes",
          "key_performance_indicators",
          "bmef",
          "smea",
        ],
        submittedScopeIds: [
          "school_achievements_learning_outcomes",
          "key_performance_indicators",
          "bmef",
          "smea",
        ],
      },
    });
    const partialPublicSubmission = buildSubmission({
      id: "submission-2",
      updatedAt: "2026-06-18T10:00:00.000Z",
      scopeProgress: {
        requiredScopeIds: [
          "school_achievements_learning_outcomes",
          "key_performance_indicators",
          "bmef",
          "smea",
        ],
        submittedScopeIds: ["bmef", "smea"],
      },
    });

    const fullResult = renderRequirementHook([buildRecord("validated")], [fullPublicSubmission]).result;
    expect(fullResult.current.paginatedCompactSchoolRows[0].summary.submissionProgress?.label).toBe("Submitted 4/4");

    const partialResult = renderRequirementHook([buildRecord("validated")], [partialPublicSubmission]).result;
    expect(partialResult.current.paginatedCompactSchoolRows[0].summary.submissionProgress?.label).toBe("Submitted 2/4");
  });

  it("builds private submission progress from active FM-QAD scope counts", () => {
    const privateSubmission = buildSubmission({
      schoolType: "private",
      school: {
        id: "108323",
        schoolCode: "108323",
        name: "Abra Elementary School",
        type: "private",
      },
      scopeProgress: {
        requiredScopeIds: ["fm_qad_001", "fm_qad_002"],
        submittedScopeIds: ["fm_qad_001"],
      },
    });
    const privateRecord = buildRecord("validated", { type: "private" });
    const { result } = renderRequirementHook([privateRecord], [privateSubmission]);

    expect(result.current.paginatedCompactSchoolRows[0].summary.submissionProgress?.label).toBe("Submitted 1/2");
  });

  it("uses suspended account status as the monitor display status for cards, counts, and filters", () => {
    const activeRecord = buildRecord("validated", {
      id: "record-active",
      schoolId: "108323",
      schoolCode: "108323",
      schoolName: "Active Account School",
      status: "active",
      schoolHeadAccount: buildSchoolHeadAccount("active"),
    });
    const suspendedAccountRecord = buildRecord("validated", {
      id: "record-suspended",
      schoolId: "108324",
      schoolCode: "108324",
      schoolName: "Suspended Account School",
      status: "active",
      schoolHeadAccount: buildSchoolHeadAccount("suspended"),
    });
    const { result: allResult } = renderRequirementHook([activeRecord, suspendedAccountRecord]);

    const suspendedRow = allResult.current.paginatedCompactSchoolRows.find((row) => row.summary.schoolName === "Suspended Account School");
    const activeRow = allResult.current.paginatedCompactSchoolRows.find((row) => row.summary.schoolName === "Active Account School");

    expect(suspendedRow?.summary.schoolStatus).toBe("inactive");
    expect(activeRow?.summary.schoolStatus).toBe("active");
    expect(suspendedAccountRecord.status).toBe("active");
    expect(allResult.current.schoolStatusCounts).toMatchObject({ all: 2, active: 1, inactive: 1, pending: 0 });

    const { result: suspendedFilterResult } = renderRequirementHook([activeRecord, suspendedAccountRecord], [], "inactive");
    expect(suspendedFilterResult.current.paginatedCompactSchoolRows.map((row) => row.summary.schoolName)).toEqual([
      "Suspended Account School",
    ]);
  });

  it("normalizes school sector and level values used by monitor school filters", () => {
    expect(normalizeSchoolSector("Public")).toBe("public");
    expect(normalizeSchoolSector(" private ")).toBe("private");
    expect(normalizeSchoolSector("charter")).toBeNull();

    expect(normalizeSchoolLevel("Elementary")).toBe("elementary");
    expect(normalizeSchoolLevel("High School")).toBe("high_school");
    expect(normalizeSchoolLevel("secondary")).toBe("high_school");
    expect(normalizeSchoolLevel("integrated")).toBeNull();
  });

  it("counts public and private schools by normalized level", () => {
    const counts = buildSchoolCategoryCounts([
      { type: "Public", level: "Elementary" },
      { type: "public", level: "High School" },
      { type: "Private", level: "Secondary" },
      { type: "private", level: "Elementary" },
      { type: "private", level: null },
      { type: null, level: "Elementary" },
    ]);

    expect(counts).toEqual({
      total: 6,
      public: 2,
      private: 3,
      publicElementary: 1,
      publicHighSchool: 1,
      privateElementary: 1,
      privateHighSchool: 1,
    });
  });

  it("matches school category filters without matching unknown values", () => {
    const publicElementary = { type: "public", level: "Elementary" };
    const privateHighSchool = { type: "Private", level: "Secondary" };
    const unknown = { type: null, level: null };

    expect(matchesSchoolCategoryFilter(publicElementary, "public", "elementary")).toBe(true);
    expect(matchesSchoolCategoryFilter(publicElementary, "public", "high_school")).toBe(false);
    expect(matchesSchoolCategoryFilter(privateHighSchool, "private", "high_school")).toBe(true);
    expect(matchesSchoolCategoryFilter(privateHighSchool, "public", "all")).toBe(false);
    expect(matchesSchoolCategoryFilter(unknown, "all", "all")).toBe(true);
    expect(matchesSchoolCategoryFilter(unknown, "public", "all")).toBe(false);
  });
});
