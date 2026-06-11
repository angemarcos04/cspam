import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolAdminDashboard } from "@/pages/SchoolAdminDashboard";
import type { IndicatorSubmission } from "@/types";

const useAuthMock = vi.fn();
const useDataMock = vi.fn();
const useIndicatorDataMock = vi.fn();
let refreshRecordsMock = vi.fn();
let refreshSubmissionsMock = vi.fn();
let refreshAllSubmissionsMock = vi.fn();

vi.mock("@/context/Auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/context/Data", () => ({
  useData: () => useDataMock(),
}));

vi.mock("@/context/IndicatorData", () => ({
  useIndicatorData: () => useIndicatorDataMock(),
}));

vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/DashboardHelpDialog", () => ({
  DashboardHelpDialog: () => null,
}));

vi.mock("@/components/indicators/SchoolIndicatorPanel", () => ({
  SchoolIndicatorPanel: ({ selectedAcademicYearId }: { selectedAcademicYearId?: string }) => (
    <div data-testid="workspace-panel" data-selected-academic-year-id={selectedAcademicYearId ?? ""} />
  ),
}));

function buildSubmission(overrides: Partial<IndicatorSubmission>): IndicatorSubmission {
  return {
    id: "submission-1",
    formType: "indicator",
    academicYear: { id: "year-1", name: "2025-2026" },
    reportingPeriod: "ANNUAL",
    status: "submitted",
    statusLabel: "Submitted",
    version: 1,
    notes: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    submittedAt: "2026-05-01T00:00:00.000Z",
    reviewedAt: null,
    reviewNotes: null,
    indicators: [],
    items: [],
    summary: {
      totalIndicators: 1,
      metIndicators: 1,
      belowTargetIndicators: 0,
      complianceRatePercent: 100,
    },
    completion: {
      hasImetaFormData: true,
      hasBmefFile: false,
      hasSmeaFile: false,
      isComplete: false,
      requiredFileTypes: [],
      uploadedFileTypes: [],
      missingFileTypes: [],
    },
    schoolId: "school-1",
    schoolType: "private",
    presentation: {
      activeFileTypes: [],
      activeReportFileTypes: [],
      activeWorkspaceFileTypes: [],
      secondaryHistoricalFileTypes: [],
    },
    school: {
      id: "school-1",
      schoolCode: "401777",
      name: "AMA CC - Santiago City",
      type: "private",
    },
    ...overrides,
  };
}

function buildEnrollmentIndicator(value: number) {
  return {
    id: `indicator-${value}`,
    metric: {
      id: "IMETA_ENROLL_TOTAL",
      code: "IMETA_ENROLL_TOTAL",
      name: "TOTAL NUMBER OF ENROLMENT",
      category: "school_achievements_learning_outcomes",
      framework: "imeta",
      dataType: "yearly_matrix",
      inputSchema: {
        valueType: "integer",
        years: ["2025-2026", "2026-2027"],
      },
    },
    targetValue: null,
    actualValue: value,
    varianceValue: null,
    actualTypedValue: {
      values: {
        "2025-2026": value,
        "2026-2027": 9999,
      },
    },
    actualDisplay: `2025-2026: ${value}.00 | 2026-2027: 9999.00`,
    complianceStatus: "met",
    remarks: null,
  };
}

function buildEnrollmentIndicatorWithVariantYearLabel(value: number) {
  return {
    id: `indicator-variant-${value}`,
    metric: {
      id: "IMETA_ENROLL_TOTAL",
      code: "IMETA_ENROLL_TOTAL",
      name: "TOTAL NUMBER OF ENROLMENT",
      category: "school_achievements_learning_outcomes",
      framework: "imeta",
      dataType: "yearly_matrix",
      inputSchema: {
        valueType: "integer",
        years: ["2025-2026", "2026-2027"],
      },
    },
    targetValue: null,
    actualValue: value,
    varianceValue: null,
    actualTypedValue: {
      values: {
        "SY 2025 - 2026": value,
        "SY 2026 - 2027": 9999,
      },
    },
    actualDisplay: `SY 2025 - 2026: ${value}.00 | SY 2026 - 2027: 9999.00`,
    complianceStatus: "met",
    remarks: null,
  };
}

function buildKpiIndicator(overrides?: Partial<Record<"targetValue" | "actualValue" | "complianceStatus", number | string | null>>) {
  return {
    id: "kpi-ner",
    metric: {
      id: "NER",
      code: "NER",
      name: "Net Enrollment Rate (NER)",
      category: "learner",
      framework: "targets_met",
      dataType: "yearly_matrix",
    },
    targetValue: typeof overrides?.targetValue === "number" ? overrides.targetValue : 96,
    actualValue: typeof overrides?.actualValue === "number" ? overrides.actualValue : 94,
    varianceValue: -2,
    complianceStatus: typeof overrides?.complianceStatus === "string" ? overrides.complianceStatus : "below_target",
    remarks: null,
  };
}

describe("SchoolAdminDashboard submitted report view", () => {
  beforeEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    refreshRecordsMock = vi.fn().mockResolvedValue(undefined);
    refreshSubmissionsMock = vi.fn().mockResolvedValue(undefined);
    refreshAllSubmissionsMock = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps selected-year report truth stable even when broader cached submissions contain another finalized year", async () => {
    const yearOneSubmission = buildSubmission({
      id: "101",
      academicYear: { id: "year-1", name: "2025-2026" },
      indicators: [buildEnrollmentIndicator(1515)],
      items: [],
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const yearTwoSubmission = buildSubmission({
      id: "202",
      academicYear: { id: "year-2", name: "2026-2027" },
      indicators: [buildEnrollmentIndicator(9999)],
      items: [],
      submittedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    const loadSubmissionsForYear = vi.fn(async (_schoolId: string, yearId: string) => {
      if (yearId === "year-1") {
        return [yearOneSubmission];
      }
      if (yearId === "year-2") {
        return [yearTwoSubmission];
      }
      return [];
    });

    const fetchSubmission = vi.fn(async (id: string) => (id === "101" ? yearOneSubmission : yearTwoSubmission));

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [yearTwoSubmission],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
        { id: "year-2", name: "2026-2027", isCurrent: false },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission,
      loadSubmissionsForYear,
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });
    window.sessionStorage.setItem("cspams:school-admin-dashboard:view-year:7:school-1", "year-1");
    window.sessionStorage.setItem("cspams:school-admin-dashboard:view-year:7:school-1:manual", "true");

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #101 (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("Submitted Report Package")).not.toBeNull();
    expect(screen.getByText("1,515")).not.toBeNull();
    expect(screen.queryByText("Source package: #202 (Submitted).")).toBeNull();

    fireEvent.change(screen.getByLabelText("Academic year filter"), {
      target: { value: "year-2" },
    });

    await waitFor(() => {
      expect(screen.getByText("Source package: #202 (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("9,999")).not.toBeNull();
  });

  it("shows a newer saved draft in Report View as a workspace preview", async () => {
    const finalized = buildSubmission({
      id: "finalized-101",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(1515)],
      items: [],
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const draft = buildSubmission({
      id: "draft-101",
      status: "draft",
      statusLabel: "Draft",
      indicators: [],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const hydratedDraft = buildSubmission({
      id: "draft-101",
      status: "draft",
      statusLabel: "Draft",
      indicators: [buildEnrollmentIndicator(2024)],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [finalized],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async (id: string) => (id === "draft-101" ? hydratedDraft : finalized)),
      loadSubmissionsForYear: vi.fn(async () => [draft, finalized]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("TARGETS-MET")).not.toBeNull();
    });
    expect(screen.getByText("Source package: #draft-101 (Draft).")).not.toBeNull();
    expect(screen.getByText("Saved locally for this school account. Not sent to the monitor until final submit.")).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByText("2,024")).not.toBeNull();
    });
    expect(screen.queryByText("Source package: #finalized-101 (Submitted).")).toBeNull();
    expect(screen.queryByText("1,515")).toBeNull();
  });

  it("selects the latest saved draft academic year on fresh login and aligns the workspace", async () => {
    const finalized = buildSubmission({
      id: "finalized-101",
      academicYear: { id: "year-1", name: "2025-2026" },
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(1515)],
      items: [],
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const draft = buildSubmission({
      id: "draft-202",
      academicYear: { id: "year-2", name: "2026-2027" },
      status: "draft",
      statusLabel: "Draft",
      indicators: [],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const hydratedDraft = buildSubmission({
      id: "draft-202",
      academicYear: { id: "year-2", name: "2026-2027" },
      status: "draft",
      statusLabel: "Draft",
      indicators: [buildEnrollmentIndicator(2024)],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:00:00.000Z",
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    const loadSubmissionsForYear = vi.fn(async (_schoolId: string, academicYearId: string) => (
      academicYearId === "year-2" ? [draft] : [finalized]
    ));
    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [finalized, draft],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
        { id: "year-2", name: "2026-2027", isCurrent: false },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async (id: string) => (id === "draft-202" ? hydratedDraft : finalized)),
      loadSubmissionsForYear,
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });
    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #draft-202 (Draft).")).not.toBeNull();
    });
    expect(screen.getByText("TARGETS-MET")).not.toBeNull();
    expect(screen.getByText("9,999")).not.toBeNull();
    expect(screen.getByTestId("workspace-panel").getAttribute("data-selected-academic-year-id")).toBe("year-2");
    expect(loadSubmissionsForYear).toHaveBeenCalledWith("school-1", "year-2");
  });

  it("rerenders the selected-year submitted report immediately when indicator submissions refresh", async () => {
    const staleSubmitted = buildSubmission({
      id: "submitted-202",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [],
      items: [],
      submittedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const hydratedStaleSubmitted = buildSubmission({
      id: "submitted-202",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(1515), buildKpiIndicator({ targetValue: 96, actualValue: 94, complianceStatus: "below_target" })],
      items: [],
      submittedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const refreshedSubmitted = buildSubmission({
      id: "submitted-202",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [],
      items: [],
      submittedAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    });
    const hydratedRefreshedSubmitted = buildSubmission({
      id: "submitted-202",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(2024), buildKpiIndicator({ targetValue: 97, actualValue: 96, complianceStatus: "met" })],
      items: [],
      submittedAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    let loadCount = 0;
    const loadSubmissionsForYear = vi.fn(async () => {
      loadCount += 1;
      return [loadCount === 1 ? staleSubmitted : refreshedSubmitted];
    });
    const fetchSubmission = vi.fn(async () => (loadCount <= 1 ? hydratedStaleSubmitted : hydratedRefreshedSubmitted));

    const indicatorDataState = {
      submissions: [],
      allSubmissions: [],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission,
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      loadSubmissionsForYear,
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    };

    useIndicatorDataMock.mockImplementation(() => indicatorDataState);

    const view = render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #submitted-202 (Submitted).")).not.toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByText("1,515")).not.toBeNull();
      expect(screen.getByText("94")).not.toBeNull();
    });

    indicatorDataState.lastSyncedAt = "2026-05-17T00:00:05.000Z";
    view.rerender(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(loadSubmissionsForYear).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("2,024")).not.toBeNull();
    });
    expect(screen.getByText("96")).not.toBeNull();
  });

  it("prefers a fresher same-year submission from indicator state before the selected-year list reload catches up", async () => {
    const staleSubmitted = buildSubmission({
      id: "submitted-stale",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(1515), buildKpiIndicator({ targetValue: 96, actualValue: 94, complianceStatus: "below_target" })],
      items: [],
      submittedAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const fresherSubmitted = buildSubmission({
      id: "submitted-fresh",
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(2024), buildKpiIndicator({ targetValue: 97, actualValue: 96, complianceStatus: "met" })],
      items: [],
      submittedAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    const loadSubmissionsForYear = vi.fn(async () => [staleSubmitted]);
    const indicatorDataState = {
      submissions: [],
      allSubmissions: [staleSubmitted],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async (id: string) => (id === "submitted-fresh" ? fresherSubmitted : staleSubmitted)),
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      loadSubmissionsForYear,
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    };

    useIndicatorDataMock.mockImplementation(() => indicatorDataState);

    const view = render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #submitted-stale (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("1,515")).not.toBeNull();
    expect(screen.getByText("94")).not.toBeNull();

    indicatorDataState.allSubmissions = [staleSubmitted, fresherSubmitted];
    view.rerender(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #submitted-fresh (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("2,024")).not.toBeNull();
    expect(screen.getByText("96")).not.toBeNull();
    expect(loadSubmissionsForYear).toHaveBeenCalledTimes(1);
  });

  it("renders selected-year integer report values without joined year text or forced decimals", async () => {
    const submitted = buildSubmission({
      id: "integer-101",
      indicators: [buildEnrollmentIndicator(1515)],
      items: [],
      summary: {
        totalIndicators: 1,
        metIndicators: 0,
        belowTargetIndicators: 0,
        complianceRatePercent: 0,
      },
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("1,515")).not.toBeNull();
    });
    expect(screen.queryByText(/2026-2027:/)).toBeNull();
    expect(screen.queryByText("1515.00")).toBeNull();
  });

  it("renders selected-year report values even when hydrated yearly-matrix keys use variant school-year labels", async () => {
    const currentSubmission = buildSubmission({
      id: "303",
      academicYear: { id: "year-1", name: "2025-2026" },
      indicators: [buildEnrollmentIndicatorWithVariantYearLabel(2024)],
      items: [],
      submittedAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [currentSubmission],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => currentSubmission),
      loadSubmissionsForYear: vi.fn(async () => [currentSubmission]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("2,024")).not.toBeNull();
    });
  });

  it("renders production KPI compliance labels instead of raw backend enums", async () => {
    const submitted = buildSubmission({
      id: "kpi-101",
      indicators: [buildKpiIndicator()],
      items: [],
      summary: {
        totalIndicators: 1,
        metIndicators: 0,
        belowTargetIndicators: 1,
        complianceRatePercent: 0,
      },
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Not met")).not.toBeNull();
    });
    expect(screen.queryByText("below_target")).toBeNull();
  });

  it("previews uploaded report files through authenticated fetch and downloads through the data helper", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:report-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: vi.fn(async () => new Blob(["report"], { type: "application/pdf" })),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const downloadSubmissionFile = vi.fn();
    const submitted = buildSubmission({
      id: "file-101",
      schoolType: "public",
      school: {
        id: "school-1",
        schoolCode: "401777",
        name: "AMA CC - Santiago City",
        type: "public",
      },
      completion: {
        hasImetaFormData: true,
        hasBmefFile: true,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["bmef", "smea"],
        uploadedFileTypes: ["bmef"],
        missingFileTypes: ["smea"],
      },
      presentation: {
        activeFileTypes: ["bmef", "smea"],
        activeReportFileTypes: ["bmef", "smea"],
        activeWorkspaceFileTypes: ["bmef", "smea"],
        secondaryHistoricalFileTypes: [],
      },
      files: {
        bmef: {
          type: "bmef",
          uploaded: true,
          path: null,
          originalFilename: "bmef-report.pdf",
          sizeBytes: 2048,
          uploadedAt: "2026-06-06T01:00:00.000Z",
          downloadUrl: "/api/submissions/file-101/download/bmef",
          viewUrl: "/api/submissions/file-101/view/bmef",
        },
      },
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "public",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile,
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    fireEvent.click(await screen.findByRole("button", { name: /View BMEF Report/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [fetchInput, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(String(fetchInput)).toContain("/api/submissions/file-101/view/bmef");
    expect((requestInit.headers as Headers).get("Authorization")).toBe("Bearer token");

    const preview = await screen.findByTitle("BMEF PDF preview");
    expect(preview.getAttribute("src")).toBe("blob:report-preview");

    fireEvent.click(screen.getByRole("button", { name: /Download/i }));
    expect(downloadSubmissionFile).toHaveBeenCalledWith("file-101", "bmef");
  });

  it("renders private FM-QAD report cards from the selected package and downloads the exact file", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:fm-qad-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      blob: vi.fn(async () => new Blob(["fm-qad"], { type: "application/pdf" })),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const downloadSubmissionFile = vi.fn();
    const submitted = buildSubmission({
      id: "private-file-101",
      schoolType: "private",
      school: {
        id: "school-1",
        schoolCode: "401777",
        name: "AMA CC - Santiago City",
        type: "private",
      },
      completion: {
        hasImetaFormData: true,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: ["fm_qad_002"],
      },
      presentation: {
        activeFileTypes: ["fm_qad_001", "fm_qad_002"],
        activeReportFileTypes: ["fm_qad_001", "fm_qad_002"],
        activeWorkspaceFileTypes: ["fm_qad_001", "fm_qad_002"],
        secondaryHistoricalFileTypes: [],
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-06T01:00:00.000Z",
          downloadUrl: "/api/submissions/private-file-101/download/fm_qad_001",
          viewUrl: "/api/submissions/private-file-101/view/fm_qad_001",
        },
        fm_qad_002: {
          type: "fm_qad_002",
          uploaded: false,
          path: null,
          originalFilename: null,
          sizeBytes: null,
          uploadedAt: null,
          downloadUrl: null,
          viewUrl: null,
        },
      },
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile,
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    const viewFmQadOne = await screen.findByRole("button", { name: /View FM-QAD-001 Report/i });
    expect((screen.getByRole("button", { name: /View FM-QAD-002 Report/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("BMEF Report")).toBeNull();
    expect(screen.queryByText("SMEA Report")).toBeNull();

    fireEvent.click(viewFmQadOne);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [fetchInput, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(String(fetchInput)).toContain("/api/submissions/private-file-101/view/fm_qad_001");
    expect((requestInit.headers as Headers).get("Authorization")).toBe("Bearer token");

    fireEvent.click(await screen.findByRole("button", { name: /Download/i }));
    expect(downloadSubmissionFile).toHaveBeenCalledWith("private-file-101", "fm_qad_001");
  });

  it("hydrates file-only private FM-QAD report metadata before rendering preview cards", async () => {
    const lightweightDraft = buildSubmission({
      id: "private-file-only-101",
      status: "draft",
      statusLabel: "Draft",
      schoolType: "private",
      indicators: [],
      items: [],
      submittedAt: null,
      updatedAt: "2026-06-06T01:00:00.000Z",
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: [],
        missingFileTypes: ["fm_qad_001", "fm_qad_002"],
      },
      presentation: {
        activeFileTypes: ["fm_qad_001", "fm_qad_002"],
        activeReportFileTypes: ["fm_qad_001", "fm_qad_002"],
        activeWorkspaceFileTypes: ["fm_qad_001", "fm_qad_002"],
        secondaryHistoricalFileTypes: [],
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
        fm_qad_002: {
          type: "fm_qad_002",
          uploaded: false,
          path: null,
          originalFilename: null,
          sizeBytes: null,
          uploadedAt: null,
          downloadUrl: null,
          viewUrl: null,
        },
      },
    });
    const hydratedDraft = buildSubmission({
      ...lightweightDraft,
      completion: {
        hasImetaFormData: false,
        hasBmefFile: false,
        hasSmeaFile: false,
        isComplete: false,
        requiredFileTypes: ["fm_qad_001", "fm_qad_002"],
        uploadedFileTypes: ["fm_qad_001"],
        missingFileTypes: ["fm_qad_002"],
      },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          path: null,
          originalFilename: "fm-qad-001.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-06T01:00:00.000Z",
          downloadUrl: "/api/submissions/private-file-only-101/download/fm_qad_001",
          viewUrl: "/api/submissions/private-file-only-101/view/fm_qad_001",
        },
        fm_qad_002: {
          type: "fm_qad_002",
          uploaded: false,
          path: null,
          originalFilename: null,
          sizeBytes: null,
          uploadedAt: null,
          downloadUrl: null,
          viewUrl: null,
        },
      },
    });
    const fetchSubmission = vi.fn(async () => hydratedDraft);

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [lightweightDraft],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission,
      loadSubmissionsForYear: vi.fn(async () => [lightweightDraft]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("private-file-only-101");
    });
    expect(await screen.findByText("fm-qad-001.pdf")).not.toBeNull();
    expect((screen.getByRole("button", { name: /View FM-QAD-001 Report/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /View FM-QAD-002 Report/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses Ctrl+R to refresh School Head dashboard data instead of forcing a browser reload", async () => {
    const submitted = buildSubmission({
      id: "refresh-101",
      indicators: [buildEnrollmentIndicator(1515)],
      items: [],
    });

    useAuthMock.mockReturnValue({
      user: {
        id: 7,
        role: "school_head",
        schoolId: "school-1",
        schoolType: "private",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        schoolAddress: "Herritage Bldg.",
      },
      apiToken: "token",
    });

    useDataMock.mockReturnValue({
      records: [
        {
          schoolId: "school-1",
          schoolName: "AMA CC - Santiago City",
          schoolCode: "401777",
          address: "Herritage Bldg.",
        },
      ],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(refreshRecordsMock).toHaveBeenCalled();
      expect(refreshSubmissionsMock).toHaveBeenCalled();
      expect(refreshAllSubmissionsMock).toHaveBeenCalled();
    });

    refreshRecordsMock.mockClear();
    refreshSubmissionsMock.mockClear();
    refreshAllSubmissionsMock.mockClear();

    fireEvent.keyDown(window, { key: "r", ctrlKey: true });

    await waitFor(() => {
      expect(refreshRecordsMock).toHaveBeenCalledTimes(1);
      expect(refreshSubmissionsMock).toHaveBeenCalledTimes(1);
      expect(refreshAllSubmissionsMock).toHaveBeenCalledTimes(1);
    });
  });
});
