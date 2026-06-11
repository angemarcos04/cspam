import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolIndicatorPanel } from "@/components/indicators/SchoolIndicatorPanel";

const useAuthMock = vi.fn();
const useIndicatorDataMock = vi.fn();

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

beforeEach(() => {
  localStorage.clear();
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

    expect((await screen.findAllByText(/Ready for Submit:/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("progressbar", { name: "Workspace readiness progress" })).length).toBeGreaterThan(0);
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

  it("hydrates the full workspace package after uploading a report file", async () => {
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

    fireEvent.click(await within(view.container).findByRole("button", { name: /FM-QAD-001/i }));
    fireEvent.click(await within(view.container).findByRole("button", { name: /Upload FM-QAD-001/i }));

    const fileInput = view.container.querySelector('input[type="file"]');
    if (!(fileInput instanceof HTMLInputElement)) {
      throw new Error("Expected the hidden file input to be rendered.");
    }
    fireEvent.change(fileInput, {
      target: {
        files: [new File(["report"], "fm-qad-001.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => {
      expect(uploadSubmissionFile).toHaveBeenCalledWith("submission-1", "fm_qad_001", expect.any(File));
    });
    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("submission-1");
    });
    expect(await screen.findByText(/hydrated-fm-qad-001\.pdf/i)).not.toBeNull();
    expect(refreshSubmissions).not.toHaveBeenCalled();
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
