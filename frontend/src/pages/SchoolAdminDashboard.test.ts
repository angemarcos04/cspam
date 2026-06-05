import { describe, expect, it } from "vitest";
import {
  buildSchoolAdminRefreshBatches,
  buildDashboardViewYearStorageKey,
  formatComplianceStatusLabel,
  resolveInitialSchoolHeadReportAcademicYearId,
  resolveInitialSubmittedReportAcademicYearId,
  resolveCurrentReportIndicatorByGroupAKey,
  resolveHydratedCurrentReportSubmissionCandidate,
  resolveSelectedYearCurrentReportContextSubmissions,
  resolveSchoolAdminHeaderContext,
} from "@/pages/SchoolAdminDashboard";
import {
  buildSchoolHeadCurrentReportBlankStateLines,
  buildSchoolHeadCurrentReportSourceContext,
  buildSubmittedReportBlankStateLines,
  buildSubmittedReportSourceContext,
  resolvePreferredSchoolHeadCurrentReportAcademicYearId,
  resolvePreferredSubmittedReportAcademicYearId,
  resolveSelectedYearReportSubmission,
  resolveSelectedYearSchoolHeadCurrentReportSubmission,
  resolveSchoolHeadReportSourceMode,
  resolveSchoolHeadCurrentReportSubmissionForView,
  resolveStableSchoolHeadCurrentReportViewSubmission,
  resolveStableSubmittedReportViewSubmission,
  resolveSubmittedReportIndicatorByMetricCode,
  resolveSubmittedReportSubmissionForView,
} from "@/pages/schoolAdminSubmittedReportView";
import type { IndicatorSubmission, IndicatorSubmissionItem } from "@/types";

function submission(overrides: Partial<IndicatorSubmission>): IndicatorSubmission {
  return {
    id: "submission-1",
    formType: "indicator",
    academicYear: { id: "year-1", name: "2025-2026" },
    reportingPeriod: "ANNUAL",
    status: "draft",
    statusLabel: "Draft",
    version: 1,
    notes: null,
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    submittedAt: null,
    reviewedAt: null,
    reviewNotes: null,
    indicators: [],
    items: [],
    summary: {
      totalIndicators: 0,
      metIndicators: 0,
      belowTargetIndicators: 0,
      complianceRatePercent: 0,
    },
    completion: {
      hasImetaFormData: false,
      hasBmefFile: false,
      hasSmeaFile: false,
      isComplete: false,
    },
    ...overrides,
  };
}

describe("resolveSelectedYearReportSubmission", () => {
  it("ignores draft and returned submissions for the submitted package view", () => {
    const result = resolveSelectedYearReportSubmission([
      submission({ id: "draft-1", status: "draft", statusLabel: "Draft", updatedAt: "2026-04-30T00:00:00.000Z" }),
      submission({ id: "returned-1", status: "returned", statusLabel: "Returned", updatedAt: "2026-04-30T01:00:00.000Z" }),
    ]);

    expect(result).toBeNull();
  });

  it("prefers submitted or validated submissions when present", () => {
    const result = resolveSelectedYearReportSubmission([
      submission({ id: "submitted-1", status: "submitted", statusLabel: "Submitted", updatedAt: "2026-04-29T00:00:00.000Z" }),
      submission({ id: "validated-1", status: "validated", statusLabel: "Validated", updatedAt: "2026-04-30T00:00:00.000Z" }),
      submission({ id: "draft-1", status: "draft", statusLabel: "Draft", updatedAt: "2026-05-01T00:00:00.000Z" }),
    ]);

    expect(result?.id).toBe("validated-1");
  });

  it("uses submitted lineage recency before generic update freshness", () => {
    const result = resolveSelectedYearReportSubmission([
      submission({
        id: "submitted-newer-lineage",
        status: "submitted",
        statusLabel: "Submitted",
        submittedAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      }),
      submission({
        id: "validated-later-touch",
        status: "validated",
        statusLabel: "Validated",
        submittedAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-05-10T00:00:00.000Z",
      }),
    ]);

    expect(result?.id).toBe("submitted-newer-lineage");
  });
});

describe("resolvePreferredSubmittedReportAcademicYearId", () => {
  it("prefers the academic year of the latest finalized submission", () => {
    const result = resolvePreferredSubmittedReportAcademicYearId([
      submission({
        id: "submitted-old",
        status: "submitted",
        statusLabel: "Submitted",
        schoolId: "school-1",
        academicYear: { id: "year-1", name: "2025-2026" },
        updatedAt: "2026-04-29T00:00:00.000Z",
        school: { id: "school-1", schoolCode: "001", name: "Test School" },
      }),
      submission({
        id: "validated-new",
        status: "validated",
        statusLabel: "Validated",
        schoolId: "school-1",
        academicYear: { id: "year-2", name: "2026-2027" },
        updatedAt: "2026-04-30T00:00:00.000Z",
        school: { id: "school-1", schoolCode: "001", name: "Test School" },
      }),
      submission({
        id: "draft-newest",
        status: "draft",
        statusLabel: "Draft",
        academicYear: { id: "year-3", name: "2027-2028" },
        updatedAt: "2026-05-01T00:00:00.000Z",
        school: { id: "school-1", schoolCode: "001", name: "Test School" },
      }),
    ], "school-1");

    expect(result).toBe("year-2");
  });

  it("ignores finalized submissions whose strict school identity does not match the School Head school", () => {
    const result = resolvePreferredSubmittedReportAcademicYearId([
      submission({
        id: "wrong-school",
        status: "submitted",
        statusLabel: "Submitted",
        schoolId: "school-2",
        academicYear: { id: "year-2", name: "2026-2027" },
        updatedAt: "2026-04-30T00:00:00.000Z",
      }),
      submission({
        id: "right-school",
        status: "submitted",
        statusLabel: "Submitted",
        schoolId: "school-1",
        academicYear: { id: "year-1", name: "2025-2026" },
        updatedAt: "2026-04-29T00:00:00.000Z",
      }),
    ], "school-1");

    expect(result).toBe("year-1");
  });
});

describe("resolvePreferredSchoolHeadCurrentReportAcademicYearId", () => {
  it("prefers the academic year of the latest saved School Head package, including drafts", () => {
    const result = resolvePreferredSchoolHeadCurrentReportAcademicYearId([
      submission({
        id: "submitted-old",
        status: "submitted",
        statusLabel: "Submitted",
        schoolId: "school-1",
        academicYear: { id: "year-1", name: "2025-2026" },
        updatedAt: "2026-04-29T00:00:00.000Z",
        submittedAt: "2026-04-29T00:00:00.000Z",
        school: { id: "school-1", schoolCode: "001", name: "Test School" },
      }),
      submission({
        id: "draft-newest",
        status: "draft",
        statusLabel: "Draft",
        schoolId: "school-1",
        academicYear: { id: "year-2", name: "2026-2027" },
        updatedAt: "2026-05-01T00:00:00.000Z",
        submittedAt: null,
        school: { id: "school-1", schoolCode: "001", name: "Test School" },
      }),
    ], "school-1");

    expect(result).toBe("year-2");
  });

  it("ignores saved packages from another school", () => {
    const result = resolvePreferredSchoolHeadCurrentReportAcademicYearId([
      submission({
        id: "other-draft",
        status: "draft",
        statusLabel: "Draft",
        schoolId: "school-2",
        academicYear: { id: "year-2", name: "2026-2027" },
        updatedAt: "2026-05-01T00:00:00.000Z",
      }),
      submission({
        id: "own-returned",
        status: "returned",
        statusLabel: "Returned",
        schoolId: "school-1",
        academicYear: { id: "year-1", name: "2025-2026" },
        updatedAt: "2026-04-30T00:00:00.000Z",
      }),
    ], "school-1");

    expect(result).toBe("year-1");
  });
});

describe("resolveInitialSubmittedReportAcademicYearId", () => {
  it("prefers a stored academic year when it is valid for the current School Head session", () => {
    const result = resolveInitialSubmittedReportAcademicYearId([
      { id: "year-1", isCurrent: false },
      { id: "year-2", isCurrent: true },
    ], "year-1");

    expect(result).toBe("year-1");
  });

  it("defaults to the current academic year instead of the latest historical finalized year", () => {
    const result = resolveInitialSubmittedReportAcademicYearId([
      { id: "year-1", isCurrent: false },
      { id: "year-2", isCurrent: true },
      { id: "year-3", isCurrent: false },
    ], "");

    expect(result).toBe("year-2");
  });
});

describe("resolveInitialSchoolHeadReportAcademicYearId", () => {
  it("prefers the latest saved package year when there is no manual stored selection", () => {
    const result = resolveInitialSchoolHeadReportAcademicYearId([
      { id: "year-1", isCurrent: true },
      { id: "year-2", isCurrent: false },
    ], "year-1", "year-2", false);

    expect(result).toBe("year-2");
  });

  it("keeps a manually stored academic year when it is valid", () => {
    const result = resolveInitialSchoolHeadReportAcademicYearId([
      { id: "year-1", isCurrent: true },
      { id: "year-2", isCurrent: false },
    ], "year-1", "year-2", true);

    expect(result).toBe("year-1");
  });
});

describe("buildDashboardViewYearStorageKey", () => {
  it("scopes the stored year selection per School Head user and school", () => {
    expect(buildDashboardViewYearStorageKey(25, "103811")).toBe(
      "cspams:school-admin-dashboard:view-year:25:103811",
    );
  });

  it("returns an empty key when either the user or school context is missing", () => {
    expect(buildDashboardViewYearStorageKey(null, "103811")).toBe("");
    expect(buildDashboardViewYearStorageKey(25, "")).toBe("");
  });
});

describe("resolveSelectedYearCurrentReportContextSubmissions", () => {
  it("prefers a fresher same-year submission already present in indicator state over stale year-list rows", () => {
    const staleDashboardRow = submission({
      id: "draft-1",
      status: "draft",
      statusLabel: "Draft",
      academicYear: { id: "year-1", name: "2025-2026" },
      updatedAt: "2026-05-01T00:00:00.000Z",
      indicators: [],
      items: [],
    });
    const fresherScopedRow = submission({
      id: "draft-2",
      status: "draft",
      statusLabel: "Draft",
      academicYear: { id: "year-1", name: "2025-2026" },
      updatedAt: "2026-05-02T00:00:00.000Z",
      indicators: [
        {
          id: "item-1",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          actualValue: 2024,
          complianceStatus: "recorded",
        },
      ] as IndicatorSubmissionItem[],
      items: [],
    });

    const result = resolveSelectedYearCurrentReportContextSubmissions(
      [staleDashboardRow],
      [staleDashboardRow, fresherScopedRow],
      "year-1",
    );

    expect(result.map((entry) => entry.id)).toEqual(["draft-2", "draft-1"]);
  });
});

describe("resolveHydratedCurrentReportSubmissionCandidate", () => {
  it("preserves a fresher same-year hydrated submission over a stale selected source row", () => {
    const staleSelectedRow = submission({
      id: "submitted-1",
      status: "submitted",
      statusLabel: "Submitted",
      academicYear: { id: "year-1", name: "2025-2026" },
      updatedAt: "2026-05-01T00:00:00.000Z",
      submittedAt: "2026-05-01T00:00:00.000Z",
      indicators: [],
      items: [],
    });
    const fresherHydratedSubmitted = submission({
      id: "submitted-2",
      status: "submitted",
      statusLabel: "Submitted",
      academicYear: { id: "year-1", name: "2025-2026" },
      submittedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      indicators: [
        {
          id: "item-1",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: 2024,
          varianceValue: null,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });

    const result = resolveHydratedCurrentReportSubmissionCandidate(
      fresherHydratedSubmitted,
      staleSelectedRow,
      {
        selectedSchoolId: "",
        selectedAcademicYearId: "year-1",
      },
    );

    expect(result?.id).toBe("submitted-2");
    expect(result?.indicators?.[0]?.actualValue).toBe(2024);
  });

  it("does not borrow indicator details across different submission ids", () => {
    const olderDetailedSubmission = submission({
      id: "submitted-1",
      status: "submitted",
      statusLabel: "Submitted",
      academicYear: { id: "year-1", name: "2025-2026" },
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      indicators: [
        {
          id: "item-1",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: 1515,
          varianceValue: null,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });
    const newerLightweightSubmission = submission({
      id: "submitted-2",
      status: "submitted",
      statusLabel: "Submitted",
      academicYear: { id: "year-1", name: "2025-2026" },
      submittedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      indicators: [],
      items: [],
    });

    const result = resolveHydratedCurrentReportSubmissionCandidate(
      olderDetailedSubmission,
      newerLightweightSubmission,
      {
        selectedSchoolId: "",
        selectedAcademicYearId: "year-1",
      },
    );

    expect(result?.id).toBe("submitted-2");
    expect(result?.indicators ?? []).toHaveLength(0);
  });

  it("prefers the newly fetched hydrated detail when the same submission id ties on recency", () => {
    const preservedHydratedSubmission = submission({
      id: "submitted-2",
      status: "submitted",
      statusLabel: "Submitted",
      academicYear: { id: "year-1", name: "2025-2026" },
      submittedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      indicators: [
        {
          id: "item-old",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: 1515,
          varianceValue: null,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });
    const fetchedHydratedSubmission = submission({
      id: "submitted-2",
      status: "submitted",
      statusLabel: "Submitted",
      academicYear: { id: "year-1", name: "2025-2026" },
      submittedAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
      indicators: [
        {
          id: "item-new",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: 2024,
          varianceValue: null,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });

    const result = resolveHydratedCurrentReportSubmissionCandidate(
      preservedHydratedSubmission,
      fetchedHydratedSubmission,
      {
        selectedSchoolId: "",
        selectedAcademicYearId: "year-1",
      },
    );

    expect(result?.id).toBe("submitted-2");
    expect(result?.indicators?.[0]?.actualValue).toBe(2024);
  });
});

describe("buildSchoolAdminRefreshBatches", () => {
  it("eagerly includes the full School Head submission preload after the snapshot refresh", () => {
    const refreshRecords = async () => undefined;
    const refreshSubmissions = async () => undefined;
    const refreshAllSubmissions = async () => undefined;

    expect(
      buildSchoolAdminRefreshBatches(refreshRecords, refreshSubmissions, refreshAllSubmissions),
    ).toEqual([
      [refreshRecords, refreshSubmissions],
      [refreshAllSubmissions],
    ]);
  });
});

describe("buildSubmittedReportBlankStateLines", () => {
  it("keeps the selected-year no-finalized-package explanation explicit while preserving reference-table semantics", () => {
    expect(buildSubmittedReportBlankStateLines()).toEqual([
      "No finalized submitted report package exists yet for the selected academic year.",
      "The report tables are shown for reference. Finalized values will appear here after you submit the package.",
    ]);
  });
});

describe("buildSchoolHeadCurrentReportBlankStateLines", () => {
  it("explains that School Head report values appear after save or final submit", () => {
    expect(buildSchoolHeadCurrentReportBlankStateLines()).toEqual([
      "No saved School Head report package exists yet for the selected academic year.",
      "The report tables are shown for reference. Saved values will appear here after you save or final-submit the package.",
    ]);
  });
});

describe("formatComplianceStatusLabel", () => {
  it("maps backend compliance enums to production-facing KPI wording", () => {
    expect(formatComplianceStatusLabel("met")).toBe("Met");
    expect(formatComplianceStatusLabel("below_target")).toBe("Not met");
    expect(formatComplianceStatusLabel("recorded")).toBe("Recorded");
  });
});

describe("buildSubmittedReportSourceContext", () => {
  it("keeps the submitted report header explicitly scoped to the selected report year", () => {
    expect(
      buildSubmittedReportSourceContext(
        submission({
          id: "42",
          status: "submitted",
          statusLabel: "Submitted",
          submittedAt: "2026-05-17T00:00:00.000Z",
        }),
        "2025-2026",
      ),
    ).toEqual([
      "Viewing finalized submitted report for SY 2025-2026.",
      "Source package: #42 (Submitted).",
      `Submitted: ${new Date("2026-05-17T00:00:00.000Z").toLocaleDateString()}.`,
    ]);
  });

  it("shows explicit reference-only source context when no finalized package exists yet", () => {
    expect(buildSubmittedReportSourceContext(null, "2025-2026")).toEqual([
      "Viewing finalized submitted report for SY 2025-2026.",
      "Source package: None yet.",
      "Status: Reference only.",
    ]);
  });
});

describe("buildSchoolHeadCurrentReportSourceContext", () => {
  it("shows School Head workspace-preview context for draft packages using the saved timestamp", () => {
    expect(
      buildSchoolHeadCurrentReportSourceContext(
        submission({
          id: "draft-42",
          status: "draft",
          statusLabel: "Draft",
          updatedAt: "2026-05-17T00:00:00.000Z",
          submittedAt: null,
        }),
        "2025-2026",
      ),
    ).toEqual([
      "Viewing saved workspace preview for SY 2025-2026.",
      "Source package: #draft-42 (Draft).",
      `Saved: ${new Date("2026-05-17T00:00:00.000Z").toLocaleDateString()}.`,
    ]);
  });

  it("shows School Head report context for submitted packages using the submitted timestamp", () => {
    expect(
      buildSchoolHeadCurrentReportSourceContext(
        submission({
          id: "42",
          status: "submitted",
          statusLabel: "Submitted",
          updatedAt: "2026-05-17T00:00:00.000Z",
          submittedAt: "2026-05-18T00:00:00.000Z",
        }),
        "2025-2026",
      ),
    ).toEqual([
      "Viewing submitted School Head report for SY 2025-2026.",
      "Source package: #42 (Submitted).",
      `Submitted: ${new Date("2026-05-18T00:00:00.000Z").toLocaleDateString()}.`,
    ]);
  });
});

describe("resolveSchoolAdminHeaderContext", () => {
  it("uses the assigned school address instead of region-oriented fallback data", () => {
    const result = resolveSchoolAdminHeaderContext(
      {
        schoolName: "Private Academy",
        schoolCode: "900123",
        address: "Santiago City, Isabela",
      },
      {
        schoolName: "Different Name",
        schoolCode: "111111",
      } as never,
    );

    expect(result).toEqual({
      schoolName: "Private Academy",
      schoolCode: "900123",
      schoolAddress: "Santiago City, Isabela",
    });
  });

  it("does not fall back to unrelated address data when the assigned record has no address", () => {
    const result = resolveSchoolAdminHeaderContext(
      {
        schoolName: "Private Academy",
        schoolCode: "900123",
        address: null,
      } as never,
      {
        schoolName: "Private Academy",
        schoolCode: "900123",
      } as never,
    );

    expect(result.schoolAddress).toBe("N/A");
  });

  it("uses the authenticated assigned-school address as a safe fallback when records are not ready yet", () => {
    const result = resolveSchoolAdminHeaderContext(
      null,
      {
        schoolName: "Private Academy",
        schoolCode: "900123",
        schoolAddress: "Santiago City, Isabela",
      } as never,
    );

    expect(result.schoolAddress).toBe("Santiago City, Isabela");
  });
});

describe("resolveSubmittedReportSubmissionForView", () => {
  it("rejects a finalized submission when it belongs to a different school", () => {
    const result = resolveSubmittedReportSubmissionForView(
      submission({
        status: "submitted",
        statusLabel: "Submitted",
        schoolId: "school-2",
        school: { id: "school-2", schoolCode: "002", name: "Other School", type: "private" },
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );

    expect(result).toBeNull();
  });

  it("rejects a finalized submission when its strict school identity mismatches even if nested school data is absent", () => {
    const result = resolveSubmittedReportSubmissionForView(
      submission({
        status: "submitted",
        statusLabel: "Submitted",
        schoolId: "school-2",
        school: undefined,
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );

    expect(result).toBeNull();
  });

  it("rejects a finalized submission when it belongs to a different academic year", () => {
    const result = resolveSubmittedReportSubmissionForView(
      submission({
        status: "submitted",
        statusLabel: "Submitted",
        school: { id: "school-1", schoolCode: "001", name: "Test School", type: "private" },
        academicYear: { id: "year-2", name: "2026-2027" },
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );

    expect(result).toBeNull();
  });
});

describe("resolveSchoolHeadCurrentReportSubmissionForView", () => {
  it("accepts draft and returned submissions when they match the selected school and academic year", () => {
    const draftResult = resolveSchoolHeadCurrentReportSubmissionForView(
      submission({
        status: "draft",
        statusLabel: "Draft",
        schoolId: "school-1",
        school: { id: "school-1", schoolCode: "001", name: "Test School", type: "private" },
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );
    const returnedResult = resolveSchoolHeadCurrentReportSubmissionForView(
      submission({
        status: "returned",
        statusLabel: "Returned",
        schoolId: "school-1",
        school: { id: "school-1", schoolCode: "001", name: "Test School", type: "private" },
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );

    expect(draftResult?.status).toBe("draft");
    expect(returnedResult?.status).toBe("returned");
  });

  it("still rejects another school's draft submission", () => {
    const result = resolveSchoolHeadCurrentReportSubmissionForView(
      submission({
        status: "draft",
        statusLabel: "Draft",
        schoolId: "school-2",
        school: { id: "school-2", schoolCode: "002", name: "Other School", type: "private" },
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );

    expect(result).toBeNull();
  });
});

describe("resolveSelectedYearSchoolHeadCurrentReportSubmission", () => {
  it("prefers a fresher saved draft over an older submitted package for School Head preview", () => {
    const result = resolveSelectedYearSchoolHeadCurrentReportSubmission([
      submission({
        id: "submitted-1",
        status: "submitted",
        statusLabel: "Submitted",
        updatedAt: "2026-04-20T00:00:00.000Z",
        submittedAt: "2026-04-20T00:00:00.000Z",
      }),
      submission({
        id: "draft-1",
        status: "draft",
        statusLabel: "Draft",
        updatedAt: "2026-05-01T00:00:00.000Z",
        submittedAt: null,
      }),
    ]);

    expect(result?.id).toBe("draft-1");
  });
});

describe("resolveSchoolHeadReportSourceMode", () => {
  it("labels draft and returned packages as workspace previews", () => {
    expect(resolveSchoolHeadReportSourceMode(submission({ status: "draft" }))).toBe("workspace_preview");
    expect(resolveSchoolHeadReportSourceMode(submission({ status: "returned" }))).toBe("workspace_preview");
  });

  it("labels submitted and validated packages as submitted report sources", () => {
    expect(resolveSchoolHeadReportSourceMode(submission({ status: "submitted" }))).toBe("submitted");
    expect(resolveSchoolHeadReportSourceMode(submission({ status: "validated" }))).toBe("submitted");
  });
});

describe("resolveStableSubmittedReportViewSubmission", () => {
  it("keeps hydrated finalized detail when it belongs to the same selected-year finalized report source", () => {
    const selected = submission({
      id: "submission-1",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [],
      items: [],
      schoolId: "school-1",
    });
    const hydrated = submission({
      id: "submission-1",
      status: "submitted",
      statusLabel: "Submitted",
      schoolId: "school-1",
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "NER",
            code: "NER",
            name: "Net Enrollment Rate",
            category: "test",
            framework: "imeta",
            dataType: "number",
          },
          targetValue: 1,
          actualValue: 2,
          varianceValue: 1,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });

    const result = resolveStableSubmittedReportViewSubmission(selected, hydrated, {
      selectedSchoolId: "school-1",
      selectedAcademicYearId: "year-1",
    });

    expect(result).toBe(hydrated);
  });

  it("does not let an older hydrated finalized row override a newer selected-year finalized package", () => {
    const selected = submission({
      id: "submission-2",
      status: "submitted",
      statusLabel: "Submitted",
      schoolId: "school-1",
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const hydrated = submission({
      id: "submission-1",
      status: "submitted",
      statusLabel: "Submitted",
      schoolId: "school-1",
      submittedAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "NER",
            code: "NER",
            name: "Net Enrollment Rate",
            category: "test",
            framework: "imeta",
            dataType: "number",
          },
          targetValue: 1,
          actualValue: 2,
          varianceValue: 1,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });

    const result = resolveStableSubmittedReportViewSubmission(selected, hydrated, {
      selectedSchoolId: "school-1",
      selectedAcademicYearId: "year-1",
    });

    expect(result).toBe(selected);
  });
});

describe("resolveStableSchoolHeadCurrentReportViewSubmission", () => {
  it("keeps hydrated submitted detail when it belongs to the selected School Head report source", () => {
    const selected = submission({
      id: "submission-1",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [],
      items: [],
      schoolId: "school-1",
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const hydrated = submission({
      id: "submission-1",
      status: "submitted",
      statusLabel: "Submitted",
      schoolId: "school-1",
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "NER",
            code: "NER",
            name: "Net Enrollment Rate",
            category: "test",
            framework: "imeta",
            dataType: "number",
          },
          targetValue: 1,
          actualValue: 2,
          varianceValue: 1,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });

    const result = resolveStableSchoolHeadCurrentReportViewSubmission(selected, hydrated, {
      selectedSchoolId: "school-1",
      selectedAcademicYearId: "year-1",
    });

    expect(result).toBe(hydrated);
  });

  it("hydrates a draft into the School Head workspace preview", () => {
    const selected = submission({
      id: "submission-1",
      status: "draft",
      statusLabel: "Draft",
      indicators: [],
      items: [],
      schoolId: "school-1",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const hydrated = submission({
      id: "submission-1",
      status: "draft",
      statusLabel: "Draft",
      schoolId: "school-1",
      updatedAt: "2026-05-01T00:00:00.000Z",
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "NER",
            code: "NER",
            name: "Net Enrollment Rate",
            category: "test",
            framework: "imeta",
            dataType: "number",
          },
          targetValue: 1,
          actualValue: 2,
          varianceValue: 1,
          complianceStatus: "met",
          remarks: null,
        },
      ],
      items: [],
    });

    const result = resolveStableSchoolHeadCurrentReportViewSubmission(selected, hydrated, {
      selectedSchoolId: "school-1",
      selectedAcademicYearId: "year-1",
    });

    expect(result).toBe(hydrated);
  });
});

describe("resolveSubmittedReportIndicatorByMetricCode", () => {
  function indicator(metricCode: string, metricName: string): IndicatorSubmissionItem {
    return {
      id: `${metricCode}-${metricName}`,
      metric: {
        id: metricCode,
        code: metricCode,
        name: metricName,
        category: "test",
        framework: "imeta",
        dataType: "number",
      },
      targetValue: 1,
      actualValue: 2,
      varianceValue: 1,
      complianceStatus: "met",
      remarks: null,
    };
  }

  it("returns the exact metric-code match when it is unique", () => {
    const result = resolveSubmittedReportIndicatorByMetricCode(
      [indicator("NER", "Net Enrollment Rate"), indicator("RR", "Retention Rate")],
      "NER",
    );

    expect(result?.metric?.code).toBe("NER");
  });

  it("returns null when the same metric code appears more than once", () => {
    const result = resolveSubmittedReportIndicatorByMetricCode(
      [indicator("NER", "Net Enrollment Rate"), indicator("NER", "Duplicate NER")],
      "NER",
    );

    expect(result).toBeNull();
  });
});

describe("resolveCurrentReportIndicatorByGroupAKey", () => {
  function indicator(options: {
    id: string;
    metricCode: string;
    metricName: string;
    targetValue?: number | null;
    actualValue?: number | null;
    actualTypedValue?: Record<string, unknown> | null;
    targetTypedValue?: Record<string, unknown> | null;
  }): IndicatorSubmissionItem {
    return {
      id: options.id,
      metric: {
        id: options.metricCode,
        code: options.metricCode,
        name: options.metricName,
        category: "test",
        framework: "imeta",
        dataType: "number",
      },
      targetValue: options.targetValue ?? null,
      actualValue: options.actualValue ?? null,
      targetTypedValue: options.targetTypedValue ?? null,
      actualTypedValue: options.actualTypedValue ?? null,
      varianceValue: null,
      complianceStatus: "recorded",
      remarks: null,
    };
  }

  it("uses the exact metric-code match when it exists", () => {
    const result = resolveCurrentReportIndicatorByGroupAKey(
      [
        indicator({ id: "1", metricCode: "NER", metricName: "Net Enrollment Rate", actualValue: 92 }),
        indicator({ id: "2", metricCode: "RR", metricName: "Retention Rate", actualValue: 95 }),
      ],
      "kpi",
      "net_enrollment_rate",
    );

    expect(result?.id).toBe("1");
  });

  it("falls back to the scoped Group A metric name aliases when the code-only match is unavailable", () => {
    const result = resolveCurrentReportIndicatorByGroupAKey(
      [
        indicator({
          id: "name-match",
          metricCode: "CUSTOM_ROW",
          metricName: "Net Enrollment Rate (NER)",
          actualTypedValue: { values: { "2025-2026": 97 } },
        }),
      ],
      "kpi",
      "net_enrollment_rate",
    );

    expect(result?.id).toBe("name-match");
  });

  it("prefers the more complete row when duplicate code matches exist in the same hydrated submission", () => {
    const result = resolveCurrentReportIndicatorByGroupAKey(
      [
        indicator({ id: "empty", metricCode: "IMETA_ENROLL_TOTAL", metricName: "Total Number of Enrolment" }),
        indicator({
          id: "filled",
          metricCode: "IMETA_ENROLL_TOTAL",
          metricName: "Total Number of Enrolment",
          actualTypedValue: { values: { "2025-2026": 2024 } },
        }),
      ],
      "schoolAchievement",
      "total_enrolment",
    );

    expect(result?.id).toBe("filled");
  });
});
