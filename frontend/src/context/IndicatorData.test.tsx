import { describe, expect, it } from "vitest";
import {
  buildIndicatorDataSessionKey,
  collectPaginatedSubmissionRows,
  filterSchoolHeadScopedSubmissions,
  isMonitorReviewIndicatorEvent,
  isSchoolHeadLocalEchoEvent,
  materializeSubmissionFromLightweightPayload,
  mergeSubmissionPreservingDetails,
  patchSubmissionWithLightweightPayload,
  resolveIndicatorRealtimeSyncPlan,
} from "@/context/IndicatorData";

describe("buildIndicatorDataSessionKey", () => {
  it("includes assigned school context for School Head users", () => {
    expect(buildIndicatorDataSessionKey({
      id: 25,
      role: "school_head",
      schoolId: 900123,
      schoolType: "private",
    } as never)).toBe("school_head:25:900123:private");
  });

  it("changes when the School Head school context changes", () => {
    const first = buildIndicatorDataSessionKey({
      id: 25,
      role: "school_head",
      schoolId: 900123,
      schoolType: "private",
    } as never);
    const second = buildIndicatorDataSessionKey({
      id: 25,
      role: "school_head",
      schoolId: 900124,
      schoolType: "public",
    } as never);

    expect(first).not.toBe(second);
  });

  it("keeps monitor session identity keyed only by role and user id", () => {
    expect(buildIndicatorDataSessionKey({
      id: 1,
      role: "monitor",
      schoolId: null,
      schoolType: null,
    } as never)).toBe("monitor:1");
  });
});

describe("materializeSubmissionFromLightweightPayload", () => {
  it("preserves lightweight file metadata for uploaded fm-qad files", () => {
    const submission = materializeSubmissionFromLightweightPayload({
      id: "sub-1",
      schoolId: "school-1",
      schoolType: "private",
      academicYearId: "ay-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-05-14T08:00:00.000Z",
      completion: {
        hasImetaFormData: true,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: [],
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-14T08:00:00.000Z",
          downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
          viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
        },
      },
      academicYear: {
        id: "ay-1",
        name: "2025-2026",
      },
    });

    const file = submission.files?.fm_qad_001;

    expect(submission.schoolId).toBe("school-1");
    expect(submission.schoolType).toBe("private");
    expect(submission.presentation?.activeWorkspaceFileTypes).toEqual(["fm_qad_001"]);
    expect(submission.presentation?.secondaryHistoricalFileTypes).toEqual([]);
    expect(file).toBeDefined();
    expect(file?.originalFilename).toBe("fm-qad-001.pdf");
    expect(file?.sizeBytes).toBe(2048);
    expect(file?.uploadedAt).toBe("2026-05-14T08:00:00.000Z");
    expect(file?.path).toBeNull();
  });
});

describe("mergeSubmissionPreservingDetails", () => {
  it("keeps hydrated indicator rows when a fresher lightweight-like submission row replaces list state", () => {
    const existing = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "school-1",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 1, metIndicators: 1, belowTargetIndicators: 0, complianceRatePercent: 100 },
      indicators: [
        {
          id: "item-1",
          metric: {
            id: "metric-1",
            code: "IMETA_HEAD_NAME",
            name: "NAME OF SCHOOL HEAD",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: null,
          varianceValue: null,
          targetTypedValue: null,
          actualTypedValue: { values: { "2025-2026": "Maria Santos" } },
          targetDisplay: "-",
          actualDisplay: "2025-2026: Maria Santos",
          complianceStatus: "recorded",
          remarks: null,
        },
      ],
    } as never;

    const incoming = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 2,
      schoolId: "school-1",
      notes: "Patched",
      reviewNotes: null,
      summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [],
    } as never;

    const merged = mergeSubmissionPreservingDetails(existing, incoming);

    expect(merged.version).toBe(2);
    expect(merged.notes).toBe("Patched");
    expect(merged.indicators).toHaveLength(1);
    expect(merged.indicators[0]?.metric?.code).toBe("IMETA_HEAD_NAME");
  });

  it("clears canonical and legacy School Achievement rows for full-shaped section reset responses", () => {
    const existing = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "school-1",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 3, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [
        {
          id: "legacy-salo",
          metric: {
            id: "legacy-salo",
            code: "SALO",
            name: "Legacy School Achievement",
            category: "legacy",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: null,
          varianceValue: null,
          targetTypedValue: null,
          actualTypedValue: { values: { "2025-2026": "Maria Santos" } },
          targetDisplay: "-",
          actualDisplay: "2025-2026: Maria Santos",
          complianceStatus: "recorded",
          remarks: null,
        },
        {
          id: "canonical-school-achievement",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "other",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: null,
          varianceValue: null,
          targetTypedValue: null,
          actualTypedValue: { values: { "2025-2026": 123 } },
          targetDisplay: "-",
          actualDisplay: "2025-2026: 123",
          complianceStatus: "recorded",
          remarks: null,
        },
        {
          id: "kpi-row",
          metric: {
            id: "metric-2",
            code: "NER",
            name: "Net Enrollment Rate",
            category: "key_performance_indicators",
            framework: "kpi",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: null,
          varianceValue: null,
          targetTypedValue: { values: { "2025-2026": 100 } },
          actualTypedValue: { values: { "2025-2026": 95 } },
          targetDisplay: "2025-2026: 100",
          actualDisplay: "2025-2026: 95",
          complianceStatus: "met",
          remarks: null,
        },
      ],
    } as never;

    const incoming = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 2,
      schoolId: "school-1",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [],
      items: [],
    } as never;

    const merged = mergeSubmissionPreservingDetails(existing, incoming, {
      resetWorkspace: "school_achievements_learning_outcomes",
    });

    expect(merged.version).toBe(2);
    expect(merged.indicators.map((row) => row.metric?.code)).toEqual(["NER"]);
    expect(merged.items?.map((row) => row.metric?.code)).toEqual(["NER"]);
  });

  it("clears stale file metadata for full-shaped file reset responses", () => {
    const existing = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "school-1",
      schoolType: "public",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [],
      files: {
        bmef: {
          type: "bmef",
          uploaded: true,
          path: "submissions/sub-1/bmef.pdf",
          originalFilename: "signed-bmef.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-05T01:00:00.000Z",
          downloadUrl: "/api/submissions/sub-1/download/bmef",
          viewUrl: "/api/submissions/sub-1/view/bmef",
        },
      },
    } as never;

    const incoming = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 2,
      schoolId: "school-1",
      schoolType: "public",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [],
      files: {
        bmef: {
          type: "bmef",
          uploaded: false,
          path: null,
          originalFilename: null,
          sizeBytes: null,
          uploadedAt: null,
          downloadUrl: null,
          viewUrl: null,
        },
      },
    } as never;

    const merged = mergeSubmissionPreservingDetails(existing, incoming, { resetWorkspace: "bmef" });

    expect(merged.files?.bmef?.uploaded).toBe(false);
    expect(merged.files?.bmef?.originalFilename).toBeNull();
    expect(merged.files?.bmef?.viewUrl).toBeNull();
  });
});

describe("patchSubmissionWithLightweightPayload", () => {
  it("refreshes workflow label and scope progress from lightweight mutation payloads while preserving hydrated indicator rows", () => {
    const current = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "school-1",
      schoolType: "private",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 1, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [
        {
          id: "item-1",
          metric: {
            id: "metric-1",
            code: "IMETA_HEAD_NAME",
            name: "NAME OF SCHOOL HEAD",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
          },
          targetValue: null,
          actualValue: null,
          varianceValue: null,
          targetTypedValue: null,
          actualTypedValue: { values: { "2025-2026": "Maria Santos" } },
          targetDisplay: "-",
          actualDisplay: "2025-2026: Maria Santos",
          complianceStatus: "recorded",
          remarks: null,
        },
      ],
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001"],
        uploadedFileTypes: [],
        missingFileTypes: ["fm_qad_001"],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
        submittedScopeIds: [],
        pendingScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
        submittedRequiredScopeCount: 0,
        totalRequiredScopeCount: 2,
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: false,
          path: null,
          originalFilename: null,
          sizeBytes: null,
          uploadedAt: null,
          downloadUrl: null,
          viewUrl: null,
        },
      },
      academicYear: { id: "ay-1", name: "2025-2026" },
      submittedAt: null,
      reviewedAt: null,
      updatedAt: null,
      createdAt: null,
    } as never;

    const patched = patchSubmissionWithLightweightPayload(current, {
      id: "sub-1",
      schoolId: "school-1",
      schoolType: "private",
      academicYearId: "ay-1",
      reportingPeriod: "ANNUAL",
      status: "submitted",
      version: 2,
      notes: "Lightweight patch",
      submittedAt: "2026-05-21T01:00:00.000Z",
      reviewedAt: null,
      updatedAt: "2026-05-21T01:00:00.000Z",
      completion: {
        hasImetaFormData: true,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: true,
        requiredFileTypes: ["fm_qad_001"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: [],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
        submittedScopeIds: ["fm_qad_001"],
        pendingScopeIds: ["school_achievements_learning_outcomes"],
        submittedRequiredScopeCount: 1,
        totalRequiredScopeCount: 2,
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-21T01:00:00.000Z",
          downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
          viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
        },
      },
      academicYear: {
        id: "ay-1",
        name: "2025-2026",
      },
    });

    expect(patched.status).toBe("submitted");
    expect(patched.statusLabel).toBe("Submitted");
    expect(patched.scopeProgress?.submittedScopeIds).toEqual(["fm_qad_001"]);
    expect(patched.files?.fm_qad_001?.uploaded).toBe(true);
    expect(patched.indicators).toHaveLength(1);
    expect(patched.indicators[0]?.metric?.code).toBe("IMETA_HEAD_NAME");
  });

  it("preserves hydrated file metadata when lightweight payloads only report uploaded state", () => {
    const current = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "school-1",
      schoolType: "public",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [],
      completion: {
        hasImetaFormData: false,
        hasBmefFile: true,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["bmef", "smea"],
        uploadedFileTypes: ["bmef"],
        missingFileTypes: ["smea"],
      },
      files: {
        bmef: {
          type: "bmef",
          uploaded: true,
          path: "submissions/sub-1/bmef.pdf",
          originalFilename: "signed-bmef.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-05T01:00:00.000Z",
          downloadUrl: "/api/submissions/sub-1/download/bmef",
          viewUrl: "/api/submissions/sub-1/view/bmef",
        },
      },
      submittedAt: null,
      reviewedAt: null,
      updatedAt: null,
      createdAt: null,
    } as never;

    const patched = patchSubmissionWithLightweightPayload(current, {
      id: "sub-1",
      schoolId: "school-1",
      schoolType: "public",
      academicYearId: "ay-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-06-05T02:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: true,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["bmef", "smea"],
        uploadedFileTypes: ["bmef"],
        missingFileTypes: ["smea"],
      },
      files: {
        bmef: {
          type: "bmef",
          uploaded: true,
          path: null,
          originalFilename: null,
          sizeBytes: null,
          uploadedAt: null,
          downloadUrl: null,
          viewUrl: null,
        },
      },
    });

    expect(patched.files?.bmef?.uploaded).toBe(true);
    expect(patched.files?.bmef?.originalFilename).toBe("signed-bmef.pdf");
    expect(patched.files?.bmef?.sizeBytes).toBe(4096);
    expect(patched.files?.bmef?.uploadedAt).toBe("2026-06-05T01:00:00.000Z");
    expect(patched.files?.bmef?.downloadUrl).toBe("/api/submissions/sub-1/download/bmef");
    expect(patched.files?.bmef?.viewUrl).toBe("/api/submissions/sub-1/view/bmef");
  });

  it("preserves unavailable file state without synthesizing preview URLs", () => {
    const current = {
      id: "sub-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "school-1",
      schoolType: "public",
      notes: null,
      reviewNotes: null,
      summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
      indicators: [],
      completion: {
        hasImetaFormData: false,
        hasBmefFile: true,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["bmef"],
        uploadedFileTypes: ["bmef"],
        missingFileTypes: [],
      },
      files: {
        bmef: {
          type: "bmef",
          uploaded: true,
          available: true,
          missingFromStorage: false,
          path: "submissions/sub-1/bmef.pdf",
          originalFilename: "signed-bmef.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-05T01:00:00.000Z",
          downloadUrl: "/api/submissions/sub-1/download/bmef",
          viewUrl: "/api/submissions/sub-1/view/bmef",
        },
      },
      submittedAt: null,
      reviewedAt: null,
      updatedAt: null,
      createdAt: null,
    } as never;

    const patched = patchSubmissionWithLightweightPayload(current, {
      id: "sub-1",
      schoolId: "school-1",
      schoolType: "public",
      academicYearId: "ay-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-06-05T02:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: true,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["bmef"],
        uploadedFileTypes: ["bmef"],
        missingFileTypes: [],
      },
      files: {
        bmef: {
          type: "bmef",
          uploaded: true,
          available: false,
          missingFromStorage: true,
          path: null,
          originalFilename: "signed-bmef.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-05T01:00:00.000Z",
          downloadUrl: null,
          viewUrl: null,
        },
      },
    });

    expect(patched.files?.bmef?.uploaded).toBe(true);
    expect(patched.files?.bmef?.available).toBe(false);
    expect(patched.files?.bmef?.missingFromStorage).toBe(true);
    expect(patched.files?.bmef?.originalFilename).toBe("signed-bmef.pdf");
    expect(patched.files?.bmef?.downloadUrl).toBeNull();
    expect(patched.files?.bmef?.viewUrl).toBeNull();
  });
});

describe("resolveIndicatorRealtimeSyncPlan", () => {
  it("hydrates the exact submission when an indicator realtime payload names a submission id", () => {
    expect(resolveIndicatorRealtimeSyncPlan({
      entity: "indicators",
      submissionId: "sub-1",
      academicYearId: "ay-1",
    })).toBe("hydrate");
  });

  it("falls back to broad sync only when an indicator payload lacks a target submission id", () => {
    expect(resolveIndicatorRealtimeSyncPlan({
      entity: "indicators",
      academicYearId: "ay-1",
    })).toBe("sync");
  });

  it("ignores suppressed local echoes and non-indicator realtime payloads", () => {
    expect(resolveIndicatorRealtimeSyncPlan({
      entity: "indicators",
      submissionId: "sub-1",
    }, true)).toBe("ignore");
    expect(resolveIndicatorRealtimeSyncPlan({
      entity: "students",
      submissionId: "sub-1",
    })).toBe("ignore");
  });
});

describe("indicator realtime event classification", () => {
  it.each([
    "indicators.validated",
    "indicators.returned",
    "indicators.scope_verified",
    "indicators.scope_unverified",
    "indicators.scope_returned",
  ])("classifies %s as a monitor review event", (eventType) => {
    const payload = { entity: "indicators", eventType };

    expect(isMonitorReviewIndicatorEvent(payload)).toBe(true);
    expect(isSchoolHeadLocalEchoEvent(payload)).toBe(false);
  });

  it.each([
    "indicators.generated",
    "indicators.bootstrapped",
    "indicators.updated",
    "indicators.file_uploaded",
    "indicators.workspace_reset",
    "indicators.submitted",
    "indicators.scopes_submitted",
  ])("classifies %s as a School Head local echo event", (eventType) => {
    const payload = { entity: "indicators", eventType };

    expect(isSchoolHeadLocalEchoEvent(payload)).toBe(true);
    expect(isMonitorReviewIndicatorEvent(payload)).toBe(false);
  });
});

describe("filterSchoolHeadScopedSubmissions", () => {
  it("keeps only the assigned-school submissions for School Head sessions", () => {
    const rows = filterSchoolHeadScopedSubmissions([
      {
        id: "sub-1",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "school-1",
        notes: null,
        reviewNotes: null,
        summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
        indicators: [],
      },
      {
        id: "sub-2",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "school-2",
        notes: null,
        reviewNotes: null,
        summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
        indicators: [],
      },
    ] as never, {
      role: "school_head",
      schoolId: "school-1",
    } as never);

    expect(rows.map((row) => row.id)).toEqual(["sub-1"]);
  });

  it("does not filter monitor submission rows", () => {
    const rows = filterSchoolHeadScopedSubmissions([
      {
        id: "sub-1",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "school-1",
        notes: null,
        reviewNotes: null,
        summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
        indicators: [],
      },
      {
        id: "sub-2",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "school-2",
        notes: null,
        reviewNotes: null,
        summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
        indicators: [],
      },
    ] as never, {
      role: "monitor",
      schoolId: null,
    } as never);

    expect(rows.map((row) => row.id)).toEqual(["sub-1", "sub-2"]);
  });
});

describe("collectPaginatedSubmissionRows", () => {
  it("loads all same-scope pages instead of stopping after page one", async () => {
    const rows = await collectPaginatedSubmissionRows(async (page) => ({
      data: [
        {
          id: `sub-${page}`,
          formType: "indicator",
          status: "draft",
          statusLabel: "Draft",
          reportingPeriod: "ANNUAL",
          version: 1,
          schoolId: "school-1",
          notes: null,
          reviewNotes: null,
          summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
          indicators: [],
        },
      ] as never,
      meta: {
        currentPage: page,
        lastPage: 3,
        perPage: 100,
        total: 3,
        hasMorePages: page < 3,
      },
    }));

    expect(rows.map((row) => row.id)).toEqual(["sub-1", "sub-2", "sub-3"]);
  });
});
