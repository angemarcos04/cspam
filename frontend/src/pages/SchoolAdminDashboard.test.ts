import { describe, expect, it } from "vitest";
import {
  buildSchoolAdminRefreshBatches,
  buildDashboardViewYearStorageKey,
  formatComplianceStatusLabel,
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
  resolvePreferredSubmittedReportAcademicYearId,
  resolveSelectedYearReportSubmission,
  resolveSelectedYearSchoolHeadCurrentReportSubmission,
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
    const fresherHydratedDraft = submission({
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
      fresherHydratedDraft,
      staleSelectedRow,
      {
        selectedSchoolId: "",
        selectedAcademicYearId: "year-1",
      },
    );

    expect(result?.id).toBe("draft-2");
    expect(result?.indicators?.[0]?.actualValue).toBe(2024);
  });

  it("does not borrow indicator details across different submission ids", () => {
    const olderDetailedSubmission = submission({
      id: "draft-1",
      status: "draft",
      statusLabel: "Draft",
      academicYear: { id: "year-1", name: "2025-2026" },
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
      id: "draft-2",
      status: "draft",
      statusLabel: "Draft",
      academicYear: { id: "year-1", name: "2025-2026" },
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

    expect(result?.id).toBe("draft-2");
    expect(result?.indicators ?? []).toHaveLength(0);
  });

  it("prefers the newly fetched hydrated detail when the same submission id ties on recency", () => {
    const preservedHydratedSubmission = submission({
      id: "draft-2",
      status: "draft",
      statusLabel: "Draft",
      academicYear: { id: "year-1", name: "2025-2026" },
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
      id: "draft-2",
      status: "draft",
      statusLabel: "Draft",
      academicYear: { id: "year-1", name: "2025-2026" },
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

    expect(result?.id).toBe("draft-2");
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
  it("explains the School Head current report blank state without requiring a finalized package", () => {
    expect(buildSchoolHeadCurrentReportBlankStateLines()).toEqual([
      "No School Head report package exists yet for the selected academic year.",
      "The report tables are shown for reference. Current values will appear here after you start or update the package.",
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
  it("shows School Head current-report context for draft packages using the updated timestamp", () => {
    expect(
      buildSchoolHeadCurrentReportSourceContext(
        submission({
          id: "42",
          status: "draft",
          statusLabel: "Draft",
          updatedAt: "2026-05-17T00:00:00.000Z",
          submittedAt: null,
        }),
        "2025-2026",
      ),
    ).toEqual([
      "Viewing School Head report for SY 2025-2026.",
      "Source package: #42 (Draft).",
      `Updated: ${new Date("2026-05-17T00:00:00.000Z").toLocaleDateString()}.`,
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
  it("accepts a draft submission when it matches the selected school and academic year", () => {
    const result = resolveSchoolHeadCurrentReportSubmissionForView(
      submission({
        status: "draft",
        statusLabel: "Draft",
        schoolId: "school-1",
        school: { id: "school-1", schoolCode: "001", name: "Test School", type: "private" },
      }),
      { selectedSchoolId: "school-1", selectedAcademicYearId: "year-1" },
    );

    expect(result?.status).toBe("draft");
  });
});

describe("resolveSelectedYearSchoolHeadCurrentReportSubmission", () => {
  it("prefers the freshest same-year editable draft over an older finalized package", () => {
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
  it("keeps hydrated draft detail when it belongs to the freshest current School Head report source", () => {
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
