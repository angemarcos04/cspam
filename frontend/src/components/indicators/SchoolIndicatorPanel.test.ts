import { describe, expect, it } from "vitest";
import {
  buildWorkspaceProgressSummary,
  buildResetEntryForMetric,
  buildReportFileSubmissionByType,
  resolveUnifiedSendActionMode,
  resolveWorkspaceResetBehavior,
  buildStrictSubmittedByType,
  buildWorkspaceAutosavePayloadOptions,
  buildWorkspaceFileSubmissionByType,
  resolveBatchSubmitScopeIds,
  resolveEditableWorkspaceSubmission,
  resolveFinalPackageStatusLabel,
  resolveMetricFromIndicatorInWorkspace,
  resolveOptimisticSubmittedByTypeState,
  getSubmissionFreshnessScore,
  resolvePreferredWorkspaceSubmission,
  resolveEffectiveWorkspaceSubmission,
  resolveWorkspaceMetricCompletion,
  shouldRestorePersistedWorkspaceDraft,
  shouldReplaceInScopeWorkspaceSubmission,
  workspaceDraftGuidanceCopy,
  workspaceFileDraftStatusLabel,
} from "@/components/indicators/SchoolIndicatorPanel";
import { SUBMISSION_FILE_TYPES } from "@/constants/submissionFiles";
import { buildSubmissionUploadedFileFingerprint } from "@/utils/submissionRequirements";
import type { IndicatorMetric, IndicatorSubmission, IndicatorSubmissionFileType, IndicatorSubmissionItem } from "@/types";

function buildSubmittedByTypeState(
  trueTypes: IndicatorSubmissionFileType[] = [],
): Record<IndicatorSubmissionFileType, boolean> {
  const trueTypeSet = new Set(trueTypes);

  return SUBMISSION_FILE_TYPES.reduce<Record<IndicatorSubmissionFileType, boolean>>((state, type) => {
    state[type] = trueTypeSet.has(type);
    return state;
  }, {} as Record<IndicatorSubmissionFileType, boolean>);
}

describe("buildWorkspaceAutosavePayloadOptions", () => {
  it("keeps routine autosave incremental instead of promoting it to a full workspace replace", () => {
    expect(buildWorkspaceAutosavePayloadOptions()).toEqual({
      allowIncomplete: true,
      includeAllEntries: false,
    });
  });
});

describe("resolveOptimisticSubmittedByTypeState", () => {
  it("keeps optimistic true file readiness when same-submission server state is stale false", () => {
    const result = resolveOptimisticSubmittedByTypeState({
      submissionChanged: false,
      current: buildSubmittedByTypeState(["fm_qad_001"]),
      server: buildSubmittedByTypeState(),
    });

    expect(result.fm_qad_001).toBe(true);
  });

  it("accepts same-submission server true file readiness when current optimistic state is false", () => {
    const result = resolveOptimisticSubmittedByTypeState({
      submissionChanged: false,
      current: buildSubmittedByTypeState(),
      server: buildSubmittedByTypeState(["fm_qad_001"]),
    });

    expect(result.fm_qad_001).toBe(true);
  });

  it("keeps a same-submission file false when neither optimistic nor server state has it ready", () => {
    const result = resolveOptimisticSubmittedByTypeState({
      submissionChanged: false,
      current: buildSubmittedByTypeState(),
      server: buildSubmittedByTypeState(),
    });

    expect(result.fm_qad_001).toBe(false);
  });

  it("resets to the exact server state when the active submission changes", () => {
    const server = buildSubmittedByTypeState(["bmef"]);
    const result = resolveOptimisticSubmittedByTypeState({
      submissionChanged: true,
      current: buildSubmittedByTypeState(["fm_qad_001"]),
      server,
    });

    expect(result).toBe(server);
    expect(result.bmef).toBe(true);
    expect(result.fm_qad_001).toBe(false);
  });

  it("preserves explicit file reset state when the same-submission server state is also false", () => {
    const result = resolveOptimisticSubmittedByTypeState({
      submissionChanged: false,
      current: {
        ...buildSubmittedByTypeState(["bmef"]),
        fm_qad_001: false,
      },
      server: buildSubmittedByTypeState(),
    });

    expect(result.bmef).toBe(true);
    expect(result.fm_qad_001).toBe(false);
  });
});

describe("resolveFinalPackageStatusLabel", () => {
  it("labels known final package statuses without changing workflow meaning", () => {
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "draft", status: "draft" })).toBe("Draft");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "draft", status: "returned" })).toBe("Returned");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "submitted_locked", status: "submitted" })).toBe("Submitted to Monitor");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "submitted_locked", status: "validated" })).toBe("Validated");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "read_only_year", status: "draft" })).toBe("Read-only");
  });

  it("treats empty status as draft but does not mislabel unknown future statuses", () => {
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "draft", status: null })).toBe("Draft");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "draft", status: undefined })).toBe("Draft");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "draft", status: "" })).toBe("Draft");
    expect(resolveFinalPackageStatusLabel({ workspaceMode: "draft", status: "under_review" })).toBe("Unknown");
  });
});

describe("buildResetEntryForMetric", () => {
  it("clears reset numeric cells back to blank instead of synthetic zeroes", () => {
    const metric = buildMetric({
      dataType: "number",
      inputSchema: {},
    });

    expect(
      buildResetEntryForMetric(metric, [], {
        targetValue: "12",
        actualValue: "34",
        targetText: "",
        actualText: "",
        targetBoolean: "",
        actualBoolean: "",
        targetEnum: "",
        actualEnum: "",
        targetMatrix: {},
        actualMatrix: {},
        remarks: "note",
      }),
    ).toMatchObject({
      targetValue: "",
      actualValue: "",
      remarks: "",
    });
  });

  it("clears reset yearly-matrix cells back to blank so missing-state and completion recalculate correctly", () => {
    const metric = buildMetric({
      dataType: "yearly_matrix",
      inputSchema: {
        valueType: "integer",
        years: ["2025-2026", "2026-2027"],
      },
    });

    const entry = buildResetEntryForMetric(metric, ["2025-2026"], {
      targetValue: "",
      actualValue: "",
      targetText: "",
      actualText: "",
      targetBoolean: "",
      actualBoolean: "",
      targetEnum: "",
      actualEnum: "",
      targetMatrix: {
        "2025-2026": "585",
        "2026-2027": "900",
      },
      actualMatrix: {
        "2025-2026": "585",
        "2026-2027": "900",
      },
      remarks: "note",
    });

    expect(entry.targetMatrix["2025-2026"]).toBe("");
    expect(entry.actualMatrix["2025-2026"]).toBe("");
    expect(entry.targetMatrix["2026-2027"]).toBe("900");
    expect(entry.actualMatrix["2026-2027"]).toBe("900");
    expect(entry.remarks).toBe("");
  });
});

describe("shouldRestorePersistedWorkspaceDraft", () => {
  it("ignores legacy note-only autosave payloads after optional note removal", () => {
    expect(
      shouldRestorePersistedWorkspaceDraft({
        metricEntries: {},
        ...({ notes: "Legacy note-only draft" } as Record<string, unknown>),
      } as never),
    ).toBe(false);
  });
});

describe("workspace draft guidance", () => {
  it("keeps file-part status language distinct from final package submission", () => {
    expect(workspaceFileDraftStatusLabel(true)).toBe("Uploaded");
    expect(workspaceFileDraftStatusLabel(false)).toBe("No file uploaded yet");
  });

  it("explains that sections and files can be persisted before final submit", () => {
    expect(workspaceDraftGuidanceCopy()).toContain("Save sections");
    expect(workspaceDraftGuidanceCopy()).toContain("upload files");
    expect(workspaceDraftGuidanceCopy()).toContain("Use Send");
    expect(workspaceDraftGuidanceCopy()).toContain("Final Submit Package");
  });
});

describe("buildWorkspaceProgressSummary", () => {
  it("combines completed indicator sections and uploaded required files into one truthful workspace summary", () => {
    const summary = buildWorkspaceProgressSummary({
      categoryProgressById: new Map([
        ["school_achievements_learning_outcomes", { total: 43, complete: 43 }],
        ["key_performance_indicators", { total: 19, complete: 12 }],
      ]),
      categoryIds: [
        "school_achievements_learning_outcomes",
        "key_performance_indicators",
      ],
      fileTypes: ["fm_qad_001", "fm_qad_002"],
      uploadedFileTypes: {
        bmef: false,
        smea: false,
        fm_qad_001: true,
        fm_qad_002: false,
        fm_qad_003: false,
        fm_qad_004: false,
        fm_qad_008: false,
        fm_qad_009: false,
        fm_qad_010: false,
        fm_qad_011: false,
        fm_qad_034: false,
        fm_qad_041: false,
      },
      submittedScopeIds: ["school_achievements_learning_outcomes"],
    });

    expect(summary.totalScopeCount).toBe(4);
    expect(summary.readyScopeCount).toBe(2);
    expect(summary.incompleteScopeCount).toBe(2);
    expect(summary.submittedScopeCount).toBe(1);
    expect(summary.readyScopeIds).toEqual([
      "school_achievements_learning_outcomes",
      "fm_qad_001",
    ]);
    expect(summary.readyUnsubmittedScopeIds).toEqual(["fm_qad_001"]);
  });

  it("removes submitted ready scopes from the batch-selectable list so stale selections cannot remain eligible", () => {
    const summary = buildWorkspaceProgressSummary({
      categoryProgressById: new Map([
        ["school_achievements_learning_outcomes", { total: 43, complete: 43 }],
      ]),
      categoryIds: ["school_achievements_learning_outcomes"],
      fileTypes: ["fm_qad_001"],
      uploadedFileTypes: {
        bmef: false,
        smea: false,
        fm_qad_001: true,
        fm_qad_002: false,
        fm_qad_003: false,
        fm_qad_004: false,
        fm_qad_008: false,
        fm_qad_009: false,
        fm_qad_010: false,
        fm_qad_011: false,
        fm_qad_034: false,
        fm_qad_041: false,
      },
      submittedScopeIds: [
        "school_achievements_learning_outcomes",
        "fm_qad_001",
      ],
    });

    expect(summary.readyScopeIds).toEqual([
      "school_achievements_learning_outcomes",
      "fm_qad_001",
    ]);
    expect(summary.readyUnsubmittedScopeIds).toEqual([]);
  });

  it("deduplicates visible scopes and ignores unknown submitted scopes so progress cannot exceed 100%", () => {
    const summary = buildWorkspaceProgressSummary({
      categoryProgressById: new Map([
        ["school_achievements_learning_outcomes", { total: 43, complete: 43 }],
      ]),
      categoryIds: [
        "school_achievements_learning_outcomes",
        "school_achievements_learning_outcomes",
      ],
      fileTypes: ["fm_qad_001", "fm_qad_001"],
      uploadedFileTypes: {
        bmef: false,
        smea: false,
        fm_qad_001: true,
        fm_qad_002: false,
        fm_qad_003: false,
        fm_qad_004: false,
        fm_qad_008: false,
        fm_qad_009: false,
        fm_qad_010: false,
        fm_qad_011: false,
        fm_qad_034: false,
        fm_qad_041: false,
      },
      submittedScopeIds: [
        "school_achievements_learning_outcomes",
        "school_achievements_learning_outcomes",
        "unknown_scope",
      ],
    });

    expect(summary.totalScopeCount).toBe(2);
    expect(summary.readyScopeCount).toBe(2);
    expect(summary.submittedScopeCount).toBe(1);
    expect(summary.incompleteScopeCount).toBe(0);
    expect(summary.readyPercent).toBe(100);
    expect(summary.readyScopeIds).toEqual([
      "school_achievements_learning_outcomes",
      "fm_qad_001",
    ]);
    expect(summary.submittedScopeIds).toEqual(["school_achievements_learning_outcomes"]);
    expect(summary.readyUnsubmittedScopeIds).toEqual(["fm_qad_001"]);
  });
});

describe("resolveWorkspaceMetricCompletion", () => {
  it("does not mark a metric complete when the workspace year has not resolved", () => {
    const metric = buildMetric({
      dataType: "yearly_matrix",
      inputSchema: {
        years: ["2025-2026"],
      },
    });

    expect(
      resolveWorkspaceMetricCompletion({
        metric,
        entry: {
          targetMatrix: { "2025-2026": "10" },
          actualMatrix: { "2025-2026": "10" },
        },
        workspaceSchoolYears: [],
        requiredSchoolYearSet: new Set<string>(),
      }),
    ).toBe(false);
  });

  it("marks a metric complete only when required resolved-year values exist", () => {
    const metric = buildMetric({
      dataType: "yearly_matrix",
      inputSchema: {
        years: ["2025-2026"],
      },
    });

    expect(
      resolveWorkspaceMetricCompletion({
        metric,
        entry: {
          targetMatrix: { "2025-2026": "" },
          actualMatrix: { "2025-2026": "" },
        },
        workspaceSchoolYears: ["2025-2026"],
        requiredSchoolYearSet: new Set(["2025-2026"]),
      }),
    ).toBe(false);

    expect(
      resolveWorkspaceMetricCompletion({
        metric,
        entry: {
          targetMatrix: { "2025-2026": "10" },
          actualMatrix: { "2025-2026": "" },
        },
        workspaceSchoolYears: ["2025-2026"],
        requiredSchoolYearSet: new Set(["2025-2026"]),
      }),
    ).toBe(true);
  });
});

describe("resolveBatchSubmitScopeIds", () => {
  it("submits only currently selectable scopes and removes duplicates while preserving selection order", () => {
    expect(
      resolveBatchSubmitScopeIds(
        ["fm_qad_001", "school_achievements_learning_outcomes", "fm_qad_001", "fm_qad_999"],
        ["school_achievements_learning_outcomes", "fm_qad_001"],
      ),
    ).toEqual([
      "fm_qad_001",
      "school_achievements_learning_outcomes",
    ]);
  });
});

describe("resolveUnifiedSendActionMode", () => {
  it("routes Send to selected scopes when a batch selection exists", () => {
    expect(resolveUnifiedSendActionMode(["fm_qad_001"])).toBe("batch");
  });

  it("routes Send to the active scope when no batch selection exists", () => {
    expect(resolveUnifiedSendActionMode([])).toBe("active");
  });
});

describe("resolveWorkspaceResetBehavior", () => {
  it("keeps draft and returned submissions on the existing remote destructive reset path", () => {
    expect(resolveWorkspaceResetBehavior("draft", "draft", true)).toBe("remote_destructive");
    expect(resolveWorkspaceResetBehavior("draft", "returned", true)).toBe("remote_destructive");
  });

  it("restores submitted-editing workspaces from saved submission state instead of blanking them", () => {
    expect(resolveWorkspaceResetBehavior("submitted_editing", "submitted", true)).toBe("restore_saved");
    expect(resolveWorkspaceResetBehavior("submitted_editing", "validated", true)).toBe("restore_saved");
  });

  it("falls back to local blank reset only when there is no in-scope saved submission to restore", () => {
    expect(resolveWorkspaceResetBehavior("blank", null, false)).toBe("local_blank");
    expect(resolveWorkspaceResetBehavior("submitted_editing", "submitted", false)).toBe("local_blank");
  });
});

function buildSubmission(overrides: Partial<IndicatorSubmission>): IndicatorSubmission {
  return {
    id: "submission-1",
    formType: "indicator",
    status: "draft",
    statusLabel: "Draft",
    reportingPeriod: "ANNUAL",
    version: 1,
    notes: null,
    reviewNotes: null,
    submittedAt: null,
    reviewedAt: null,
    createdAt: null,
    updatedAt: null,
    summary: {
      totalIndicators: 0,
      metIndicators: 0,
      belowTargetIndicators: 0,
      complianceRatePercent: 0,
    },
    indicators: [],
    ...overrides,
  };
}

function buildMetric(overrides: Partial<IndicatorMetric>): IndicatorMetric {
  return {
    id: "metric-1",
    code: "FM_QAD_TEST",
    name: "FM QAD Test",
    category: "school_achievements_learning_outcomes",
    framework: "imeta",
    dataType: "number",
    ...overrides,
  };
}

function buildIndicatorItem(overrides: Partial<IndicatorSubmissionItem>): IndicatorSubmissionItem {
  return {
    id: "item-1",
    targetValue: null,
    actualValue: null,
    varianceValue: null,
    complianceStatus: "met",
    remarks: null,
    ...overrides,
  };
}

describe("private workspace file lineage hardening", () => {
  it("does not infer report file submissions from a finalized package without that specific uploaded file", () => {
    const finalizedSubmission = buildSubmission({
      status: "submitted",
      files: {
        fm_qad_002: {
          type: "fm_qad_002",
          uploaded: true,
          path: "/tmp/fm-qad-002.pdf",
          originalFilename: "fm-qad-002.pdf",
          sizeBytes: 100,
          uploadedAt: "2026-01-01T00:00:00Z",
          downloadUrl: "/download/fm_qad_002",
          viewUrl: "/view/fm_qad_002",
        },
      },
    });

    const byType = buildReportFileSubmissionByType([finalizedSubmission]);

    expect(byType.fm_qad_001).toBeNull();
    expect(byType.fm_qad_002?.id).toBe("submission-1");
  });

  it("keeps active workspace file state tied to the editable submission only", () => {
    const editableSubmission = buildSubmission({
      files: {
        fm_qad_002: {
          type: "fm_qad_002",
          uploaded: true,
          path: "/tmp/fm-qad-002.pdf",
          originalFilename: "fm-qad-002.pdf",
          sizeBytes: 100,
          uploadedAt: "2026-01-01T00:00:00Z",
          downloadUrl: "/download/fm_qad_002",
          viewUrl: "/view/fm_qad_002",
        },
      },
    });

    const byType = buildWorkspaceFileSubmissionByType(editableSubmission);
    const submittedByType = buildStrictSubmittedByType(byType);

    expect(byType.fm_qad_001).toBeNull();
    expect(submittedByType.fm_qad_001).toBe(false);
    expect(byType.fm_qad_002?.id).toBe("submission-1");
    expect(submittedByType.fm_qad_002).toBe(true);
  });

  it("includes private FM-QAD upload-state changes in the shared workspace fingerprint helper", () => {
    const withoutUpload = buildSubmission({
      files: {},
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
      },
    });
    const withUpload = buildSubmission({
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: "/tmp/fm-qad-001.pdf",
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 100,
          uploadedAt: "2026-01-01T00:00:00Z",
          downloadUrl: "/download/fm_qad_001",
          viewUrl: "/view/fm_qad_001",
        },
      },
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
      },
    });

    expect(buildSubmissionUploadedFileFingerprint(withoutUpload)).not.toBe(
      buildSubmissionUploadedFileFingerprint(withUpload),
    );
  });
});

describe("workspace submission precedence", () => {
  it("prefers the freshest editable draft or returned submission over newer finalized rows", () => {
    const returned = buildSubmission({
      id: "returned-1",
      status: "returned",
      updatedAt: "2026-05-17T08:00:00Z",
    });
    const submitted = buildSubmission({
      id: "submitted-1",
      status: "submitted",
      updatedAt: "2026-05-17T09:00:00Z",
    });

    expect(resolveEditableWorkspaceSubmission([submitted, returned], null)?.id).toBe("returned-1");
    expect(resolvePreferredWorkspaceSubmission([submitted, returned], null)?.id).toBe("returned-1");
  });

  it("prefers the freshest finalized row instead of a stale finalized editing submission id", () => {
    const submitted = buildSubmission({
      id: "submitted-1",
      status: "submitted",
      updatedAt: "2026-05-17T09:00:00Z",
    });
    const validated = buildSubmission({
      id: "validated-1",
      status: "validated",
      updatedAt: "2026-05-17T08:00:00Z",
    });

    expect(resolvePreferredWorkspaceSubmission([submitted, validated], "validated-1")?.id).toBe("submitted-1");
  });

  it("replaces a stale finalized in-scope row when a fresher finalized row becomes preferred", () => {
    const current = buildSubmission({
      id: "submitted-older",
      status: "submitted",
      updatedAt: "2026-05-17T08:00:00Z",
    });
    const preferred = buildSubmission({
      id: "submitted-newer",
      status: "submitted",
      updatedAt: "2026-05-17T09:00:00Z",
    });

    expect(shouldReplaceInScopeWorkspaceSubmission(current, preferred)).toBe(true);
    expect(shouldReplaceInScopeWorkspaceSubmission(preferred, current)).toBe(false);
  });

  it("keeps a fresh mutation override instead of reverting to a stale selected-year row", () => {
    const saved = buildSubmission({
      id: "submission-1",
      version: 4,
      status: "returned",
      schoolId: "school-1",
      academicYear: { id: "ay-1", name: "2025-2026" },
      updatedAt: "2026-05-17T10:00:00Z",
    });
    const staleListRow = buildSubmission({
      id: "submission-1",
      version: 3,
      status: "draft",
      schoolId: "school-1",
      academicYear: { id: "ay-1", name: "2025-2026" },
      updatedAt: "2026-05-17T09:00:00Z",
    });

    const resolved = resolveEffectiveWorkspaceSubmission({
      activeSubmission: staleListRow,
      mutationOverride: {
        submissionId: saved.id,
        academicYearId: "ay-1",
        schoolId: "school-1",
        submission: saved,
        version: saved.version,
        updatedAt: saved.updatedAt,
        status: saved.status,
        appliedAt: Date.now(),
      },
      scopedSubmissions: [staleListRow],
      editingSubmissionId: saved.id,
      academicYearId: "ay-1",
      schoolId: "school-1",
    });

    expect(resolved?.status).toBe("returned");
    expect(resolved?.version).toBe(4);
  });

  it("lets a server row clear the override when it confirms the same or newer version", () => {
    const overrideSubmission = buildSubmission({
      id: "submission-1",
      version: 4,
      schoolId: "school-1",
      academicYear: { id: "ay-1", name: "2025-2026" },
      updatedAt: "2026-05-17T10:00:00Z",
    });
    const confirmedRow = buildSubmission({
      id: "submission-1",
      version: 5,
      schoolId: "school-1",
      academicYear: { id: "ay-1", name: "2025-2026" },
      updatedAt: "2026-05-17T10:01:00Z",
    });

    const resolved = resolveEffectiveWorkspaceSubmission({
      activeSubmission: overrideSubmission,
      mutationOverride: {
        submissionId: overrideSubmission.id,
        academicYearId: "ay-1",
        schoolId: "school-1",
        submission: overrideSubmission,
        version: overrideSubmission.version,
        updatedAt: overrideSubmission.updatedAt,
        status: overrideSubmission.status,
        appliedAt: Date.now(),
      },
      scopedSubmissions: [confirmedRow],
      editingSubmissionId: overrideSubmission.id,
      academicYearId: "ay-1",
      schoolId: "school-1",
    });

    expect(resolved?.version).toBe(5);
  });

  it("uses updatedAt freshness when versions are not useful", () => {
    const older = buildSubmission({
      id: "older",
      version: 0,
      schoolId: "school-1",
      academicYear: { id: "ay-1", name: "2025-2026" },
      updatedAt: "2026-05-17T09:00:00Z",
    });
    const newer = buildSubmission({
      id: "newer",
      version: 0,
      schoolId: "school-1",
      academicYear: { id: "ay-1", name: "2025-2026" },
      updatedAt: "2026-05-17T10:00:00Z",
    });

    expect(getSubmissionFreshnessScore(newer)).toBeGreaterThan(getSubmissionFreshnessScore(older));
    expect(resolvePreferredWorkspaceSubmission([older, newer], null)?.id).toBe("newer");
  });

  it("ignores active workspace data from a different academic year", () => {
    const previousYear = buildSubmission({
      id: "previous-year",
      status: "returned",
      schoolId: "school-1",
      academicYear: { id: "ay-previous", name: "2024-2025" },
      updatedAt: "2026-05-17T10:00:00Z",
    });
    const selectedYear = buildSubmission({
      id: "selected-year",
      status: "draft",
      schoolId: "school-1",
      academicYear: { id: "ay-selected", name: "2025-2026" },
      updatedAt: "2026-05-17T09:00:00Z",
    });

    expect(resolveEffectiveWorkspaceSubmission({
      activeSubmission: previousYear,
      mutationOverride: null,
      scopedSubmissions: [selectedYear],
      editingSubmissionId: null,
      academicYearId: "ay-selected",
      schoolId: "school-1",
    })?.id).toBe("selected-year");
  });
});

describe("resolveMetricFromIndicatorInWorkspace", () => {
  it("does not use loose metric-name fallback in workspace hydration", () => {
    const metric = buildMetric({
      id: "metric-1",
      code: "IMETA_ENROLL_TOTAL",
      name: "TOTAL NUMBER OF ENROLMENT",
    });
    const metricsById = new Map<string, IndicatorMetric>([[metric.id, metric]]);
    const metricsByCode = new Map<string, IndicatorMetric>([[metric.code, metric]]);
    const metricsByName = new Map<string, IndicatorMetric>([[metric.name.toLowerCase(), metric]]);
    const indicator = buildIndicatorItem({
      metric: undefined,
      ...({ metric_name: "TOTAL NUMBER OF ENROLMENT" } as Partial<IndicatorSubmissionItem>),
    });

    expect(resolveMetricFromIndicatorInWorkspace(indicator, metricsById, metricsByCode, metricsByName)).toBeNull();
  });
});
