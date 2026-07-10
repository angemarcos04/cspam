import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACADEMIC_YEAR_UNSAVED_SWITCH_CONFIRM_MESSAGE,
  SchoolIndicatorPanel,
} from "@/components/indicators/SchoolIndicatorPanel";
import { SUBMISSION_FILE_TYPES } from "@/constants/submissionFiles";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";

const useAuthMock = vi.fn();
const useIndicatorDataMock = vi.fn();
const privateWorkspaceScopeIds = [
  "school_achievements_learning_outcomes",
  "key_performance_indicators",
  ...SUBMISSION_FILE_TYPES.filter((type) => type !== "bmef" && type !== "smea"),
];

function buildSchoolAchievementMetric(schoolYear = "2025-2026") {
  return {
    id: "metric-1",
    code: "IMETA_ENROLL_TOTAL",
    name: "TOTAL NUMBER OF ENROLMENT",
    category: "school_achievements_learning_outcomes",
    framework: "imeta",
    dataType: "yearly_matrix",
    inputSchema: {
      valueType: "integer",
      years: [schoolYear],
    },
    sortOrder: 1,
  };
}

vi.mock("@/context/Auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/context/IndicatorData", () => ({
  useIndicatorData: () => useIndicatorDataMock(),
}));

function buildHydratedSubmission(submissionId = "submission-1") {
  return {
    id: submissionId,
    formType: "indicator",
    status: "draft",
    statusLabel: "Draft",
    reportingPeriod: "ANNUAL",
    version: 1,
    schoolId: "1",
    schoolType: "private",
    notes: null,
    reviewNotes: null,
    createdAt: "2026-05-19T08:00:00.000Z",
    updatedAt: "2026-05-19T09:00:00.000Z",
    submittedAt: null,
    reviewedAt: null,
    summary: {
      totalIndicators: 0,
      metIndicators: 0,
      belowTargetIndicators: 0,
      complianceRatePercent: 0,
    },
    indicators: [],
    files: {},
    completion: {
      hasImetaFormData: false,
      hasBmefFile: false,
      hasSmeaFile: false,
      isComplete: false,
      requiredFileTypes: [],
      uploadedFileTypes: [],
      missingFileTypes: [],
    },
    scopeProgress: {
      requiredScopeIds: [],
      submittedScopeIds: [],
      pendingScopeIds: [],
      submittedRequiredScopeCount: 0,
      totalRequiredScopeCount: 0,
    },
    academicYear: {
      id: "year-1",
      name: "2025-2026",
    },
  };
}

function buildSchoolAchievementDraftSubmission(
  submissionId = "draft-package",
  academicYear = { id: "year-1", name: "2025-2026" },
) {
  const metric = buildSchoolAchievementMetric(academicYear.name);

  return {
    ...buildHydratedSubmission(submissionId),
    academicYear,
    indicators: [
      {
        id: "indicator-1",
        metric,
        targetValue: null,
        actualValue: 1515,
        varianceValue: null,
        targetTypedValue: { values: {} },
        actualTypedValue: {
          values: {
            [academicYear.name]: 1515,
          },
        },
        complianceStatus: "recorded",
        remarks: null,
      },
    ],
    completion: {
      hasImetaFormData: true,
      hasBmefFile: false,
      hasSmeaFile: false,
      isComplete: false,
      requiredFileTypes: ["school_achievements_learning_outcomes"],
      uploadedFileTypes: [],
      missingFileTypes: [],
    },
    scopeProgress: {
      requiredScopeIds: ["school_achievements_learning_outcomes"],
      submittedScopeIds: [],
      pendingScopeIds: ["school_achievements_learning_outcomes"],
      submittedRequiredScopeCount: 0,
      totalRequiredScopeCount: 1,
    },
  };
}

interface FileWorkspaceSubmissionOptions {
  submissionId?: string;
  uploadedFileTypes?: string[];
  readyScopeIds?: string[];
  submittedScopeIds?: string[];
  scopeReviews?: Array<Record<string, unknown>>;
}

function buildFileWorkspaceSubmission(options: FileWorkspaceSubmissionOptions = {}) {
  const submissionId = options.submissionId ?? "submission-1";
  const uploadedFileTypes = options.uploadedFileTypes ?? ["fm_qad_001"];
  const readyScopeIds = options.readyScopeIds ?? uploadedFileTypes;
  const submittedScopeIds = options.submittedScopeIds ?? [];
  const scopeReviews = options.scopeReviews ?? [];

  const files = uploadedFileTypes.reduce<Record<string, Record<string, unknown>>>((current, type) => {
    current[type] = {
      type,
      uploaded: true,
      path: null,
      originalFilename: `${type.replace(/_/g, "-")}.pdf`,
      sizeBytes: 2048,
      uploadedAt: "2026-05-19T09:00:00.000Z",
      downloadUrl: `/api/submissions/${submissionId}/download/${type}`,
      viewUrl: `/api/submissions/${submissionId}/view/${type}`,
    };
    return current;
  }, {});

  return {
    ...buildHydratedSubmission(submissionId),
    updatedAt: "2026-05-19T10:00:00.000Z",
    files,
    completion: {
      hasImetaFormData: false,
      hasBmefFile: false,
      hasSmeaFile: false,
      isComplete: false,
      requiredFileTypes: uploadedFileTypes,
      uploadedFileTypes,
      missingFileTypes: [],
    },
    scopeProgress: {
      requiredScopeIds: [...uploadedFileTypes],
      submittedScopeIds,
      pendingScopeIds: readyScopeIds.filter((scopeId) => !submittedScopeIds.includes(scopeId)),
      submittedRequiredScopeCount: submittedScopeIds.length,
      totalRequiredScopeCount: uploadedFileTypes.length,
    },
    scopeReviews,
  };
}

function mockIndicatorPanelData(submissions: Array<Record<string, unknown>>, overrides: Record<string, unknown> = {}) {
  useIndicatorDataMock.mockReturnValue({
    submissions,
    allSubmissions: submissions,
    metrics: [],
    academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
    isLoading: false,
    isAllSubmissionsLoading: false,
    isSaving: false,
    error: null,
    refreshSubmissions: vi.fn().mockResolvedValue(undefined),
    loadSubmissionsForYear: vi.fn().mockResolvedValue(submissions),
    bootstrapSubmission: vi.fn(),
    createSubmission: vi.fn(),
    updateSubmission: vi.fn(),
    fetchSubmission: vi.fn().mockResolvedValue(submissions[0] ?? buildHydratedSubmission()),
    resetSubmissionWorkspace: vi.fn(),
    uploadSubmissionFile: vi.fn(),
    downloadSubmissionFile: vi.fn(),
    submitSubmission: vi.fn(),
    submitSubmissionScopes: vi.fn(),
    loadHistory: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useAuthMock.mockReturnValue({
    apiToken: "token",
    user: {
      id: 25,
      role: "school_head",
      schoolId: 1,
      schoolCode: "401777",
      schoolName: "AMA CC - Santiago City",
      schoolType: "private",
    },
  });
  useIndicatorDataMock.mockReturnValue({
    submissions: [],
    allSubmissions: [],
    metrics: [],
    academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
    isLoading: false,
    isAllSubmissionsLoading: false,
    isSaving: false,
    error: null,
    refreshSubmissions: vi.fn().mockResolvedValue(undefined),
    loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
    bootstrapSubmission: vi.fn(),
    createSubmission: vi.fn(),
    updateSubmission: vi.fn(),
    fetchSubmission: vi.fn().mockImplementation(async (submissionId = "submission-1") =>
      buildHydratedSubmission(String(submissionId)),
    ),
    resetSubmissionWorkspace: vi.fn(),
    uploadSubmissionFile: vi.fn(),
    downloadSubmissionFile: vi.fn(),
    submitSubmission: vi.fn(),
    submitSubmissionScopes: vi.fn(),
    loadHistory: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SchoolIndicatorPanel optional note removal", () => {
  it("does not render the removed optional note controls in the School Head workspace", async () => {
    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Academic Year")).not.toBeNull();
    });

    expect(screen.queryByText("Optional note")).toBeNull();
    expect(screen.queryByPlaceholderText("Add optional note")).toBeNull();
    expect(screen.queryByText("+ Add optional note")).toBeNull();
  });

  it("labels the top progress area as readiness instead of submitted progress", async () => {
    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findAllByText(/Workspace Readiness:/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("progressbar", { name: "Workspace Readiness progress" })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Indicators:/)).toBeNull();
    expect(screen.queryByText(/Ready items:/)).toBeNull();
    expect(screen.queryByText(/Sent to Monitor:/)).toBeNull();
    expect(screen.queryByText(/Incomplete:/)).toBeNull();
    expect(screen.queryByText(/Final Package:/)).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Sent to Monitor progress" })).toBeNull();
  });

  it("hides returned final package status text from the progress area", async () => {
    mockIndicatorPanelData([
      {
        ...buildHydratedSubmission("returned-package"),
        status: "returned",
        statusLabel: "Returned",
      },
    ]);

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findAllByText(/Workspace Readiness:/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Final Package:/)).toBeNull();
  });

  it("uses package submission progress for submitted packages without showing secondary status text", async () => {
    mockIndicatorPanelData([
      {
        ...buildHydratedSubmission("submitted-package"),
        status: "submitted",
        statusLabel: "Submitted",
        submittedAt: "2026-05-19T10:00:00.000Z",
        scopeProgress: {
          requiredScopeIds: privateWorkspaceScopeIds,
          submittedScopeIds: privateWorkspaceScopeIds,
          pendingScopeIds: [],
          submittedRequiredScopeCount: privateWorkspaceScopeIds.length,
          totalRequiredScopeCount: privateWorkspaceScopeIds.length,
        },
      },
    ], {
      metrics: [buildSchoolAchievementMetric()],
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findByLabelText("Academic Year") as HTMLSelectElement).disabled).toBe(false);
    expect((await screen.findAllByText(/Package Submission: 12\/12 items sent/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("progressbar", { name: "Package Submission progress" })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Indicators:/)).toBeNull();
    expect(screen.queryByText(/Ready items:/)).toBeNull();
    expect(screen.queryByText(/Sent to Monitor:/)).toBeNull();
    expect(screen.queryByText(/Incomplete:/)).toBeNull();
    expect(screen.queryByText(/Final Package:/)).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Sent to Monitor progress" })).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Workspace Readiness progress" })).toBeNull();
  });

  it("returns to workspace readiness progress while editing a submitted package", async () => {
    mockIndicatorPanelData([
      {
        ...buildHydratedSubmission("submitted-edit-package"),
        status: "submitted",
        statusLabel: "Submitted",
        submittedAt: "2026-05-19T10:00:00.000Z",
        scopeProgress: {
          requiredScopeIds: privateWorkspaceScopeIds,
          submittedScopeIds: privateWorkspaceScopeIds,
          pendingScopeIds: [],
          submittedRequiredScopeCount: privateWorkspaceScopeIds.length,
          totalRequiredScopeCount: privateWorkspaceScopeIds.length,
        },
      },
    ]);

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findAllByText(/Package Submission: 12\/12 items sent/)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Edit Submitted Report" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes" }));

    expect((await screen.findAllByText(/Workspace Readiness:/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("progressbar", { name: "Workspace Readiness progress" })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Package Submission:/)).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Package Submission progress" })).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Sent to Monitor progress" })).toBeNull();
  });

  it("uses package submission progress for validated packages without showing final package text", async () => {
    mockIndicatorPanelData([
      {
        ...buildHydratedSubmission("validated-package"),
        status: "validated",
        statusLabel: "Validated",
        submittedAt: "2026-05-19T10:00:00.000Z",
        scopeProgress: {
          requiredScopeIds: privateWorkspaceScopeIds,
          submittedScopeIds: privateWorkspaceScopeIds,
          pendingScopeIds: [],
          submittedRequiredScopeCount: privateWorkspaceScopeIds.length,
          totalRequiredScopeCount: privateWorkspaceScopeIds.length,
        },
      },
    ], {
      metrics: [buildSchoolAchievementMetric()],
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findByLabelText("Academic Year") as HTMLSelectElement).disabled).toBe(false);
    expect((await screen.findAllByText(/Package Submission: 12\/12 items sent/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Final Package:/)).toBeNull();
  });

  it("keeps Academic Year enabled when the active category is verified", async () => {
    mockIndicatorPanelData([
      {
        ...buildHydratedSubmission("verified-category-package"),
        scopeReviews: [{
          scopeId: "school_achievements_learning_outcomes",
          decision: "verified",
          reviewedAt: "2026-05-19T10:00:00.000Z",
        }],
      },
    ], {
      metrics: [buildSchoolAchievementMetric()],
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect(await screen.findByText(/Verified by Monitor:/)).not.toBeNull();
    expect((screen.getByLabelText("Academic Year") as HTMLSelectElement).disabled).toBe(false);
  });

  it("keeps Academic Year blocked while a manual save is in progress", async () => {
    mockIndicatorPanelData([], {
      isSaving: true,
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findByLabelText("Academic Year") as HTMLSelectElement).disabled).toBe(true);
  });

  it("allows switching academic year while viewing a submitted package", async () => {
    const onAcademicYearChange = vi.fn();
    mockIndicatorPanelData([
      {
        ...buildHydratedSubmission("submitted-package"),
        status: "submitted",
        statusLabel: "Submitted",
        submittedAt: "2026-05-19T10:00:00.000Z",
        scopeProgress: {
          requiredScopeIds: privateWorkspaceScopeIds,
          submittedScopeIds: privateWorkspaceScopeIds,
          pendingScopeIds: [],
          submittedRequiredScopeCount: privateWorkspaceScopeIds.length,
          totalRequiredScopeCount: privateWorkspaceScopeIds.length,
        },
      },
    ], {
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
        { id: "year-2", name: "2026-2027", isCurrent: false },
      ],
      metrics: [buildSchoolAchievementMetric()],
    });

    render(
      <SchoolIndicatorPanel
        initialAcademicYearId="year-1"
        onAcademicYearChange={onAcademicYearChange}
      />,
    );

    const yearSelect = await screen.findByLabelText("Academic Year") as HTMLSelectElement;
    expect(yearSelect.disabled).toBe(false);
    await waitFor(() => {
      expect(yearSelect.value).toBe("year-1");
    });

    fireEvent.change(yearSelect, { target: { value: "year-2" } });

    await waitFor(() => {
      expect(onAcademicYearChange).toHaveBeenCalledWith("year-2");
    });
  });

  it("switches clean draft academic year without prompting", async () => {
    const onAcademicYearChange = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockIndicatorPanelData([], {
      academicYears: [
        { id: "year-2", name: "2026-2027", isCurrent: true },
        { id: "year-3", name: "2027-2028", isCurrent: false },
      ],
      metrics: [buildSchoolAchievementMetric("2026-2027")],
    });

    render(
      <SchoolIndicatorPanel
        initialAcademicYearId="year-2"
        onAcademicYearChange={onAcademicYearChange}
      />,
    );

    const yearSelect = await screen.findByLabelText("Academic Year") as HTMLSelectElement;
    expect(yearSelect.disabled).toBe(false);
    await waitFor(() => {
      expect(yearSelect.value).toBe("year-2");
    });

    fireEvent.change(yearSelect, { target: { value: "year-3" } });

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onAcademicYearChange).toHaveBeenCalledWith("year-3");
    });
  });

  it("blocks academic year switch when dirty workspace confirmation is cancelled", async () => {
    const onAcademicYearChange = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mockIndicatorPanelData([buildSchoolAchievementDraftSubmission("draft-package", { id: "year-2", name: "2026-2027" })], {
      academicYears: [
        { id: "year-2", name: "2026-2027", isCurrent: true },
        { id: "year-3", name: "2027-2028", isCurrent: false },
      ],
      metrics: [buildSchoolAchievementMetric("2026-2027")],
    });

    const view = render(
      <SchoolIndicatorPanel
        initialAcademicYearId="year-2"
        onAcademicYearChange={onAcademicYearChange}
      />,
    );

    await waitFor(() => {
      expect((screen.getByLabelText("Academic Year") as HTMLSelectElement).value).toBe("year-2");
    });
    const [valueInput] = await within(view.container).findAllByRole("spinbutton");
    if (!valueInput) {
      throw new Error("Expected a School Achievements value input.");
    }
    fireEvent.change(valueInput, { target: { value: "123" } });
    await waitFor(() => {
      expect((valueInput as HTMLInputElement).value).toBe("123");
    });

    const yearSelect = screen.getByLabelText("Academic Year") as HTMLSelectElement;
    expect(yearSelect.disabled).toBe(false);
    await waitFor(() => {
      expect(yearSelect.value).toBe("year-2");
    });

    fireEvent.change(yearSelect, { target: { value: "year-3" } });

    expect(confirmSpy).toHaveBeenCalledWith(ACADEMIC_YEAR_UNSAVED_SWITCH_CONFIRM_MESSAGE);
    expect(onAcademicYearChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Academic Year") as HTMLSelectElement).value).toBe("year-2");
  });

  it("allows academic year switch when dirty workspace confirmation is accepted", async () => {
    const onAcademicYearChange = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockIndicatorPanelData([buildSchoolAchievementDraftSubmission("draft-package", { id: "year-2", name: "2026-2027" })], {
      academicYears: [
        { id: "year-2", name: "2026-2027", isCurrent: true },
        { id: "year-3", name: "2027-2028", isCurrent: false },
      ],
      metrics: [buildSchoolAchievementMetric("2026-2027")],
    });

    const view = render(
      <SchoolIndicatorPanel
        initialAcademicYearId="year-2"
        onAcademicYearChange={onAcademicYearChange}
      />,
    );

    await waitFor(() => {
      expect((screen.getByLabelText("Academic Year") as HTMLSelectElement).value).toBe("year-2");
    });
    const [valueInput] = await within(view.container).findAllByRole("spinbutton");
    if (!valueInput) {
      throw new Error("Expected a School Achievements value input.");
    }
    fireEvent.change(valueInput, { target: { value: "123" } });
    await waitFor(() => {
      expect((valueInput as HTMLInputElement).value).toBe("123");
    });

    const yearSelect = screen.getByLabelText("Academic Year") as HTMLSelectElement;
    await waitFor(() => {
      expect(yearSelect.value).toBe("year-2");
    });
    fireEvent.change(yearSelect, { target: { value: "year-3" } });

    expect(confirmSpy).toHaveBeenCalledWith(ACADEMIC_YEAR_UNSAVED_SWITCH_CONFIRM_MESSAGE);
    await waitFor(() => {
      expect(onAcademicYearChange).toHaveBeenCalledWith("year-3");
    });
  });

  it("follows the academic year selected by the parent dashboard", async () => {
    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [],
      metrics: [],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
        { id: "year-2", name: "2026-2027", isCurrent: false },
      ],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission: vi.fn().mockImplementation(async (submissionId = "submission-1") =>
        buildHydratedSubmission(String(submissionId)),
      ),
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" selectedAcademicYearId="year-2" />);

    await waitFor(() => {
      expect((screen.getByLabelText("Academic Year") as HTMLSelectElement).value).toBe("year-2");
    });
  });

});

describe("SchoolIndicatorPanel batch submit", () => {
  it("lets School Head users select ready scopes and submit them in one batch", async () => {
    const submitSubmissionScopes = vi.fn().mockResolvedValue({
      id: "submission-1",
      schoolId: "1",
      schoolType: "private",
      academicYearId: "year-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-05-19T10:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: ["fm_qad_002"],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
        submittedScopeIds: ["fm_qad_001"],
        pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_002"],
        submittedRequiredScopeCount: 1,
        totalRequiredScopeCount: 4,
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-19T09:00:00.000Z",
          downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
          viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
        },
      },
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    });
    const fetchSubmission = vi.fn().mockResolvedValue({
      id: "submission-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 2,
      schoolId: "1",
      schoolType: "private",
      notes: null,
      reviewNotes: null,
      createdAt: "2026-05-19T08:00:00.000Z",
      updatedAt: "2026-05-19T10:00:00.000Z",
      submittedAt: null,
      reviewedAt: null,
      summary: {
        totalIndicators: 0,
        metIndicators: 0,
        belowTargetIndicators: 0,
        complianceRatePercent: 0,
      },
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
            inputSchema: {
              valueType: "integer",
              years: ["2025-2026"],
            },
          },
          targetValue: null,
          actualValue: 1515,
          varianceValue: null,
          actualTypedValue: {
            values: {
              "2025-2026": 1515,
            },
          },
          complianceStatus: "recorded",
          remarks: null,
        },
      ],
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-19T09:00:00.000Z",
          downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
          viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
        },
      },
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: ["fm_qad_002"],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
        submittedScopeIds: ["fm_qad_001"],
        pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_002"],
        submittedRequiredScopeCount: 1,
        totalRequiredScopeCount: 4,
      },
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    });

    useAuthMock.mockReturnValue({
      apiToken: "token",
      user: {
        id: 25,
        role: "school_head",
        schoolId: 1,
        schoolCode: "401777",
        schoolName: "AMA CC - Santiago City",
        schoolType: "private",
      },
    });
    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        id: "submission-1",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "1",
        schoolType: "private",
        notes: null,
        reviewNotes: null,
        createdAt: "2026-05-19T08:00:00.000Z",
        updatedAt: "2026-05-19T09:00:00.000Z",
        submittedAt: null,
        reviewedAt: null,
        summary: {
          totalIndicators: 0,
          metIndicators: 0,
          belowTargetIndicators: 0,
          complianceRatePercent: 0,
        },
        indicators: [
          {
            id: "indicator-1",
            metric: {
              id: "metric-1",
              code: "IMETA_ENROLL_TOTAL",
              name: "TOTAL NUMBER OF ENROLMENT",
              category: "school_achievements_learning_outcomes",
              framework: "imeta",
              dataType: "yearly_matrix",
              inputSchema: {
                valueType: "integer",
                years: ["2025-2026"],
              },
            },
            targetValue: null,
            actualValue: 1515,
            varianceValue: null,
            actualTypedValue: {
              values: {
                "2025-2026": 1515,
              },
            },
            complianceStatus: "recorded",
            remarks: null,
          },
        ],
        files: {
          fm_qad_001: {
            type: "fm_qad_001",
            uploaded: true,
            path: null,
            originalFilename: "fm-qad-001.pdf",
            sizeBytes: 2048,
            uploadedAt: "2026-05-19T09:00:00.000Z",
            downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
            viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
          },
        },
        completion: {
          hasImetaFormData: false,
          hasBmefFile: false,
          hasSmeaFile: false,
          isComplete: false,
          requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
          uploadedFileTypes: ["fm_qad_001"],
          missingFileTypes: ["fm_qad_002"],
        },
        scopeProgress: {
          requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
          submittedScopeIds: [],
          pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
          submittedRequiredScopeCount: 0,
          totalRequiredScopeCount: 4,
        },
        academicYear: {
          id: "year-1",
          name: "2025-2026",
        },
      }],
      allSubmissions: [],
      metrics: [{
        id: "metric-1",
        code: "IMETA_ENROLL_TOTAL",
        name: "TOTAL NUMBER OF ENROLMENT",
        category: "school_achievements_learning_outcomes",
        framework: "imeta",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "integer",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission,
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes,
      loadHistory: vi.fn(),
    });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    const selectAllButton = (await within(view.container).findAllByRole("button", { name: "Select all" }))[0];
    fireEvent.click(selectAllButton);

    const sendButtons = await within(view.container).findAllByRole("button", { name: "Send" });
    const sendButton = sendButtons.find((button) => button.getAttribute("title") === "Send the selected ready workspace items.");
    expect(sendButton).toBeDefined();
    if (!sendButton) {
      throw new Error("Expected the unified Send button for selected scopes.");
    }
    expect(sendButton.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Only ready, not-yet-submitted items appear here. Final Submit still sends the complete package.")).toBeNull();
    expect(screen.queryByText("Ready items can be submitted individually or in a batch. Final Submit still requires the complete package.")).toBeNull();

    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(submitSubmissionScopes).toHaveBeenCalledWith("submission-1", ["fm_qad_001"]);
    });
  });

  it("sends a saved file scope even when unrelated indicator fields are dirty", async () => {
    const submitSubmissionScopes = vi.fn().mockResolvedValue({
      ...buildHydratedSubmission("submission-1"),
      updatedAt: "2026-05-19T10:00:00.000Z",
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-19T09:00:00.000Z",
          downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
          viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
        },
      },
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["school_achievements_learning_outcomes", "fm_qad_001"],
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
    });
    const hydratedSubmission = {
      ...buildHydratedSubmission("submission-1"),
      updatedAt: "2026-05-19T10:00:00.000Z",
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
            inputSchema: {
              valueType: "integer",
              years: ["2025-2026"],
            },
          },
          targetValue: null,
          actualValue: 1515,
          varianceValue: null,
          actualTypedValue: {
            values: {
              "2025-2026": 1515,
            },
          },
          complianceStatus: "recorded",
          remarks: null,
        },
      ],
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-19T09:00:00.000Z",
          downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
          viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
        },
      },
      completion: {
        hasImetaFormData: true,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["school_achievements_learning_outcomes", "fm_qad_001"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: [],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
        submittedScopeIds: [],
        pendingScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
        submittedRequiredScopeCount: 0,
        totalRequiredScopeCount: 2,
      },
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    };
    const fetchSubmission = vi.fn().mockResolvedValue(hydratedSubmission);

    useIndicatorDataMock.mockReturnValue({
      submissions: [hydratedSubmission],
      allSubmissions: [],
      metrics: [{
        id: "metric-1",
        code: "IMETA_ENROLL_TOTAL",
        name: "TOTAL NUMBER OF ENROLMENT",
        category: "school_achievements_learning_outcomes",
        framework: "imeta",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "integer",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission,
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes,
      loadHistory: vi.fn(),
    });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    const [valueInput] = await within(view.container).findAllByRole("spinbutton");
    expect(valueInput).toBeDefined();
    if (!valueInput) {
      throw new Error("Expected a School Achievements value input.");
    }
    fireEvent.change(valueInput, { target: { value: "2024" } });
    const fileTabs = await within(view.container).findAllByRole("button", { name: /FM-QAD-001/i });
    const fileTab = fileTabs.find((button) => button.getAttribute("data-category-id") === "fm_qad_001");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-001 workspace tab.");
    }
    fireEvent.click(fileTab);

    const sendButtons = await within(view.container).findAllByRole("button", { name: "Send" });
    const sendButton = sendButtons.find((button) => button.getAttribute("title") === "Send the current ready workspace item.");
    expect(sendButton).toBeDefined();
    if (!sendButton) {
      throw new Error("Expected the unified Send button for the active file scope.");
    }
    expect(sendButton.hasAttribute("disabled")).toBe(false);
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(submitSubmissionScopes).toHaveBeenCalledWith("submission-1", ["fm_qad_001"]);
    });
    expect(screen.queryByText("Save your indicator changes before sending a file scope.")).toBeNull();
  }, 10_000);

  it("shows the simplified Save and Send action labels in the School Head action bar", async () => {
    useAuthMock.mockReturnValue({
      apiToken: "token",
      user: {
        id: 25,
        role: "school_head",
        schoolId: 1,
        schoolCode: "401777",
        schoolName: "AMA CC - Santiago City",
        schoolType: "private",
      },
    });
    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        id: "submission-1",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "1",
        schoolType: "private",
        notes: null,
        reviewNotes: null,
        createdAt: "2026-05-19T08:00:00.000Z",
        updatedAt: "2026-05-19T09:00:00.000Z",
        submittedAt: null,
        reviewedAt: null,
        summary: {
          totalIndicators: 0,
          metIndicators: 0,
          belowTargetIndicators: 0,
          complianceRatePercent: 0,
        },
        indicators: [],
        files: {
          fm_qad_001: {
            type: "fm_qad_001",
            uploaded: true,
            path: null,
            originalFilename: "fm-qad-001.pdf",
            sizeBytes: 2048,
            uploadedAt: "2026-05-19T09:00:00.000Z",
            downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
            viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
          },
        },
        completion: {
          hasImetaFormData: false,
          hasBmefFile: false,
          hasSmeaFile: false,
          isComplete: false,
          requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
          uploadedFileTypes: ["fm_qad_001"],
          missingFileTypes: ["fm_qad_002"],
        },
        scopeProgress: {
          requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
          submittedScopeIds: [],
          pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
          submittedRequiredScopeCount: 0,
          totalRequiredScopeCount: 4,
        },
        academicYear: {
          id: "year-1",
          name: "2025-2026",
        },
      }],
      allSubmissions: [],
      metrics: [{
        id: "metric-1",
        code: "IMETA_ENROLL_TOTAL",
        name: "TOTAL NUMBER OF ENROLMENT",
        category: "school_achievements_learning_outcomes",
        framework: "imeta",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "integer",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission: vi.fn().mockImplementation(async (submissionId = "submission-1") =>
        buildHydratedSubmission(String(submissionId)),
      ),
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findAllByRole("button", { name: "Save" })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: "Send" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Send Selected" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send This Item" })).toBeNull();
  }, 10_000);

  it("locks the School Head action toolbar when the active scope is verified", async () => {
    const verifiedSubmission = {
      id: "submission-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 1,
      schoolId: "1",
      schoolType: "private",
      notes: null,
      reviewNotes: null,
      createdAt: "2026-05-19T08:00:00.000Z",
      updatedAt: "2026-05-19T09:00:00.000Z",
      submittedAt: null,
      reviewedAt: null,
      summary: {
        totalIndicators: 0,
        metIndicators: 0,
        belowTargetIndicators: 0,
        complianceRatePercent: 0,
      },
      indicators: [],
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-19T09:00:00.000Z",
          downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
          viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
        },
      },
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: [],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes"],
        submittedScopeIds: ["school_achievements_learning_outcomes"],
        pendingScopeIds: [],
        submittedRequiredScopeCount: 1,
        totalRequiredScopeCount: 1,
      },
      scopeReviews: [{
        id: "review-1",
        scopeId: "school_achievements_learning_outcomes",
        scopeType: "section",
        decision: "verified",
        notes: null,
        reviewedBy: { id: "monitor-1", name: "Monitor", email: "monitor@example.test" },
        reviewedAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }],
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    };
    useIndicatorDataMock.mockReturnValue({
      submissions: [verifiedSubmission],
      allSubmissions: [verifiedSubmission],
      metrics: [],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([verifiedSubmission]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission: vi.fn().mockResolvedValue(verifiedSubmission),
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect((await screen.findAllByText("Locked after monitor verification.")).length).toBeGreaterThan(0);
    expect(screen.getByText("This package contains verified files or indicators. Ask the Monitor to unverify them before final submission.")).not.toBeNull();

    const resetButton = screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    const finalSubmitButton = screen.getByRole("button", { name: "Final Submit Package" }) as HTMLButtonElement;

    expect(resetButton.disabled).toBe(true);
    expect(saveButton.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
    expect(finalSubmitButton.disabled).toBe(true);
  }, 10_000);

  it("locks upload replacement and toolbar actions when the active file scope is verified", async () => {
    const verifiedFileSubmission = buildFileWorkspaceSubmission({
      submittedScopeIds: ["fm_qad_001"],
      scopeReviews: [{
        id: "review-1",
        scopeId: "fm_qad_001",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedBy: { id: "monitor-1", name: "Monitor", email: "monitor@example.test" },
        reviewedAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }],
    });
    mockIndicatorPanelData([verifiedFileSubmission]);

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);
    const fileTab = (await within(view.container).findAllByRole("button", { name: /FM-QAD-001/i }))
      .find((button) => button.getAttribute("data-category-id") === "fm_qad_001");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-001 workspace tab.");
    }
    fireEvent.click(fileTab);

    expect((await screen.findAllByText("Locked after monitor verification.")).length).toBeGreaterThan(0);
    const viewFileButton = await screen.findByRole("button", { name: /View FM-QAD-001.*File/i }) as HTMLButtonElement;
    const downloadButton = await screen.findByRole("button", { name: /Download FM-QAD-001.*report/i }) as HTMLButtonElement;
    expect(viewFileButton.disabled).toBe(false);
    expect(downloadButton.disabled).toBe(false);

    const resetButton = screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    const saveButton = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    const finalSubmitButton = screen.getByRole("button", { name: "Final Submit Package" }) as HTMLButtonElement;

    expect(resetButton.disabled).toBe(true);
    expect(saveButton.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
    expect(finalSubmitButton.disabled).toBe(true);
  }, 10_000);

  it("shows missing-storage state for uploaded files without preview access", async () => {
    const missingFileSubmission = buildFileWorkspaceSubmission();
    missingFileSubmission.files.fm_qad_001 = {
      ...missingFileSubmission.files.fm_qad_001,
      available: false,
      missingFromStorage: true,
      originalFilename: "fm-qad-001.pdf",
      downloadUrl: null,
      viewUrl: null,
    };
    mockIndicatorPanelData([missingFileSubmission]);

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);
    const fileTab = (await within(view.container).findAllByRole("button", { name: /FM-QAD-001/i }))
      .find((button) => button.getAttribute("data-category-id") === "fm_qad_001");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-001 workspace tab.");
    }
    fireEvent.click(fileTab);

    expect(await screen.findByText("The saved file is missing from storage. Re-upload the file before sending or submitting this requirement.")).toBeTruthy();
    expect(screen.getByText(/fm-qad-001\.pdf/)).toBeTruthy();

    const viewFileButton = await screen.findByRole("button", { name: /View FM-QAD-001.*File/i }) as HTMLButtonElement;
    const downloadButton = await screen.findByRole("button", { name: /Download FM-QAD-001.*report/i }) as HTMLButtonElement;
    expect(viewFileButton.disabled).toBe(true);
    expect(downloadButton.disabled).toBe(true);
  }, 10_000);

  it("lets an unverified active file scope return to normal toolbar behavior", async () => {
    const verifiedSubmission = buildFileWorkspaceSubmission({
      submittedScopeIds: ["fm_qad_001"],
      scopeReviews: [{
        id: "review-1",
        scopeId: "fm_qad_001",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedBy: { id: "monitor-1", name: "Monitor", email: "monitor@example.test" },
        reviewedAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }],
    });
    const unverifiedSubmission = buildFileWorkspaceSubmission({
      submittedScopeIds: ["fm_qad_001"],
      scopeReviews: [{
        id: "review-1",
        scopeId: "fm_qad_001",
        scopeType: "file",
        decision: "unverified",
        notes: null,
        reviewedBy: { id: "monitor-1", name: "Monitor", email: "monitor@example.test" },
        reviewedAt: "2026-05-19T10:05:00.000Z",
        updatedAt: "2026-05-19T10:05:00.000Z",
      }],
    });
    mockIndicatorPanelData([verifiedSubmission]);

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);
    const fileTab = (await within(view.container).findAllByRole("button", { name: /FM-QAD-001/i }))
      .find((button) => button.getAttribute("data-category-id") === "fm_qad_001");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-001 workspace tab.");
    }
    fireEvent.click(fileTab);
    expect((await screen.findAllByText("Locked after monitor verification.")).length).toBeGreaterThan(0);

    mockIndicatorPanelData([unverifiedSubmission]);
    view.rerender(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    await waitFor(() => {
      expect(screen.queryByText("Locked after monitor verification.")).toBeNull();
    });
    expect(screen.queryByText("This package contains verified files or indicators. Ask the Monitor to unverify them before final submission.")).toBeNull();
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    const finalSubmitButton = screen.getByRole("button", { name: "Final Submit Package" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(false);
    expect(finalSubmitButton.title).not.toBe("This package contains verified files or indicators. Ask the Monitor to unverify them before final submission.");
  }, 10_000);

  it("only blocks final submit when a verified scope is outside the active tab", async () => {
    const submission = buildFileWorkspaceSubmission({
      uploadedFileTypes: ["fm_qad_001", "fm_qad_002"],
      readyScopeIds: ["fm_qad_002"],
      submittedScopeIds: ["fm_qad_001"],
      scopeReviews: [{
        id: "review-1",
        scopeId: "fm_qad_001",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedBy: { id: "monitor-1", name: "Monitor", email: "monitor@example.test" },
        reviewedAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }],
    });
    mockIndicatorPanelData([submission]);

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);
    const fileTab = (await within(view.container).findAllByRole("button", { name: /FM-QAD-002/i }))
      .find((button) => button.getAttribute("data-category-id") === "fm_qad_002");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-002 workspace tab.");
    }
    fireEvent.click(fileTab);

    await screen.findByText("This package contains verified files or indicators. Ask the Monitor to unverify them before final submission.");
    expect(screen.queryByText("Locked after monitor verification.")).toBeNull();

    const resetButton = screen.getByRole("button", { name: "Reset" }) as HTMLButtonElement;
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    const finalSubmitButton = screen.getByRole("button", { name: "Final Submit Package" }) as HTMLButtonElement;
    expect(resetButton.disabled).toBe(false);
    expect(sendButton.disabled).toBe(false);
    expect(finalSubmitButton.disabled).toBe(true);
  }, 10_000);

  it("removes stale verified scopes from batch selections after refreshed state arrives", async () => {
    const readySubmission = buildFileWorkspaceSubmission({
      uploadedFileTypes: ["fm_qad_001", "fm_qad_002"],
      readyScopeIds: ["fm_qad_001", "fm_qad_002"],
      submittedScopeIds: [],
    });
    const refreshedSubmission = buildFileWorkspaceSubmission({
      uploadedFileTypes: ["fm_qad_001", "fm_qad_002"],
      readyScopeIds: ["fm_qad_001", "fm_qad_002"],
      submittedScopeIds: [],
      scopeReviews: [{
        id: "review-1",
        scopeId: "fm_qad_001",
        scopeType: "file",
        decision: "verified",
        notes: null,
        reviewedBy: { id: "monitor-1", name: "Monitor", email: "monitor@example.test" },
        reviewedAt: "2026-05-19T10:00:00.000Z",
        updatedAt: "2026-05-19T10:00:00.000Z",
      }],
    });
    const submitSubmissionScopes = vi.fn().mockResolvedValue(refreshedSubmission);
    mockIndicatorPanelData([readySubmission], { submitSubmissionScopes });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);
    const selectAllButton = await screen.findByRole("button", { name: "Select all" });
    fireEvent.click(selectAllButton);
    await screen.findByText("Selected: FM-QAD-001, FM-QAD-002");

    mockIndicatorPanelData([refreshedSubmission], { submitSubmissionScopes });
    view.rerender(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    await waitFor(() => {
      expect(screen.queryByText("Selected: FM-QAD-001, FM-QAD-002")).toBeNull();
    });
    expect(screen.getByText("Selected: FM-QAD-002")).not.toBeNull();
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(submitSubmissionScopes).toHaveBeenCalledWith("submission-1", ["fm_qad_002"]);
    });
    expect(submitSubmissionScopes).not.toHaveBeenCalledWith("submission-1", ["fm_qad_001"]);
  }, 10_000);

  it("hydrates and refreshes the saved submission immediately after saving School Achievements", async () => {
    const refreshSubmissions = vi.fn().mockResolvedValue(undefined);
    const updateSubmission = vi.fn().mockResolvedValue({
      id: "submission-1",
      schoolId: "1",
      schoolType: "private",
      academicYearId: "year-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-05-22T09:30:00.000Z",
      completion: {
        hasImetaFormData: true,
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
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    });
    const fetchSubmission = vi.fn().mockResolvedValue({
      ...buildHydratedSubmission("submission-1"),
      updatedAt: "2026-05-22T09:30:00.000Z",
      indicators: [
        {
          id: "indicator-1",
          metric: {
            id: "metric-1",
            code: "IMETA_ENROLL_TOTAL",
            name: "TOTAL NUMBER OF ENROLMENT",
            category: "school_achievements_learning_outcomes",
            framework: "imeta",
            dataType: "yearly_matrix",
            inputSchema: {
              valueType: "integer",
              years: ["2025-2026"],
            },
          },
          targetValue: null,
          actualValue: 2024,
          varianceValue: null,
          actualTypedValue: {
            values: {
              "2025-2026": 2024,
            },
          },
          complianceStatus: "recorded",
          remarks: null,
        },
      ],
      completion: {
        hasImetaFormData: true,
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
    });

    useAuthMock.mockReturnValue({
      apiToken: "token",
      user: {
        id: 25,
        role: "school_head",
        schoolId: 1,
        schoolCode: "401777",
        schoolName: "AMA CC - Santiago City",
        schoolType: "private",
      },
    });
    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        ...buildHydratedSubmission("submission-1"),
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
      }],
      allSubmissions: [],
      metrics: [{
        id: "metric-1",
        code: "IMETA_ENROLL_TOTAL",
        name: "TOTAL NUMBER OF ENROLMENT",
        category: "school_achievements_learning_outcomes",
        framework: "imeta",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "integer",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions,
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission,
      fetchSubmission,
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    const [valueInput] = await within(view.container).findAllByRole("spinbutton");
    expect(valueInput).toBeDefined();
    if (!valueInput) {
      throw new Error("Expected a School Achievements value input.");
    }
    fireEvent.change(valueInput, { target: { value: "2024" } });
    fireEvent.click(await within(view.container).findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSubmission).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("submission-1");
    });
    await waitFor(() => {
      expect(refreshSubmissions).toHaveBeenCalled();
    });
    expect(screen.queryByText("Unable to save indicator package.")).toBeNull();
  }, 10_000);

  it("shows safe service-unavailable copy when School Head save receives a raw 503", async () => {
    const updateSubmission = vi.fn().mockRejectedValue(
      new ApiError("Request failed with status 503.", 503, null),
    );
    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        ...buildHydratedSubmission("submission-1"),
        completion: {
          hasImetaFormData: false,
          hasBmefFile: false,
          hasSmeaFile: false,
          isComplete: false,
          requiredFileTypes: ["school_achievements_learning_outcomes", "fm_qad_001"],
          uploadedFileTypes: [],
          missingFileTypes: ["school_achievements_learning_outcomes", "fm_qad_001"],
        },
        scopeProgress: {
          requiredScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
          submittedScopeIds: [],
          pendingScopeIds: ["school_achievements_learning_outcomes", "fm_qad_001"],
          submittedRequiredScopeCount: 0,
          totalRequiredScopeCount: 2,
        },
      }],
      allSubmissions: [],
      metrics: [{
        id: "metric-1",
        code: "IMETA_ENROLL_TOTAL",
        name: "TOTAL NUMBER OF ENROLMENT",
        category: "school_achievements_learning_outcomes",
        framework: "imeta",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "integer",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission,
      fetchSubmission: vi.fn(),
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    const [valueInput] = await within(view.container).findAllByRole("spinbutton");
    if (!valueInput) {
      throw new Error("Expected a School Achievements value input.");
    }
    fireEvent.change(valueInput, { target: { value: "2024" } });
    fireEvent.click(await within(view.container).findByRole("button", { name: "Save" }));

    await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE);
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  }, 10_000);

  it("builds optimistic KPI target, actual, and status from the saved fillable values", async () => {
    const refreshSubmissions = vi.fn().mockResolvedValue(undefined);
    const onWorkspaceSubmissionHydrated = vi.fn();
    const updateSubmission = vi.fn().mockResolvedValue({
      id: "submission-1",
      schoolId: "1",
      schoolType: "private",
      academicYearId: "year-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-05-22T09:30:00.000Z",
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
        requiredScopeIds: ["key_performance_indicators", "fm_qad_001"],
        submittedScopeIds: [],
        pendingScopeIds: ["key_performance_indicators", "fm_qad_001"],
        submittedRequiredScopeCount: 0,
        totalRequiredScopeCount: 2,
      },
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    });
    const fetchSubmission = vi.fn().mockResolvedValue({
      ...buildHydratedSubmission("submission-1"),
      updatedAt: "2026-05-22T09:30:00.000Z",
      indicators: [
        {
          id: "indicator-kpi-ner",
          metric: {
            id: "metric-kpi-ner",
            code: "NER",
            name: "Net Enrollment Rate (NER)",
            category: "key_performance_indicators",
            framework: "targets_met",
            dataType: "yearly_matrix",
            inputSchema: {
              valueType: "percentage",
              comparison: "greater_or_equal",
              years: ["2025-2026"],
            },
          },
          targetValue: 96,
          actualValue: 94,
          varianceValue: -2,
          targetTypedValue: {
            values: {
              "2025-2026": 96,
            },
          },
          actualTypedValue: {
            values: {
              "2025-2026": 94,
            },
          },
          complianceStatus: "below_target",
          remarks: null,
        },
      ],
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [buildHydratedSubmission("submission-1")],
      allSubmissions: [],
      metrics: [{
        id: "metric-kpi-ner",
        code: "NER",
        name: "Net Enrollment Rate (NER)",
        category: "key_performance_indicators",
        framework: "targets_met",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "percentage",
          comparison: "greater_or_equal",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions,
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission,
      fetchSubmission,
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    const view = render(
      <SchoolIndicatorPanel
        initialAcademicYearId="year-1"
        onWorkspaceSubmissionHydrated={onWorkspaceSubmissionHydrated}
      />,
    );

    fireEvent.click(await within(view.container).findByRole("button", { name: /Key Performance/i }));
    const spinbuttons = await within(view.container).findAllByRole("spinbutton");
    expect(spinbuttons.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(spinbuttons[0]!, { target: { value: "96" } });
    fireEvent.change(spinbuttons[1]!, { target: { value: "94" } });
    fireEvent.click(await within(view.container).findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateSubmission).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onWorkspaceSubmissionHydrated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "submission-1",
          indicators: expect.arrayContaining([
            expect.objectContaining({
              metric: expect.objectContaining({ code: "NER" }),
              targetTypedValue: { values: { "2025-2026": "96" } },
              actualTypedValue: { values: { "2025-2026": "94" } },
              complianceStatus: "below_target",
            }),
          ]),
        }),
        { source: "optimistic" },
      );
    });
  }, 10_000);

  it("stages a report file until Save and then hydrates the full workspace package", async () => {
    const refreshSubmissions = vi.fn().mockResolvedValue(undefined);
    const uploadSubmissionFile = vi.fn().mockResolvedValue({
      ...buildHydratedSubmission("submission-1"),
      updatedAt: "2026-05-22T10:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: true,
        requiredFileTypes: ["fm_qad_001"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: [],
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
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
    const fetchSubmission = vi.fn().mockResolvedValue({
      ...buildHydratedSubmission("submission-1"),
      updatedAt: "2026-05-22T10:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: true,
        requiredFileTypes: ["fm_qad_001"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: [],
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "hydrated-fm-qad-001.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-05-22T10:00:00.000Z",
          downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
          viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
        },
      },
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        ...buildHydratedSubmission("submission-1"),
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
          requiredScopeIds: ["fm_qad_001"],
          submittedScopeIds: [],
          pendingScopeIds: ["fm_qad_001"],
          submittedRequiredScopeCount: 0,
          totalRequiredScopeCount: 1,
        },
      }],
      allSubmissions: [],
      metrics: [],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions,
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission,
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile,
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    const fileTabs = await within(view.container).findAllByRole("button", { name: /FM-QAD-001/i });
    const fileTab = fileTabs.find((button) => button.getAttribute("data-category-id") === "fm_qad_001");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-001 workspace tab.");
    }
    fireEvent.click(fileTab);
    const initialBottomSaveButtons = await within(view.container).findAllByRole("button", { name: "Save" });
    const initialBottomFileSaveButton = initialBottomSaveButtons.find((button) => button.getAttribute("type") === "submit");
    expect(initialBottomFileSaveButton).toBeDefined();
    if (!initialBottomFileSaveButton) {
      throw new Error("Expected bottom Save button for the active file tab.");
    }
    expect((initialBottomFileSaveButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await within(view.container).findByRole("button", { name: /Choose FM-QAD-001/i }));

    const fileInput = view.container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected the hidden file input to be rendered.");
    }
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["report"], "fm-qad-001.pdf", { type: "application/pdf" })],
      },
    });

    expect(uploadSubmissionFile).not.toHaveBeenCalled();
    expect(await screen.findByText(/fm-qad-001\.pdf/i)).not.toBeNull();
    expect(screen.getByText(/The Report View updates only after this file is saved/i)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Save FM-QAD-001/i })).toBeNull();

    const bottomSaveButtons = await within(view.container).findAllByRole("button", { name: "Save" });
    const bottomFileSaveButton = bottomSaveButtons.find((button) => button.getAttribute("type") === "submit");
    expect(bottomFileSaveButton).toBeDefined();
    if (!bottomFileSaveButton) {
      throw new Error("Expected bottom Save button for the active file tab.");
    }
    expect((bottomFileSaveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(bottomFileSaveButton);

    await waitFor(() => {
      expect(uploadSubmissionFile).toHaveBeenCalledWith("submission-1", "fm_qad_001", expect.any(File));
    });
    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("submission-1");
    });
    expect(await screen.findByText(/hydrated-fm-qad-001\.pdf/i)).not.toBeNull();
    expect(refreshSubmissions).not.toHaveBeenCalled();
  }, 10_000);

  it("blocks sending a file scope while that file has an unsaved replacement selected", async () => {
    const submitSubmissionScopes = vi.fn();
    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        ...buildHydratedSubmission("submission-1"),
        files: {
          fm_qad_001: {
            type: "fm_qad_001",
            uploaded: true,
            path: null,
            originalFilename: "saved-fm-qad-001.pdf",
            sizeBytes: 2048,
            uploadedAt: "2026-05-22T09:00:00.000Z",
            downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
            viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
          },
        },
        completion: {
          hasImetaFormData: false,
          hasBmefFile: false,
          hasSmeaFile: false,
          isComplete: false,
          requiredFileTypes: ["fm_qad_001"],
          uploadedFileTypes: ["fm_qad_001"],
          missingFileTypes: [],
        },
        scopeProgress: {
          requiredScopeIds: ["fm_qad_001"],
          submittedScopeIds: [],
          pendingScopeIds: ["fm_qad_001"],
          submittedRequiredScopeCount: 0,
          totalRequiredScopeCount: 1,
        },
      }],
      allSubmissions: [],
      metrics: [],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission: vi.fn().mockResolvedValue(buildHydratedSubmission("submission-1")),
      resetSubmissionWorkspace: vi.fn(),
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes,
      loadHistory: vi.fn(),
    });

    const view = render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    const fileTabs = await within(view.container).findAllByRole("button", { name: /FM-QAD-001/i });
    const fileTab = fileTabs.find((button) => button.getAttribute("data-category-id") === "fm_qad_001");
    expect(fileTab).toBeDefined();
    if (!fileTab) {
      throw new Error("Expected FM-QAD-001 workspace tab.");
    }
    fireEvent.click(fileTab);
    const fileInput = view.container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected the hidden file input to be rendered.");
    }
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["replacement"], "replacement-fm-qad-001.pdf", { type: "application/pdf" })],
      },
    });

    const sendButtons = await within(view.container).findAllByRole("button", { name: "Send" });
    const sendButton = sendButtons.find((button) => button.getAttribute("title") === "Save or cancel the selected file before sending it.");
    expect(sendButton).toBeDefined();
    if (!sendButton) {
      throw new Error("Expected the unified Send button to be blocked by the pending replacement.");
    }
    expect(sendButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(sendButton);

    expect(submitSubmissionScopes).not.toHaveBeenCalled();
  }, 10_000);
});

describe("SchoolIndicatorPanel reset", () => {
  it("keeps the simplified action bar stable for a mocked draft-school workspace", async () => {
    const resetSubmissionWorkspace = vi.fn().mockResolvedValue({
      id: "submission-1",
      schoolId: "1",
      schoolType: "private",
      academicYearId: "year-1",
      reportingPeriod: "ANNUAL",
      status: "draft",
      version: 2,
      notes: null,
      submittedAt: null,
      reviewedAt: null,
      updatedAt: "2026-05-21T10:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: [],
        missingFileTypes: ["fm_qad_001", "fm_qad_002"],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
        submittedScopeIds: [],
        pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
        submittedRequiredScopeCount: 0,
        totalRequiredScopeCount: 4,
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
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    });
    const fetchSubmission = vi.fn().mockResolvedValue({
      id: "submission-1",
      formType: "indicator",
      status: "draft",
      statusLabel: "Draft",
      reportingPeriod: "ANNUAL",
      version: 2,
      schoolId: "1",
      schoolType: "private",
      notes: null,
      reviewNotes: null,
      createdAt: "2026-05-21T08:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
      submittedAt: null,
      reviewedAt: null,
      summary: {
        totalIndicators: 0,
        metIndicators: 0,
        belowTargetIndicators: 0,
        complianceRatePercent: 0,
      },
      indicators: [],
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
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: [],
        missingFileTypes: ["fm_qad_001", "fm_qad_002"],
      },
      scopeProgress: {
        requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
        submittedScopeIds: [],
        pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
        submittedRequiredScopeCount: 0,
        totalRequiredScopeCount: 4,
      },
      academicYear: {
        id: "year-1",
        name: "2025-2026",
      },
    });

    useAuthMock.mockReturnValue({
      apiToken: "token",
      user: {
        id: 25,
        role: "school_head",
        schoolId: 1,
        schoolCode: "401777",
        schoolName: "AMA CC - Santiago City",
        schoolType: "private",
      },
    });
    useIndicatorDataMock.mockReturnValue({
      submissions: [{
        id: "submission-1",
        formType: "indicator",
        status: "draft",
        statusLabel: "Draft",
        reportingPeriod: "ANNUAL",
        version: 1,
        schoolId: "1",
        schoolType: "private",
        notes: null,
        reviewNotes: null,
        createdAt: "2026-05-21T08:00:00.000Z",
        updatedAt: "2026-05-21T09:00:00.000Z",
        submittedAt: null,
        reviewedAt: null,
        summary: {
          totalIndicators: 0,
          metIndicators: 0,
          belowTargetIndicators: 0,
          complianceRatePercent: 0,
        },
        indicators: [],
        files: {
          fm_qad_001: {
            type: "fm_qad_001",
            uploaded: true,
            path: null,
            originalFilename: "fm-qad-001.pdf",
            sizeBytes: 2048,
            uploadedAt: "2026-05-21T09:00:00.000Z",
            downloadUrl: "/api/submissions/submission-1/download/fm_qad_001",
            viewUrl: "/api/submissions/submission-1/view/fm_qad_001",
          },
        },
        completion: {
          hasImetaFormData: false,
          hasBmefFile: false,
          hasSmeaFile: false,
          isComplete: false,
          requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
          uploadedFileTypes: ["fm_qad_001"],
          missingFileTypes: ["fm_qad_002"],
        },
        scopeProgress: {
          requiredScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_001", "fm_qad_002"],
          submittedScopeIds: ["fm_qad_001"],
          pendingScopeIds: ["school_achievements_learning_outcomes", "key_performance_indicators", "fm_qad_002"],
          submittedRequiredScopeCount: 1,
          totalRequiredScopeCount: 4,
        },
        academicYear: {
          id: "year-1",
          name: "2025-2026",
        },
      }],
      allSubmissions: [],
      metrics: [{
        id: "metric-1",
        code: "IMETA_ENROLL_TOTAL",
        name: "TOTAL NUMBER OF ENROLMENT",
        category: "school_achievements_learning_outcomes",
        framework: "imeta",
        dataType: "yearly_matrix",
        inputSchema: {
          valueType: "integer",
          years: ["2025-2026"],
        },
        sortOrder: 1,
      }],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: null,
      refreshSubmissions: vi.fn().mockResolvedValue(undefined),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission,
      resetSubmissionWorkspace,
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      loadHistory: vi.fn(),
    });

    render(<SchoolIndicatorPanel initialAcademicYearId="year-1" />);

    expect(await screen.findByLabelText("Academic Year")).not.toBeNull();
    expect((await screen.findAllByRole("button", { name: "Save" })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: "Send" })).length).toBeGreaterThan(0);
  });
});
