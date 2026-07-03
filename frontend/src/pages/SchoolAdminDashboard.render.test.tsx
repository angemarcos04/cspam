import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchoolAdminDashboard } from "@/pages/SchoolAdminDashboard";
import type { IndicatorSubmission, IndicatorSubmissionItem } from "@/types";

const useAuthMock = vi.fn();
const useDataMock = vi.fn();
const useIndicatorDataMock = vi.fn();
let refreshRecordsMock = vi.fn();
let refreshSubmissionsMock = vi.fn();
let refreshAllSubmissionsMock = vi.fn();
let schoolIndicatorPanelPropsMock: {
  selectedAcademicYearId?: string;
  onWorkspaceSubmissionHydrated?: (
    submission: IndicatorSubmission,
    meta?: { source?: "optimistic" | "hydrated" },
  ) => void;
} | null = null;

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
  SchoolIndicatorPanel: (props: {
    selectedAcademicYearId?: string;
    onWorkspaceSubmissionHydrated?: (
      submission: IndicatorSubmission,
      meta?: { source?: "optimistic" | "hydrated" },
    ) => void;
  }) => {
    schoolIndicatorPanelPropsMock = props;
    return <div data-testid="workspace-panel" data-selected-academic-year-id={props.selectedAcademicYearId ?? ""} />;
  },
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
  const targetValue = typeof overrides?.targetValue === "number" ? overrides.targetValue : 96;
  const actualValue = typeof overrides?.actualValue === "number" ? overrides.actualValue : 94;

  return {
    id: "kpi-ner",
    metric: {
      id: "NER",
      code: "NER",
      name: "Net Enrollment Rate (NER)",
      category: "learner",
      framework: "targets_met",
      dataType: "yearly_matrix",
      inputSchema: {
        valueType: "percentage",
        comparison: "greater_or_equal",
        years: ["2025-2026", "2026-2027"],
      },
    },
    targetValue,
    actualValue,
    targetTypedValue: {
      values: {
        "2025-2026": targetValue,
        "2026-2027": 999,
      },
    },
    actualTypedValue: {
      values: {
        "2025-2026": actualValue,
        "2026-2027": 888,
      },
    },
    varianceValue: -2,
    complianceStatus: typeof overrides?.complianceStatus === "string" ? overrides.complianceStatus : "below_target",
    remarks: null,
  };
}

function buildKpiIndicatorFor(options: {
  code: string;
  name: string;
  target?: number | string | null;
  actual?: number | string | null;
  comparison?: string;
  complianceStatus?: string;
  selectedYear?: string;
  staleYear?: string;
}): IndicatorSubmissionItem {
  const selectedYear = options.selectedYear ?? "2025-2026";
  const targetValues = options.target === undefined
    ? { [options.staleYear ?? "2026-2027"]: 0 }
    : { [selectedYear]: options.target };
  const actualValues = options.actual === undefined
    ? { [options.staleYear ?? "2026-2027"]: 0 }
    : { [selectedYear]: options.actual };

  return {
    id: `kpi-${options.code}`,
    metric: {
      id: options.code,
      code: options.code,
      name: options.name,
      category: "learner",
      framework: "targets_met",
      dataType: "yearly_matrix",
      inputSchema: {
        valueType: "percentage",
        comparison: options.comparison ?? "greater_or_equal",
        years: ["2025-2026", "2026-2027"],
      },
    },
    targetValue: options.target === undefined ? 0 : Number(options.target),
    actualValue: options.actual === undefined ? 0 : Number(options.actual),
    targetTypedValue: { values: targetValues },
    actualTypedValue: { values: actualValues },
    varianceValue: null,
    complianceStatus: options.complianceStatus ?? "met",
    remarks: null,
  };
}

function buildLegacySaloIndicator(value: string) {
  return {
    id: "legacy-salo",
    metric: {
      id: "SALO",
      code: "SALO",
      name: "School Achievement and Learning Outcomes",
      category: "school_achievements_learning_outcomes",
      framework: "imeta",
      dataType: "yearly_matrix",
      inputSchema: {
        valueType: "text",
        years: ["2025-2026"],
      },
    },
    targetValue: null,
    actualValue: null,
    varianceValue: null,
    actualTypedValue: {
      values: {
        "2025-2026": value,
      },
    },
    actualDisplay: `2025-2026: ${value}`,
    complianceStatus: "recorded",
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
    schoolIndicatorPanelPropsMock = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ignores stale manual-year storage on fresh login and restores the latest saved package year", async () => {
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
      expect(screen.getByText("Source package: #202 (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("Submitted Report Package")).not.toBeNull();
    expect(screen.getByText("9,999")).not.toBeNull();
    expect(screen.queryByText("Source package: #101 (Submitted).")).toBeNull();

    fireEvent.change(screen.getByLabelText("Academic year filter"), {
      target: { value: "year-1" },
    });

    await waitFor(() => {
      expect(screen.getByText("Source package: #101 (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("1,515")).not.toBeNull();
  });

  it("hydrates the latest saved package on login before rendering stale TARGETS-MET list values", async () => {
    const staleListDraft = buildSubmission({
      id: "draft-repeat-login",
      status: "draft",
      statusLabel: "Draft",
      indicators: [buildEnrollmentIndicator(1111)],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    const latestSavedDetail = buildSubmission({
      id: "draft-repeat-login",
      status: "draft",
      statusLabel: "Draft",
      indicators: [buildEnrollmentIndicator(2222)],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    let resolveFetchSubmission: ((submission: IndicatorSubmission) => void) | null = null;
    const fetchSubmission = vi.fn(() => new Promise<IndicatorSubmission>((resolve) => {
      resolveFetchSubmission = resolve;
    }));

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
      allSubmissions: [staleListDraft],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission,
      loadSubmissionsForYear: vi.fn(async () => [staleListDraft]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #draft-repeat-login (Draft).")).not.toBeNull();
    });
    expect(fetchSubmission).toHaveBeenCalledWith("draft-repeat-login");
    expect(screen.getByText("Loading saved report details before showing TARGETS-MET values.")).not.toBeNull();
    expect(screen.queryByText("1,111")).toBeNull();

    act(() => {
      resolveFetchSubmission?.(latestSavedDetail);
    });

    await waitFor(() => {
      expect(screen.getByText("2,222")).not.toBeNull();
    });
    expect(screen.queryByText("1,111")).toBeNull();
  });

  it("retries saved report hydration after a transient login detail failure", async () => {
    const lightweightDraft = buildSubmission({
      id: "draft-retry-login",
      status: "draft",
      statusLabel: "Draft",
      indicators: [],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    const hydratedDraft = buildSubmission({
      id: "draft-retry-login",
      status: "draft",
      statusLabel: "Draft",
      indicators: [buildEnrollmentIndicator(3333)],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    const fetchSubmission = vi.fn()
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValue(hydratedDraft);

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
      expect(fetchSubmission).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("3,333")).toBeNull();

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("3,333")).not.toBeNull();
    });
    expect(screen.queryByText("Retrying saved report details...")).toBeNull();
  });

  it("shows a retry action instead of infinite loading when saved report hydration keeps failing", async () => {
    const lightweightDraft = buildSubmission({
      id: "draft-failed-login",
      status: "draft",
      statusLabel: "Draft",
      indicators: [],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    const hydratedDraft = buildSubmission({
      id: "draft-failed-login",
      status: "draft",
      statusLabel: "Draft",
      indicators: [buildEnrollmentIndicator(4444)],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-12T00:00:00.000Z",
    });
    const fetchSubmission = vi.fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockRejectedValueOnce(new Error("second failure"))
      .mockRejectedValueOnce(new Error("third failure"))
      .mockResolvedValue(hydratedDraft);

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
      expect(fetchSubmission).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledTimes(3);
    });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Retry loading saved report/i }).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Unable to load saved report details.").length).toBeGreaterThan(0);
    expect(screen.queryByText("TOTAL NUMBER OF ENROLMENT")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /Retry loading saved report/i })[0]!);

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledTimes(4);
    });
    await waitFor(() => {
      expect(screen.getByText("4,444")).not.toBeNull();
    });
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

  it("updates TARGETS-MET immediately from a freshly hydrated workspace save", async () => {
    const draft = buildSubmission({
      id: "draft-sync-101",
      status: "draft",
      statusLabel: "Draft",
      indicators: [],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const hydratedDraft = buildSubmission({
      id: "draft-sync-101",
      status: "draft",
      statusLabel: "Draft",
      indicators: [
        buildEnrollmentIndicator(2024),
        buildKpiIndicator({ targetValue: 97, actualValue: 96, complianceStatus: "met" }),
      ],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:05:00.000Z",
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
      allSubmissions: [draft],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => draft),
      loadSubmissionsForYear: vi.fn(async () => [draft]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #draft-sync-101 (Draft).")).not.toBeNull();
    });
    expect(screen.queryByText("2,024")).toBeNull();
    expect(screen.queryByText("97.00%")).toBeNull();
    expect(screen.queryByText("96.00%")).toBeNull();

    act(() => {
      schoolIndicatorPanelPropsMock?.onWorkspaceSubmissionHydrated?.(hydratedDraft);
    });

    await waitFor(() => {
      expect(screen.getByText("2,024")).not.toBeNull();
    });
    expect(screen.getByText("97.00%")).not.toBeNull();
    expect(screen.getByText("96.00%")).not.toBeNull();
  });

  it("keeps the newest saved TARGETS-MET values across repeated save and login cycles", async () => {
    const savedA = buildSubmission({
      id: "draft-loop-101",
      status: "draft",
      statusLabel: "Draft",
      indicators: [
        buildEnrollmentIndicator(1111),
        buildKpiIndicator({ targetValue: 91, actualValue: 90, complianceStatus: "below_target" }),
      ],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const savedB = buildSubmission({
      id: "draft-loop-101",
      status: "draft",
      statusLabel: "Draft",
      indicators: [
        buildEnrollmentIndicator(2222),
        buildKpiIndicator({ targetValue: 98, actualValue: 99, complianceStatus: "met" }),
      ],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:05:00.000Z",
    });
    const staleListA = buildSubmission({
      ...savedA,
      indicators: [buildEnrollmentIndicator(1111)],
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

    const fetchSubmission = vi.fn(async () => savedA);
    const loadSubmissionsForYear = vi.fn(async () => [savedA]);
    const indicatorDataState = {
      submissions: [],
      allSubmissions: [savedA],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission,
      loadSubmissionsForYear,
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    };

    useIndicatorDataMock.mockImplementation(() => indicatorDataState);

    const firstLogin = render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("1,111")).not.toBeNull();
    });
    expect(screen.getByText("90.00%")).not.toBeNull();

    act(() => {
      schoolIndicatorPanelPropsMock?.onWorkspaceSubmissionHydrated?.(savedB, { source: "optimistic" });
    });

    await waitFor(() => {
      expect(screen.getByText("2,222")).not.toBeNull();
    });
    expect(screen.getByText("99.00%")).not.toBeNull();
    expect(screen.queryByText("1,111")).toBeNull();
    expect(screen.queryByText("90.00%")).toBeNull();

    firstLogin.unmount();
    schoolIndicatorPanelPropsMock = null;
    fetchSubmission.mockImplementation(async () => savedB);
    loadSubmissionsForYear.mockImplementation(async () => [staleListA]);
    indicatorDataState.allSubmissions = [staleListA];

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("draft-loop-101");
    });
    expect(screen.queryByText("1,111")).toBeNull();
    expect(screen.queryByText("90.00%")).toBeNull();

    await waitFor(() => {
      expect(screen.getByText("2,222")).not.toBeNull();
    });
    expect(screen.getByText("99.00%")).not.toBeNull();
    expect(screen.queryByText("1,111")).toBeNull();
    expect(screen.queryByText("90.00%")).toBeNull();
  });

  it("renders TARGETS-MET from the effective saved source when selected-year rows are still empty", async () => {
    const hydratedDraft = buildSubmission({
      id: "draft-empty-source",
      status: "draft",
      statusLabel: "Draft",
      indicators: [
        buildEnrollmentIndicator(3030),
        buildKpiIndicator({ targetValue: 98, actualValue: 99, complianceStatus: "met" }),
      ],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:05:00.000Z",
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
      allSubmissions: [],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => hydratedDraft),
      loadSubmissionsForYear: vi.fn(async () => []),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("workspace-panel")).not.toBeNull();
    });
    expect(screen.queryByText("3,030")).toBeNull();

    act(() => {
      schoolIndicatorPanelPropsMock?.onWorkspaceSubmissionHydrated?.(hydratedDraft, { source: "hydrated" });
    });

    await waitFor(() => {
      expect(screen.getByText("Source package: #draft-empty-source (Draft).")).not.toBeNull();
    });
    expect(screen.getByText("TARGETS-MET")).not.toBeNull();
    expect(screen.getByText("3,030")).not.toBeNull();
    expect(screen.getByText("98.00%")).not.toBeNull();
    expect(screen.getByText("99.00%")).not.toBeNull();
    expect(screen.queryByText("Submit your indicators to generate the report view.")).toBeNull();
  });

  it("does not render final TARGETS-MET blank rows while selected-year source data is loading", async () => {
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
      allSubmissions: [],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(),
      loadSubmissionsForYear: vi.fn(() => new Promise<IndicatorSubmission[]>(() => undefined)),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Loading saved report details...")).not.toBeNull();
    });
    expect(screen.getByText("TARGETS-MET")).not.toBeNull();
    expect(screen.getByText("Loading saved report details before showing TARGETS-MET values.")).not.toBeNull();
    expect(screen.queryByText("TOTAL NUMBER OF ENROLMENT")).toBeNull();
    expect(screen.queryByText("Net Enrollment Rate (NER)")).toBeNull();
    expect(screen.queryByText("Reference table structure only. Saved values appear here after save or final submit.")).toBeNull();
  });

  it("aligns TARGETS-MET immediately when a save callback belongs to a newer year and no manual year is selected", async () => {
    const finalized = buildSubmission({
      id: "finalized-old-year",
      academicYear: { id: "year-1", name: "2025-2026" },
      status: "submitted",
      statusLabel: "Submitted",
      indicators: [buildEnrollmentIndicator(1010)],
      items: [],
      submittedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    const yearTwoEnrollment = {
      ...buildEnrollmentIndicator(3030),
      id: "indicator-year-two-save",
      actualValue: 3030,
      actualTypedValue: {
        values: {
          "2026-2027": 3030,
        },
      },
      actualDisplay: "2026-2027: 3030.00",
    };
    const optimisticDraft = buildSubmission({
      id: "draft-new-year",
      academicYear: { id: "year-2", name: "2026-2027" },
      status: "draft",
      statusLabel: "Draft",
      indicators: [yearTwoEnrollment],
      items: [],
      submittedAt: null,
      updatedAt: "2026-05-10T00:05:00.000Z",
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
        { id: "year-2", name: "2026-2027", isCurrent: false },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => finalized),
      loadSubmissionsForYear: vi.fn(async () => [finalized]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #finalized-old-year (Submitted).")).not.toBeNull();
    });
    expect(screen.queryByText("3,030")).toBeNull();

    act(() => {
      schoolIndicatorPanelPropsMock?.onWorkspaceSubmissionHydrated?.(optimisticDraft, { source: "optimistic" });
    });

    await waitFor(() => {
      expect(screen.getByText("Source package: #draft-new-year (Draft).")).not.toBeNull();
    });
    expect(screen.getByText("TARGETS-MET")).not.toBeNull();
    expect(screen.getByText("3,030")).not.toBeNull();
    expect(screen.getByTestId("workspace-panel").getAttribute("data-selected-academic-year-id")).toBe("year-2");
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
      expect(screen.getByText("94.00%")).not.toBeNull();
    });

    indicatorDataState.lastSyncedAt = "2026-05-17T00:00:05.000Z";
    view.rerender(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(loadSubmissionsForYear).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText("2,024")).not.toBeNull();
    });
    expect(screen.getByText("96.00%")).not.toBeNull();
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
    expect(screen.getByText("94.00%")).not.toBeNull();

    indicatorDataState.allSubmissions = [staleSubmitted, fresherSubmitted];
    view.rerender(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("Source package: #submitted-fresh (Submitted).")).not.toBeNull();
    });
    expect(screen.getByText("2,024")).not.toBeNull();
    expect(screen.getByText("96.00%")).not.toBeNull();
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

  it("renders backend-approved legacy SALO values in TARGETS-MET school achievement rows", async () => {
    const currentSubmission = buildSubmission({
      id: "legacy-salo-101",
      academicYear: { id: "year-1", name: "2025-2026" },
      indicators: [buildLegacySaloIndicator("Angelie D. Marcos")],
      items: [],
      submittedAt: null,
      status: "draft",
      statusLabel: "Draft",
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
      expect(screen.getByText("Angelie D. Marcos")).not.toBeNull();
    });
    expect(screen.getByText("TARGETS-MET")).not.toBeNull();
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

  it("renders missing selected-year KPI values as dashes instead of scalar zero Met", async () => {
    const submitted = buildSubmission({
      id: "kpi-blank-101",
      indicators: [
        buildKpiIndicatorFor({
          code: "NER",
          name: "Net Enrollment Rate (NER)",
          complianceStatus: "met",
        }),
      ],
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
      records: [{
        schoolId: "school-1",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        address: "Herritage Bldg.",
      }],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    const row = await screen.findByText("Net Enrollment Rate (NER)");
    const cells = within(row.closest("tr") as HTMLTableRowElement).getAllByRole("cell");
    expect(cells[1]?.textContent?.trim()).toBe("-");
    expect(cells[2]?.textContent?.trim()).toBe("-");
    expect(cells[3]?.textContent?.trim()).toBe("-");
  });

  it("derives KPI status from selected-year target and actual values", async () => {
    const submitted = buildSubmission({
      id: "kpi-status-101",
      indicators: [
        buildKpiIndicatorFor({
          code: "NER",
          name: "Net Enrollment Rate (NER)",
          target: 0,
          actual: 0,
          comparison: "greater_or_equal",
          complianceStatus: "below_target",
        }),
        buildKpiIndicatorFor({
          code: "DR",
          name: "Drop-out Rate (DR)",
          target: 5,
          actual: 6,
          comparison: "less_or_equal",
          complianceStatus: "met",
        }),
        buildKpiIndicatorFor({
          code: "VIOLENCE_REPORT_RATE",
          name: "Learners Reporting School Violence",
          target: 5,
          actual: 4,
          comparison: "less_or_equal",
          complianceStatus: "below_target",
        }),
      ],
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
      records: [{
        schoolId: "school-1",
        schoolName: "AMA CC - Santiago City",
        schoolCode: "401777",
        address: "Herritage Bldg.",
      }],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });

    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submitted],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => submitted),
      loadSubmissionsForYear: vi.fn(async () => [submitted]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    render(<SchoolAdminDashboard />);

    const nerRow = await screen.findByText("Net Enrollment Rate (NER)");
    const nerCells = within(nerRow.closest("tr") as HTMLTableRowElement).getAllByRole("cell");
    expect(nerCells[1]?.textContent?.trim()).toBe("0.00%");
    expect(nerCells[2]?.textContent?.trim()).toBe("0.00%");
    expect(nerCells[3]?.textContent?.trim()).toBe("Met");

    const dropoutRow = await screen.findByText("Drop-out Rate (DR)");
    const dropoutCells = within(dropoutRow.closest("tr") as HTMLTableRowElement).getAllByRole("cell");
    expect(dropoutCells[1]?.textContent?.trim()).toBe("5.00%");
    expect(dropoutCells[2]?.textContent?.trim()).toBe("6.00%");
    expect(dropoutCells[3]?.textContent?.trim()).toBe("Not met");

    const violenceRow = await screen.findByText("Learners Reporting School Violence");
    const violenceCells = within(violenceRow.closest("tr") as HTMLTableRowElement).getAllByRole("cell");
    expect(violenceCells[1]?.textContent?.trim()).toBe("5.00%");
    expect(violenceCells[2]?.textContent?.trim()).toBe("4.00%");
    expect(violenceCells[3]?.textContent?.trim()).toBe("Met");
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
    const previewFetchCall = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>).find(([input]) => (
      String(input).includes("/api/submissions/file-101/view/bmef")
    ));
    expect(previewFetchCall).toBeTruthy();
    const [fetchInput, requestInit] = previewFetchCall as [RequestInfo | URL, RequestInit];
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
      scopeReviews: [
        {
          id: "review-file-verified",
          scopeType: "file",
          scopeId: "fm_qad_001",
          decision: "verified",
          notes: null,
          reviewedAt: "2026-07-04T00:00:00.000Z",
          updatedAt: "2026-07-04T00:00:00.000Z",
        },
        {
          id: "review-file-returned",
          scopeType: "file",
          scopeId: "fm_qad_002",
          decision: "returned",
          notes: "Please replace this file.",
          reviewedAt: "2026-07-04T00:05:00.000Z",
          updatedAt: "2026-07-04T00:05:00.000Z",
        },
        {
          id: "review-school-achievement",
          scopeType: "section",
          scopeId: "school_achievements_learning_outcomes",
          decision: "verified",
          notes: null,
          reviewedAt: "2026-07-04T00:10:00.000Z",
          updatedAt: "2026-07-04T00:10:00.000Z",
        },
        {
          id: "review-kpi",
          scopeType: "section",
          scopeId: "key_performance_indicators",
          decision: "verified",
          notes: null,
          reviewedAt: "2026-07-04T00:15:00.000Z",
          updatedAt: "2026-07-04T00:15:00.000Z",
        },
      ],
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
    const viewFmQadTwo = screen.getByRole("button", { name: /View FM-QAD-002 Report/i }) as HTMLButtonElement;
    expect(viewFmQadTwo.disabled).toBe(true);
    const fmQadOneCard = viewFmQadOne.closest("article");
    const fmQadTwoCard = viewFmQadTwo.closest("article");
    expect(fmQadOneCard).not.toBeNull();
    expect(fmQadTwoCard).not.toBeNull();
    expect(within(fmQadOneCard as HTMLElement).getByText("Verified")).not.toBeNull();
    expect(within(fmQadTwoCard as HTMLElement).getByText("Returned")).not.toBeNull();
    expect((viewFmQadOne as HTMLButtonElement).disabled).toBe(false);
    const schoolAchievementHeader = screen.getByText(/School's Achievement \(SY 2025-2026\)/i).closest("div");
    const kpiHeader = screen.getByText(/Key Performance Indicators \(SY 2025-2026\)/i).closest("div");
    expect(schoolAchievementHeader).not.toBeNull();
    expect(kpiHeader).not.toBeNull();
    expect(within(schoolAchievementHeader as HTMLElement).getByText("Verified")).not.toBeNull();
    expect(within(kpiHeader as HTMLElement).getByText("Verified")).not.toBeNull();
    expect(screen.queryByText("This file or indicator has been verified.")).toBeNull();
    expect(screen.queryByText("BMEF Report")).toBeNull();
    expect(screen.queryByText("SMEA Report")).toBeNull();

    fireEvent.click(viewFmQadOne);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const previewFetchCall = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>).find(([input]) => (
      String(input).includes("/api/submissions/private-file-101/view/fm_qad_001")
    ));
    expect(previewFetchCall).toBeTruthy();
    const [fetchInput, requestInit] = previewFetchCall as [RequestInfo | URL, RequestInit];
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

  it("keeps the newest saved report file card across save and login cycles", async () => {
    const lightweightDraft = buildSubmission({
      id: "private-file-loop-101",
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
    const savedFileDraft = buildSubmission({
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
          originalFilename: "latest-fm-qad-001.pdf",
          sizeBytes: 4096,
          uploadedAt: "2026-06-06T01:05:00.000Z",
          downloadUrl: "/api/submissions/private-file-loop-101/download/fm_qad_001",
          viewUrl: "/api/submissions/private-file-loop-101/view/fm_qad_001",
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

    const fetchSubmission = vi.fn(async () => lightweightDraft);
    const loadSubmissionsForYear = vi.fn(async () => [lightweightDraft]);
    const indicatorDataState = {
      submissions: [],
      allSubmissions: [lightweightDraft],
      academicYears: [
        { id: "year-1", name: "2025-2026", isCurrent: true },
      ],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission,
      loadSubmissionsForYear,
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    };

    useIndicatorDataMock.mockImplementation(() => indicatorDataState);

    const firstLogin = render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("workspace-panel")).not.toBeNull();
    });
    expect(screen.queryByText("latest-fm-qad-001.pdf")).toBeNull();

    act(() => {
      schoolIndicatorPanelPropsMock?.onWorkspaceSubmissionHydrated?.(savedFileDraft, { source: "hydrated" });
    });

    await waitFor(() => {
      expect(screen.getByText("latest-fm-qad-001.pdf")).not.toBeNull();
    });
    expect((screen.getByRole("button", { name: /View FM-QAD-001 Report/i }) as HTMLButtonElement).disabled).toBe(false);

    firstLogin.unmount();
    schoolIndicatorPanelPropsMock = null;
    fetchSubmission.mockImplementation(async () => savedFileDraft);
    loadSubmissionsForYear.mockImplementation(async () => [lightweightDraft]);
    indicatorDataState.allSubmissions = [lightweightDraft];

    render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("private-file-loop-101");
    });

    await waitFor(() => {
      expect(screen.getByText("latest-fm-qad-001.pdf")).not.toBeNull();
    });
    expect((screen.getByRole("button", { name: /View FM-QAD-001 Report/i }) as HTMLButtonElement).disabled).toBe(false);
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

  it("keeps the School Head dashboard focused on reports and the workspace without audit panels", async () => {
    const submission = buildSubmission({
      id: "focused-workspace-101",
      status: "draft",
      statusLabel: "Draft",
      submittedAt: null,
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
      records: [{ schoolId: "school-1", schoolName: "AMA CC - Santiago City", schoolCode: "401777", address: "Herritage Bldg." }],
      error: "",
      lastSyncedAt: "2026-05-17T00:00:00.000Z",
      syncScope: "records",
      syncStatus: "up_to_date",
      refreshRecords: refreshRecordsMock,
    });
    useIndicatorDataMock.mockReturnValue({
      submissions: [],
      allSubmissions: [submission],
      academicYears: [{ id: "year-1", name: "2025-2026", isCurrent: true }],
      downloadSubmissionFile: vi.fn(),
      fetchSubmission: vi.fn(async () => submission),
      loadSubmissionsForYear: vi.fn(async () => [submission]),
      refreshAllSubmissions: refreshAllSubmissionsMock,
      refreshSubmissions: refreshSubmissionsMock,
    });

    const view = render(<SchoolAdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("workspace-panel")).not.toBeNull();
      expect(screen.getByText("TARGETS-MET")).not.toBeNull();
    });
    expect(view.container.querySelector("#school-head-recent-activity")).toBeNull();
    expect(view.container.querySelector("#school-head-security-activity")).toBeNull();
    expect(screen.queryByText("Recent Activity")).toBeNull();
    expect(screen.queryByText("Security Activity")).toBeNull();
  });
});
