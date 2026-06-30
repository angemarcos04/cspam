import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorSchoolDrawer } from "@/pages/monitor/MonitorSchoolDrawer";

const downloadSubmissionFileMock = vi.hoisted(() => vi.fn());
const reviewSubmissionScopeMock = vi.hoisted(() => vi.fn());

vi.mock("@/context/Auth", () => ({
  useAuth: () => ({
    apiToken: "monitor-token",
  }),
}));

vi.mock("@/context/IndicatorData", () => ({
  useIndicatorData: () => ({
    downloadSubmissionFile: downloadSubmissionFileMock,
    reviewSubmissionScope: reviewSubmissionScopeMock,
  }),
}));

describe("MonitorSchoolDrawer", () => {
  afterEach(() => {
    downloadSubmissionFileMock.mockReset();
    reviewSubmissionScopeMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  function reviewableDrawerProps(
    packageRow: NonNullable<Parameters<typeof MonitorSchoolDrawer>[0]["data"]["schoolDrawerYearDetail"]>["packageRows"][number],
    actionOverrides: Partial<Parameters<typeof MonitorSchoolDrawer>[0]["actions"]> = {},
  ): Parameters<typeof MonitorSchoolDrawer>[0] {
    return {
      viewState: {
        isOpen: true,
        showNavigatorManual: true,
        isMobileViewport: false,
        activeTopNavigator: "schools",
        activeSchoolDrawerTab: "submissions",
        selectedSchoolDrawerYear: "2025-2026",
        highlightedDrawerIndicatorKey: null,
        expandedDrawerIndicatorRows: {},
      },
      loadingState: {
        syncedCountsLoadingSchoolKey: null,
        syncedCountsError: "",
        isSchoolDrawerSubmissionsLoading: false,
        schoolDrawerSubmissionsError: "",
      },
      data: {
        schoolDetail: {
          schoolKey: "school-1",
          schoolCode: "401777",
          schoolName: "AMA CC - Santiago City",
          region: "II",
          level: "High School",
          type: "Private",
          schoolTypeRaw: "private",
          requirementModeLabel: "Active package requirements: FM-QAD uploads only.",
          activePackageLabel: "FM-QAD uploads only",
          address: "N/A",
          hasComplianceRecord: true,
          indicatorStatus: "submitted",
          hasActivePackageSubmission: true,
          missingCount: 0,
          awaitingReviewCount: 1,
          lastActivityAt: null,
          reportedStudents: 0,
          reportedTeachers: 0,
          synchronizedStudents: 0,
          synchronizedTeachers: 0,
        },
        availableSchoolDrawerYears: [{ id: "2025-2026", label: "2025-2026" }],
        schoolDrawerYearDetail: {
          selectedYearLabel: "2025-2026",
          availableYears: [{ id: "2025-2026", label: "2025-2026" }],
          currentIssueLabel: "Awaiting monitor review.",
          currentIssueTone: "info",
          checklistItems: [],
          packageRows: [packageRow],
          checklistCompleteCount: 0,
          checklistMissingCount: 0,
          selectedYearLatestSubmissionId: "sub-1",
          selectedYearLatestStatus: "draft",
          finalizedReportSubmission: null,
          reportSourceContext: [],
          reportBlankStateLines: ["No monitor-visible report package exists yet.", "Sent values appear after School Head sends a scope."],
          schoolAchievementRows: [],
          kpiRows: [],
        },
        schoolDrawerHistorySummary: null,
        schoolDrawerCriticalAlerts: [],
        schoolIndicatorPackageRows: [],
        latestSchoolPackage: null,
        schoolIndicatorMatrix: { years: [], rows: [], latestSubmission: null },
        latestSchoolIndicatorYear: "",
        schoolDrawerIndicatorSubmissions: [],
        schoolIndicatorRowsByCategory: [],
        missingDrawerIndicatorKeys: [],
        returnedDrawerIndicatorKeys: [],
        missingDrawerIndicatorKeySet: new Set(),
        returnedDrawerIndicatorKeySet: new Set(),
      },
      actions: {
        setActiveSchoolDrawerTab: vi.fn(),
        setSelectedSchoolDrawerYear: vi.fn(),
        closeSchoolDrawer: vi.fn(),
        handleJumpToMissingIndicators: vi.fn(),
        handleJumpToReturnedIndicators: vi.fn(),
        toggleDrawerIndicatorLabel: vi.fn(),
        ...actionOverrides,
      },
      formatting: {
        workflowTone: () => "",
        workflowLabel: (status: string | null) => status ?? "N/A",
        formatDateTime: () => "N/A",
      },
    };
  }

  it("keeps submissions as the main page and history as secondary reference", async () => {
    const setActiveSchoolDrawerTab = vi.fn();
    render(
      <MonitorSchoolDrawer
        viewState={{
          isOpen: true,
          showNavigatorManual: true,
          isMobileViewport: false,
          activeTopNavigator: "schools",
          activeSchoolDrawerTab: "submissions",
          selectedSchoolDrawerYear: "2025-2026",
          highlightedDrawerIndicatorKey: null,
          expandedDrawerIndicatorRows: {},
        }}
        loadingState={{
          syncedCountsLoadingSchoolKey: null,
          syncedCountsError: "",
          isSchoolDrawerSubmissionsLoading: false,
          schoolDrawerSubmissionsError: "",
        }}
        data={{
          schoolDetail: {
            schoolKey: "school-1",
            schoolCode: "401777",
            schoolName: "AMA CC - Santiago City",
            region: "II",
            level: "High School",
            type: "Private",
            schoolTypeRaw: "private",
            requirementModeLabel: "Active package requirements: FM-QAD uploads only.",
            activePackageLabel: "FM-QAD uploads only",
            address: "N/A",
            hasComplianceRecord: true,
            indicatorStatus: "submitted",
            hasActivePackageSubmission: true,
            missingCount: 0,
            awaitingReviewCount: 1,
            lastActivityAt: null,
            reportedStudents: 0,
            reportedTeachers: 0,
            synchronizedStudents: 0,
            synchronizedTeachers: 0,
          },
          availableSchoolDrawerYears: [{ id: "2025-2026", label: "2025-2026" }],
          schoolDrawerYearDetail: {
            selectedYearLabel: "2025-2026",
            availableYears: [{ id: "2025-2026", label: "2025-2026" }],
            currentIssueLabel: "Awaiting monitor review.",
            currentIssueTone: "info",
            checklistItems: [
              { id: "school_achievements", label: "School Achievements", statusLabel: "For Review", tone: "info", detail: "Section values are available for this year.", kind: "section" },
              { id: "fm_qad_001", label: "FM-QAD-001", statusLabel: "For Review", tone: "info", detail: "File is present for the selected year.", kind: "file" },
            ],
            packageRows: [
              {
                id: "school_achievements",
                label: "School Achievements",
                kind: "section",
                statusLabel: "For Review",
                tone: "info",
                submittedAt: "2026-06-03T08:00:00.000Z",
                detail: "Section values are available for this year.",
                viewUrl: null,
                downloadUrl: null,
                actionLabel: "View School Achievements",
                actionTarget: "school_achievements",
                canReview: true,
              },
              {
                id: "fm_qad_001",
                label: "FM-QAD-001",
                kind: "file",
                statusLabel: "For Review",
                tone: "info",
                submittedAt: "2026-06-03T08:00:00.000Z",
                detail: "fm-qad-001.pdf",
                viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
                downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
                actionLabel: "View FM-QAD-001",
              },
            ],
            checklistCompleteCount: 0,
            checklistMissingCount: 0,
            selectedYearLatestSubmissionId: "sub-1",
            selectedYearLatestStatus: "submitted",
            finalizedReportSubmission: null,
            reportSourceContext: ["Viewing finalized submitted report for SY 2025-2026.", "Source package: None yet.", "Status: Reference only."],
            reportBlankStateLines: [
              "No finalized submitted report package exists yet for the selected academic year.",
              "The report tables are shown for reference. Finalized values will appear here after you submit the package.",
            ],
            schoolAchievementRows: [{ key: "a1", label: "NAME OF SCHOOL HEAD", value: "-" }],
            kpiRows: [{ key: "k1", label: "Net Enrollment Rate", target: "-", actual: "-", status: "-" }],
          },
          schoolDrawerHistorySummary: null,
          schoolDrawerCriticalAlerts: [],
          schoolIndicatorPackageRows: [],
          latestSchoolPackage: null,
          schoolIndicatorMatrix: { years: [], rows: [], latestSubmission: null },
          latestSchoolIndicatorYear: "",
          schoolDrawerIndicatorSubmissions: [],
          schoolIndicatorRowsByCategory: [],
          missingDrawerIndicatorKeys: [],
          returnedDrawerIndicatorKeys: [],
          missingDrawerIndicatorKeySet: new Set(),
          returnedDrawerIndicatorKeySet: new Set(),
        }}
        actions={{
          setActiveSchoolDrawerTab,
          setSelectedSchoolDrawerYear: vi.fn(),
          closeSchoolDrawer: vi.fn(),
          handleJumpToMissingIndicators: vi.fn(),
          handleJumpToReturnedIndicators: vi.fn(),
          toggleDrawerIndicatorLabel: vi.fn(),
        }}
        formatting={{
          workflowTone: () => "",
          workflowLabel: (status) => status ?? "N/A",
          formatDateTime: () => "N/A",
        }}
      />,
    );

    expect(screen.getByLabelText("Monitor school detail academic year")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submissions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Indicator History" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Snapshot" })).toBeNull();
    expect(screen.queryByText("Submitted Packages")).toBeNull();
    expect(screen.queryByText(/Required files and form sections/i)).toBeNull();
    expect(screen.queryByText("Package status")).toBeNull();
    expect(screen.queryByText("Critical Alerts")).toBeNull();
    expect(screen.queryByText("Missing Indicators")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Requirement" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Submitted" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View School Achievements" })).toBeNull();
    expect(screen.queryByRole("button", { name: "View FM-QAD-001" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    expect(setActiveSchoolDrawerTab).toHaveBeenCalledWith("history");
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    expect(screen.queryByRole("link", { name: "View FM-QAD-001" })).toBeNull();

    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["pdf"], { type: "application/pdf" }), { status: 200 }));
    const createObjectURL = vi.fn(() => "blob:monitor-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    fireEvent.click(screen.getAllByRole("button", { name: "View" })[1]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/submissions/sub-1/view/fm_qad_001",
        expect.objectContaining({
          credentials: "omit",
          method: "GET",
        }),
      );
    });
    const requestOptions = fetchMock.mock.calls[0]?.[1] as { headers?: Headers };
    expect(requestOptions.headers?.get("Authorization")).toBe("Bearer monitor-token");
    expect(await screen.findByTitle("FM-QAD-001 PDF preview")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(downloadSubmissionFileMock).toHaveBeenCalledWith("sub-1", "fm_qad_001");
    expect(screen.queryByText("Year Checklist")).toBeNull();
    expect(screen.queryByText("Submitted Report View")).toBeNull();
    expect(screen.queryByText("Data Sync")).toBeNull();
    expect(screen.queryByText("Critical Alerts")).toBeNull();
    expect(screen.queryByText("Active Package Context")).toBeNull();
    expect(screen.queryByText("Monitor Package")).toBeNull();
    expect(screen.queryByText("Active package requirements: FM-QAD uploads only.")).toBeNull();
    expect(screen.queryByText(/Compliance is submitted\. Active private package/i)).toBeNull();
  });

  it("keeps monitor file view disabled when the file is missing from storage", () => {
    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps({
          id: "fm_qad_001",
          submissionId: "sub-1",
          label: "FM-QAD-001",
          kind: "file",
          statusLabel: "For Review",
          tone: "info",
          submittedAt: "2026-06-14T06:39:00.000Z",
          detail: "fm-qad-001.pdf",
          available: false,
          missingFromStorage: true,
          fileUnavailableReason: "The submitted file record exists, but the stored file is missing. Ask the school to re-upload and resend it.",
          viewUrl: null,
          downloadUrl: null,
          actionLabel: null,
          actionTarget: null,
          canReview: false,
        })}
      />,
    );

    const viewButton = screen.getByRole("button", { name: "View" }) as HTMLButtonElement;
    const verifyButton = screen.getByRole("button", { name: "Verify" }) as HTMLButtonElement;
    const returnButton = screen.getByRole("button", { name: "Return" }) as HTMLButtonElement;
    expect(viewButton.disabled).toBe(true);
    expect(viewButton.title).toBe("The submitted file record exists, but the stored file is missing. Ask the school to re-upload and resend it.");
    expect(screen.getByText("The submitted file record exists, but the stored file is missing. Ask the school to re-upload and resend it.")).toBeTruthy();
    expect(verifyButton.disabled).toBe(true);
    expect(returnButton.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("keeps the no-indicator-data history state plain without package details", () => {
    render(
      <MonitorSchoolDrawer
        viewState={{
          isOpen: true,
          showNavigatorManual: true,
          isMobileViewport: false,
          activeTopNavigator: "schools",
          activeSchoolDrawerTab: "history",
          selectedSchoolDrawerYear: "2025-2026",
          highlightedDrawerIndicatorKey: null,
          expandedDrawerIndicatorRows: {},
        }}
        loadingState={{
          syncedCountsLoadingSchoolKey: null,
          syncedCountsError: "",
          isSchoolDrawerSubmissionsLoading: false,
          schoolDrawerSubmissionsError: "",
        }}
        data={{
          schoolDetail: {
            schoolKey: "school-1",
            schoolCode: "401777",
            schoolName: "AMA CC - Santiago City",
            region: "II",
            level: "High School",
            type: "Private",
            schoolTypeRaw: "private",
            requirementModeLabel: "Active package requirements: FM-QAD uploads only.",
            activePackageLabel: "FM-QAD uploads only",
            address: "N/A",
            hasComplianceRecord: true,
            indicatorStatus: "submitted",
            hasActivePackageSubmission: true,
            missingCount: 0,
            awaitingReviewCount: 1,
            lastActivityAt: null,
            reportedStudents: 0,
            reportedTeachers: 0,
            synchronizedStudents: 0,
            synchronizedTeachers: 0,
          },
          availableSchoolDrawerYears: [{ id: "2025-2026", label: "2025-2026" }],
          schoolDrawerYearDetail: null,
          schoolDrawerHistorySummary: {
            historyPackageCount: 1,
            historySchoolYearCount: 1,
            latestHistoryPackageId: "5",
            latestHistorySchoolYear: "2026-2027",
            latestRenderableSubmissionId: null,
            latestRenderableSchoolYear: null,
            packagesWithRenderableRowsCount: 0,
            packagesWithoutRenderableRowsCount: 1,
            historyAvailabilityLabel: "No indicator data available yet",
            historyExplanation: "A package exists for this school, but it has no indicator data to display.",
            historyFallbackReason: "This package has no indicator data to display.",
          },
          schoolDrawerCriticalAlerts: [],
          schoolIndicatorPackageRows: [
            {
              id: "5",
              schoolYear: "2026-2027",
              reportingPeriod: "ANNUAL",
              status: "submitted",
              submittedAt: "2026-06-04T11:11:00.000Z",
              reviewedAt: null,
              updatedAt: "2026-06-04T11:11:00.000Z",
              complianceRatePercent: null,
              reviewedBy: "N/A",
            },
          ],
          latestSchoolPackage: {
            id: "5",
            schoolYear: "2026-2027",
            reportingPeriod: "ANNUAL",
            status: "submitted",
            submittedAt: "2026-06-04T11:11:00.000Z",
            reviewedAt: null,
            updatedAt: "2026-06-04T11:11:00.000Z",
            complianceRatePercent: null,
            reviewedBy: "N/A",
          },
          schoolIndicatorMatrix: { years: [], rows: [], latestSubmission: null },
          latestSchoolIndicatorYear: "2026-2027",
          schoolDrawerIndicatorSubmissions: [
            {
              id: "5",
              formType: "indicator",
              status: "submitted",
              statusLabel: "Submitted",
              reportingPeriod: "ANNUAL",
              version: 1,
              notes: null,
              reviewNotes: null,
              submittedAt: "2026-06-04T11:11:00.000Z",
              reviewedAt: null,
              createdAt: "2026-06-04T11:00:00.000Z",
              updatedAt: "2026-06-04T11:11:00.000Z",
              summary: { totalIndicators: 0, metIndicators: 0, belowTargetIndicators: 0, complianceRatePercent: 0 },
              indicators: [],
              academicYear: { id: "year-2", name: "2026-2027" },
            } as never,
          ],
          schoolIndicatorRowsByCategory: [],
          missingDrawerIndicatorKeys: [],
          returnedDrawerIndicatorKeys: [],
          missingDrawerIndicatorKeySet: new Set(),
          returnedDrawerIndicatorKeySet: new Set(),
        }}
        actions={{
          setActiveSchoolDrawerTab: vi.fn(),
          setSelectedSchoolDrawerYear: vi.fn(),
          closeSchoolDrawer: vi.fn(),
          handleJumpToMissingIndicators: vi.fn(),
          handleJumpToReturnedIndicators: vi.fn(),
          toggleDrawerIndicatorLabel: vi.fn(),
        }}
        formatting={{
          workflowTone: () => "",
          workflowLabel: (status) => status ?? "N/A",
          formatDateTime: () => "6/4/2026 11:11 AM",
        }}
      />,
    );

    expect(screen.getByText("No monitor-visible submitted report package exists yet for the selected academic year.")).toBeTruthy();
    expect(screen.queryByText("This package has no indicator data to display.")).toBeNull();
    expect(screen.queryByText("No indicator data available yet")).toBeNull();
    expect(screen.queryByText("Packages exist, but none contain indicator rows for history rendering.")).toBeNull();
    expect(screen.queryByText("History Source")).toBeNull();
    expect(screen.queryByText(/Matrix source year:/)).toBeNull();
    expect(screen.queryByText("Historical Indicator Matrix")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Package" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show package details" })).toBeNull();
    expect(screen.queryByText(/Latest package year:/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Reviewed" })).toBeNull();
    expect(screen.queryByText(/Matrix source year:/)).toBeNull();
    expect(screen.queryByText("Historical Indicator Matrix")).toBeNull();
  });

  it("renders report-style tables in indicator history and keeps the matrix collapsed", () => {
    render(
      <MonitorSchoolDrawer
        viewState={{
          isOpen: true,
          showNavigatorManual: true,
          isMobileViewport: false,
          activeTopNavigator: "reviews",
          activeSchoolDrawerTab: "history",
          selectedSchoolDrawerYear: "2025-2026",
          highlightedDrawerIndicatorKey: null,
          expandedDrawerIndicatorRows: {},
        }}
        loadingState={{
          syncedCountsLoadingSchoolKey: null,
          syncedCountsError: "",
          isSchoolDrawerSubmissionsLoading: false,
          schoolDrawerSubmissionsError: "",
        }}
        data={{
          schoolDetail: {
            schoolKey: "school-1",
            schoolCode: "401777",
            schoolName: "AMA CC - Santiago City",
            region: "II",
            level: "High School",
            type: "Public",
            schoolTypeRaw: "public",
            requirementModeLabel: "",
            activePackageLabel: "",
            address: "N/A",
            hasComplianceRecord: true,
            indicatorStatus: "submitted",
            hasActivePackageSubmission: true,
            missingCount: 0,
            awaitingReviewCount: 1,
            lastActivityAt: null,
            reportedStudents: 0,
            reportedTeachers: 0,
            synchronizedStudents: 0,
            synchronizedTeachers: 0,
          },
          availableSchoolDrawerYears: [{ id: "2025-2026", label: "2025-2026" }],
          schoolDrawerYearDetail: {
            selectedYearLabel: "2025-2026",
            availableYears: [{ id: "2025-2026", label: "2025-2026" }],
            currentIssueLabel: "Awaiting monitor review.",
            currentIssueTone: "info",
            checklistItems: [],
            packageRows: [],
            checklistCompleteCount: 2,
            checklistMissingCount: 0,
            selectedYearLatestSubmissionId: "sub-2025",
            selectedYearLatestStatus: "submitted",
            finalizedReportSubmission: null,
            reportSourceContext: ["Viewing monitor-visible report data for SY 2025-2026.", "Source package: #sub-2025 (Submitted)."],
            reportBlankStateLines: [
              "No finalized submitted report package exists yet for the selected academic year.",
              "The report tables are shown for reference.",
            ],
            schoolAchievementRows: [{ key: "head", label: "NAME OF SCHOOL HEAD", value: "Jane Doe" }],
            kpiRows: [{ key: "ner", label: "Net Enrollment Rate", target: "100.00%", actual: "98.00%", status: "met" }],
          },
          schoolDrawerHistorySummary: {
            historyPackageCount: 1,
            historySchoolYearCount: 1,
            latestHistoryPackageId: "sub-2025",
            latestHistorySchoolYear: "2025-2026",
            latestRenderableSubmissionId: "sub-2025",
            latestRenderableSchoolYear: "2025-2026",
            packagesWithRenderableRowsCount: 1,
            packagesWithoutRenderableRowsCount: 0,
            historyAvailabilityLabel: "Historical indicator detail available",
            historyExplanation: "Showing the most recent package with renderable indicator rows.",
            historyFallbackReason: null,
          },
          schoolDrawerCriticalAlerts: [],
          schoolIndicatorPackageRows: [
            {
              id: "sub-2025",
              schoolYear: "2025-2026",
              reportingPeriod: "ANNUAL",
              status: "submitted",
              submittedAt: "2026-06-04T11:11:00.000Z",
              reviewedAt: null,
              updatedAt: "2026-06-04T11:11:00.000Z",
              complianceRatePercent: null,
              reviewedBy: "",
            },
          ],
          latestSchoolPackage: null,
          schoolIndicatorMatrix: {
            years: ["2025-2026"],
            latestSubmission: null,
            rows: [
              {
                key: "NER",
                code: "NER",
                label: "Net Enrollment Rate",
                category: "KEY PERFORMANCE INDICATORS",
                sortOrder: 1,
                valuesByYear: { "2025-2026": { target: "100.00%", actual: "98.00%" } },
              },
            ],
          },
          latestSchoolIndicatorYear: "2025-2026",
          schoolDrawerIndicatorSubmissions: [],
          schoolIndicatorRowsByCategory: [
            {
              category: "KEY PERFORMANCE INDICATORS",
              rows: [
                {
                  key: "NER",
                  code: "NER",
                  label: "Net Enrollment Rate",
                  category: "KEY PERFORMANCE INDICATORS",
                  sortOrder: 1,
                  valuesByYear: { "2025-2026": { target: "100.00%", actual: "98.00%" } },
                },
              ],
            },
          ],
          missingDrawerIndicatorKeys: ["NER"],
          returnedDrawerIndicatorKeys: ["NER"],
          missingDrawerIndicatorKeySet: new Set(["NER"]),
          returnedDrawerIndicatorKeySet: new Set(["NER"]),
        }}
        actions={{
          setActiveSchoolDrawerTab: vi.fn(),
          setSelectedSchoolDrawerYear: vi.fn(),
          closeSchoolDrawer: vi.fn(),
          handleJumpToMissingIndicators: vi.fn(),
          handleJumpToReturnedIndicators: vi.fn(),
          toggleDrawerIndicatorLabel: vi.fn(),
        }}
        formatting={{
          workflowTone: () => "",
          workflowLabel: (status) => status ?? "N/A",
          formatDateTime: () => "N/A",
        }}
      />,
    );

    expect(screen.getByText("TARGETS-MET")).toBeTruthy();
    expect(screen.queryByText("Monitor-visible completion: 2/2 complete")).toBeNull();
    expect(screen.queryByText("Values appear here only after the School Head sends a section/file or submits the full package.")).toBeNull();
    expect(screen.queryByText(/Viewing monitor-visible report data/)).toBeNull();
    expect(screen.queryByText(/Source package:/)).toBeNull();
    expect(screen.queryByText(/Sent workspace items:/)).toBeNull();
    expect(screen.queryByText("Submitted Report View")).toBeNull();
    expect(screen.queryByText("History Summary")).toBeNull();
    expect(screen.queryByText("Package History Context")).toBeNull();
    expect(screen.getByText("School's Achievement (SY 2025-2026)")).toBeTruthy();
    expect(screen.getByText("Key Performance Indicators (SY 2025-2026)")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("98.00%")).toBeTruthy();
    expect(screen.queryByText("Historical Indicator Matrix")).toBeNull();
    expect(screen.queryByRole("button", { name: /Jump to Missing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Jump to Returned/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show package details" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Package" })).toBeNull();
    expect(screen.queryByText(/Latest package year:/)).toBeNull();
    expect(screen.queryByText("Historical Indicator Matrix")).toBeNull();
    expect(screen.queryByText("Matrix source")).toBeNull();
  });

  it("keeps the rendered checklist and report tied to the selected year context", () => {
    const baseProps: Parameters<typeof MonitorSchoolDrawer>[0] = {
      viewState: {
        isOpen: true,
        showNavigatorManual: true,
        isMobileViewport: false,
        activeTopNavigator: "schools" as const,
        activeSchoolDrawerTab: "submissions" as const,
        selectedSchoolDrawerYear: "2025-2026",
        highlightedDrawerIndicatorKey: null,
        expandedDrawerIndicatorRows: {},
      },
      loadingState: {
        syncedCountsLoadingSchoolKey: null,
        syncedCountsError: "",
        isSchoolDrawerSubmissionsLoading: false,
        schoolDrawerSubmissionsError: "",
      },
      data: {
        schoolDetail: {
          schoolKey: "school-1",
          schoolCode: "401777",
          schoolName: "AMA CC - Santiago City",
          region: "II",
          level: "High School",
          type: "Public",
          schoolTypeRaw: "public",
          requirementModeLabel: "",
          activePackageLabel: "",
          address: "N/A",
          hasComplianceRecord: true,
          indicatorStatus: "validated",
          hasActivePackageSubmission: true,
          missingCount: 0,
          awaitingReviewCount: 0,
          lastActivityAt: null,
          reportedStudents: 0,
          reportedTeachers: 0,
          synchronizedStudents: 0,
          synchronizedTeachers: 0,
        },
        availableSchoolDrawerYears: [
          { id: "2026-2027", label: "2026-2027" },
          { id: "2025-2026", label: "2025-2026" },
        ],
        schoolDrawerYearDetail: {
          selectedYearLabel: "2025-2026",
          availableYears: [{ id: "2025-2026", label: "2025-2026" }],
          currentIssueLabel: "Submission validated.",
          currentIssueTone: "success",
          checklistItems: [
            { id: "school_achievements", label: "School Achievements", statusLabel: "Complete", tone: "success", detail: "Section values are available for this year.", kind: "section" },
            { id: "bmef", label: "BMEF", statusLabel: "Uploaded", tone: "success", detail: "File is present for the selected year.", kind: "file" },
          ],
          packageRows: [
            {
              id: "school_achievements",
              label: "School Achievements",
              kind: "section",
              statusLabel: "Complete",
              tone: "success",
              submittedAt: "2026-06-03T08:00:00.000Z",
              detail: "Section values are available for this year.",
              viewUrl: null,
              downloadUrl: null,
              actionLabel: null,
            },
            {
              id: "bmef",
              label: "BMEF",
              kind: "file",
              statusLabel: "Uploaded",
              tone: "success",
              submittedAt: "2026-06-03T08:00:00.000Z",
              detail: "bmef.pdf",
              viewUrl: "/api/submissions/sub-2025/view/bmef",
              downloadUrl: "/api/submissions/sub-2025/download/bmef",
              actionLabel: "View BMEF",
            },
          ],
          checklistCompleteCount: 2,
          checklistMissingCount: 0,
          selectedYearLatestSubmissionId: "sub-2025",
          selectedYearLatestStatus: "validated",
          finalizedReportSubmission: null,
          reportSourceContext: ["Viewing finalized submitted report for SY 2025-2026."],
          reportBlankStateLines: [
            "No finalized submitted report package exists yet for the selected academic year.",
            "The report tables are shown for reference. Finalized values will appear here after you submit the package.",
          ],
          schoolAchievementRows: [{ key: "a1", label: "NAME OF SCHOOL HEAD", value: "Jane Doe" }],
          kpiRows: [{ key: "k1", label: "Net Enrollment Rate", target: "100.00%", actual: "98.00%", status: "met" }],
        },
        schoolDrawerHistorySummary: null,
        schoolDrawerCriticalAlerts: [],
        schoolIndicatorPackageRows: [],
        latestSchoolPackage: null,
        schoolIndicatorMatrix: { years: [], rows: [], latestSubmission: null },
        latestSchoolIndicatorYear: "",
        schoolDrawerIndicatorSubmissions: [],
        schoolIndicatorRowsByCategory: [],
        missingDrawerIndicatorKeys: [],
        returnedDrawerIndicatorKeys: [],
        missingDrawerIndicatorKeySet: new Set(),
        returnedDrawerIndicatorKeySet: new Set(),
      },
      actions: {
        setActiveSchoolDrawerTab: vi.fn(),
        setSelectedSchoolDrawerYear: vi.fn(),
        closeSchoolDrawer: vi.fn(),
        handleJumpToMissingIndicators: vi.fn(),
        handleJumpToReturnedIndicators: vi.fn(),
        toggleDrawerIndicatorLabel: vi.fn(),
      },
      formatting: {
        workflowTone: () => "",
        workflowLabel: (status: string | null) => status ?? "N/A",
        formatDateTime: () => "N/A",
      },
    };

    const { rerender } = render(<MonitorSchoolDrawer {...baseProps} />);
    const nextYearDetail = {
      ...baseProps.data.schoolDrawerYearDetail!,
      selectedYearLabel: "2026-2027",
      selectedYearLatestSubmissionId: "sub-2026",
      reportSourceContext: ["Viewing finalized submitted report for SY 2026-2027."],
      packageRows: [
        {
          id: "school_achievements",
          label: "School Achievements",
          kind: "section" as const,
          statusLabel: "Complete" as const,
          tone: "success" as const,
          submittedAt: "2027-06-03T08:00:00.000Z",
          detail: "Section values are available for this year.",
          viewUrl: null,
          downloadUrl: null,
          actionLabel: null,
        },
        {
          id: "bmef",
          label: "BMEF",
          kind: "file" as const,
          statusLabel: "Uploaded" as const,
          tone: "success" as const,
          submittedAt: "2027-06-03T08:00:00.000Z",
          detail: "bmef-2026.pdf",
          viewUrl: "/api/submissions/sub-2026/view/bmef",
          downloadUrl: "/api/submissions/sub-2026/download/bmef",
          actionLabel: "View BMEF",
        },
      ],
      schoolAchievementRows: [{ key: "a2", label: "NAME OF SCHOOL HEAD", value: "John Doe" }],
      kpiRows: [{ key: "k2", label: "Net Enrollment Rate", target: "100.00%", actual: "99.00%", status: "met" }],
    };

    expect((screen.getByLabelText("Monitor school detail academic year") as HTMLSelectElement).value).toBe("2025-2026");
    expect(screen.queryByText("Viewing SY 2025-2026.")).toBeNull();
    expect(screen.getByText("bmef.pdf")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View BMEF" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "View" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();

    rerender(
      <MonitorSchoolDrawer
        {...baseProps}
        viewState={{
          ...baseProps.viewState,
          selectedSchoolDrawerYear: "2026-2027",
        }}
        data={{
          ...baseProps.data,
          schoolDrawerYearDetail: nextYearDetail,
        }}
      />,
    );

    expect((screen.getByLabelText("Monitor school detail academic year") as HTMLSelectElement).value).toBe("2026-2027");
    expect(screen.queryByText("Viewing SY 2026-2027.")).toBeNull();
    expect(screen.getByText("bmef-2026.pdf")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "View BMEF" })).toBeNull();
    expect(screen.queryByText("bmef.pdf")).toBeNull();
  });

  it("refreshes monitor review data when a file preview becomes forbidden", async () => {
    const onReviewDataChanged = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps(
          {
            id: "fm_qad_001",
            submissionId: "sub-1",
            label: "FM-QAD-001",
            kind: "file",
            statusLabel: "For Review",
            tone: "info",
            submittedAt: "2026-06-14T06:39:00.000Z",
            detail: "Profile-1.pdf",
            viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
            downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
            actionLabel: null,
            actionTarget: null,
            canReview: true,
          },
          { onReviewDataChanged },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText(/no longer available for monitor review/i)).toBeTruthy();
    await waitFor(() => {
      expect(onReviewDataChanged).toHaveBeenCalledWith(expect.objectContaining({
        reason: "file-preview-stale",
      }));
    });
  });

  it("refreshes monitor review data when a file preview is missing", async () => {
    const onReviewDataChanged = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps(
          {
            id: "fm_qad_001",
            submissionId: "sub-1",
            label: "FM-QAD-001",
            kind: "file",
            statusLabel: "For Review",
            tone: "info",
            submittedAt: "2026-06-14T06:39:00.000Z",
            detail: "Profile-1.pdf",
            viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
            downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
            actionLabel: null,
            actionTarget: null,
            canReview: true,
          },
          { onReviewDataChanged },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText(/removed or reset/i)).toBeTruthy();
    await waitFor(() => {
      expect(onReviewDataChanged).toHaveBeenCalledWith(expect.objectContaining({
        reason: "file-preview-stale",
      }));
    });
  });

  it("shows a safe status-aware message when preview fails with a JSON server error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "Preview renderer failed for this document." }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps({
          id: "fm_qad_001",
          submissionId: "sub-1",
          label: "FM-QAD-001",
          kind: "file",
          statusLabel: "For Review",
          tone: "info",
          submittedAt: "2026-06-14T06:39:00.000Z",
          detail: "Profile-1.pdf",
          viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
          downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
          actionLabel: null,
          actionTarget: null,
          canReview: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText(/Preview failed \(status 500\)\. Preview renderer failed for this document\./i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("shows a safe status-aware message when preview fails with a plain text server error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Preview service is unavailable.", {
      status: 422,
      headers: { "content-type": "text/plain" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps({
          id: "fm_qad_001",
          submissionId: "sub-1",
          label: "FM-QAD-001",
          kind: "file",
          statusLabel: "For Review",
          tone: "info",
          submittedAt: "2026-06-14T06:39:00.000Z",
          detail: "Profile-1.pdf",
          viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
          downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
          actionLabel: null,
          actionTarget: null,
          canReview: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText(/Preview failed \(status 422\)\. Preview service is unavailable\./i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("shows a safe network fallback when preview fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps({
          id: "fm_qad_001",
          submissionId: "sub-1",
          label: "FM-QAD-001",
          kind: "file",
          statusLabel: "For Review",
          tone: "info",
          submittedAt: "2026-06-14T06:39:00.000Z",
          detail: "Profile-1.pdf",
          viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
          downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
          actionLabel: null,
          actionTarget: null,
          canReview: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByText(/network or server error/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("returns a requirement without requiring a note and refreshes monitor review data", async () => {
    const onReviewDataChanged = vi.fn().mockResolvedValue(undefined);
    reviewSubmissionScopeMock.mockResolvedValue({ id: "sub-1", status: "draft" });

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps(
          {
            id: "key_performance_indicators",
            submissionId: "sub-1",
            label: "Key Performance",
            kind: "section",
            statusLabel: "For Review",
            tone: "info",
            submittedAt: "2026-06-14T06:39:00.000Z",
            detail: "Targets and actual values are available for this year.",
            viewUrl: null,
            downloadUrl: null,
            actionLabel: null,
            actionTarget: "key_performance",
            canReview: true,
          },
          { onReviewDataChanged },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(screen.queryByLabelText("Return note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Return requirement" }));

    await waitFor(() => {
      expect(reviewSubmissionScopeMock).toHaveBeenCalledWith("sub-1", {
        scopeId: "key_performance_indicators",
        decision: "returned",
        notes: null,
      });
    });
    expect(onReviewDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      reason: "scope-review",
      decision: "returned",
    }));
  });

  it("shows Unverify for verified file rows and restores review actions after unverify", async () => {
    const onReviewDataChanged = vi.fn().mockResolvedValue(undefined);
    reviewSubmissionScopeMock.mockResolvedValue({ id: "sub-1", status: "draft" });

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps(
          {
            id: "fm_qad_001",
            submissionId: "sub-1",
            label: "FM-QAD-001",
            kind: "file",
            statusLabel: "Verified",
            tone: "success",
            submittedAt: "2026-06-14T06:39:00.000Z",
            detail: "Profile-1.pdf",
            viewUrl: "/api/submissions/sub-1/view/fm_qad_001",
            downloadUrl: "/api/submissions/sub-1/download/fm_qad_001",
            actionLabel: null,
            actionTarget: null,
            canReview: false,
            reviewDecision: "verified",
          },
          { onReviewDataChanged },
        )}
      />,
    );

    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unverify" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Unverify" }));

    await waitFor(() => {
      expect(reviewSubmissionScopeMock).toHaveBeenCalledWith("sub-1", {
        scopeId: "fm_qad_001",
        decision: "unverified",
        notes: null,
      });
    });
    expect(onReviewDataChanged).toHaveBeenCalledWith(expect.objectContaining({
      reason: "scope-review",
      decision: "unverified",
    }));
    expect(await screen.findByText("For Review")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Return" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unverify" })).toBeNull();
    expect(screen.queryByText("Returned")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => {
      expect(reviewSubmissionScopeMock).toHaveBeenLastCalledWith("sub-1", {
        scopeId: "fm_qad_001",
        decision: "verified",
        notes: null,
      });
    });
    expect(await screen.findByText("Verified")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unverify" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return" })).toBeNull();
  });

  it("keeps section View available for verified rows", async () => {
    const setActiveSchoolDrawerTab = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { logged: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps(
          {
            id: "school_achievements_learning_outcomes",
            submissionId: "sub-1",
            label: "School Achievements",
            kind: "section",
            statusLabel: "Verified",
            tone: "success",
            submittedAt: "2026-06-14T06:39:00.000Z",
            detail: "Section values are available for this year.",
            viewUrl: null,
            downloadUrl: null,
            actionLabel: null,
            actionTarget: "school_achievements",
            canReview: false,
            reviewDecision: "verified",
          },
          { setActiveSchoolDrawerTab },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(setActiveSchoolDrawerTab).toHaveBeenCalledWith("history");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/indicators/submissions/sub-1/report-viewed"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("logs an explicit monitor report view when a reviewable section View button is clicked", async () => {
    const setActiveSchoolDrawerTab = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { logged: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps(
          {
            id: "school_achievements_learning_outcomes",
            submissionId: "sub-1",
            label: "School Achievements",
            kind: "section",
            statusLabel: "For Review",
            tone: "info",
            submittedAt: "2026-06-14T06:39:00.000Z",
            detail: "Section values are available for this year.",
            viewUrl: null,
            downloadUrl: null,
            actionLabel: null,
            actionTarget: "school_achievements",
            canReview: true,
          },
          { setActiveSchoolDrawerTab },
        )}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    expect(setActiveSchoolDrawerTab).toHaveBeenCalledWith("history");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/indicators/submissions/sub-1/report-viewed"),
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
    const requestOptions = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>)[0]?.[1];
    expect(JSON.parse(String(requestOptions?.body))).toEqual({
      scopeId: "school_achievements_learning_outcomes",
    });
  });

  it("requires a return note only when the optional note toggle is enabled", async () => {
    reviewSubmissionScopeMock.mockResolvedValue({ id: "sub-1", status: "draft" });

    render(
      <MonitorSchoolDrawer
        {...reviewableDrawerProps({
          id: "school_achievements_learning_outcomes",
          submissionId: "sub-1",
          label: "School Achievements",
          kind: "section",
          statusLabel: "For Review",
          tone: "info",
          submittedAt: "2026-06-14T06:39:00.000Z",
          detail: "Section values are available for this year.",
          viewUrl: null,
          downloadUrl: null,
          actionLabel: null,
          actionTarget: "school_achievements",
          canReview: true,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    fireEvent.click(screen.getByLabelText("Include a note to the School Head"));

    const submitButton = screen.getByRole("button", { name: "Return requirement" });
    expect(submitButton.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Return note"), {
      target: { value: "Please upload the signed copy." },
    });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(reviewSubmissionScopeMock).toHaveBeenCalledWith("sub-1", {
        scopeId: "school_achievements_learning_outcomes",
        decision: "returned",
        notes: "Please upload the signed copy.",
      });
    });
  });

  it("shows disabled package actions for public and private rows without submissions", () => {
    reviewSubmissionScopeMock.mockClear();

    const baseProps: Parameters<typeof MonitorSchoolDrawer>[0] = {
      viewState: {
        isOpen: true,
        showNavigatorManual: true,
        isMobileViewport: false,
        activeTopNavigator: "schools" as const,
        activeSchoolDrawerTab: "submissions" as const,
        selectedSchoolDrawerYear: "2025-2026",
        highlightedDrawerIndicatorKey: null,
        expandedDrawerIndicatorRows: {},
      },
      loadingState: {
        syncedCountsLoadingSchoolKey: null,
        syncedCountsError: "",
        isSchoolDrawerSubmissionsLoading: false,
        schoolDrawerSubmissionsError: "",
      },
      data: {
        schoolDetail: {
          schoolKey: "school-public",
          schoolCode: "103823",
          schoolName: "Abra Elementary School",
          region: "II",
          level: "Elementary",
          type: "Public",
          schoolTypeRaw: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          address: "N/A",
          hasComplianceRecord: false,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          missingCount: 4,
          awaitingReviewCount: 0,
          lastActivityAt: null,
          reportedStudents: 0,
          reportedTeachers: 0,
          synchronizedStudents: 0,
          synchronizedTeachers: 0,
        },
        availableSchoolDrawerYears: [{ id: "2025-2026", label: "2025-2026" }],
        schoolDrawerYearDetail: {
          selectedYearLabel: "2025-2026",
          availableYears: [{ id: "2025-2026", label: "2025-2026" }],
          currentIssueLabel: "No submission activity yet for this year.",
          currentIssueTone: "info",
          checklistItems: [],
          packageRows: [
            {
              id: "school_achievements_learning_outcomes",
              label: "School Achievements",
              kind: "section",
              statusLabel: "Not Submitted",
              tone: "warning",
              submittedAt: null,
              detail: "No submitted package exists for the selected year.",
              viewUrl: null,
              downloadUrl: null,
              actionLabel: null,
              submissionId: null,
              canReview: false,
            },
            {
              id: "bmef",
              label: "BMEF",
              kind: "file",
              statusLabel: "Not Submitted",
              tone: "warning",
              submittedAt: null,
              detail: "File is still missing for the selected year.",
              viewUrl: null,
              downloadUrl: null,
              actionLabel: null,
              submissionId: null,
              canReview: false,
            },
          ],
          checklistCompleteCount: 0,
          checklistMissingCount: 2,
          selectedYearLatestSubmissionId: null,
          selectedYearLatestStatus: null,
          finalizedReportSubmission: null,
          reportSourceContext: [],
          reportBlankStateLines: ["No finalized submitted report package exists yet for the selected academic year.", "The report tables are shown for reference."],
          schoolAchievementRows: [],
          kpiRows: [],
        },
        schoolDrawerHistorySummary: null,
        schoolDrawerCriticalAlerts: [],
        schoolIndicatorPackageRows: [],
        latestSchoolPackage: null,
        schoolIndicatorMatrix: { years: [], rows: [], latestSubmission: null },
        latestSchoolIndicatorYear: "",
        schoolDrawerIndicatorSubmissions: [],
        schoolIndicatorRowsByCategory: [],
        missingDrawerIndicatorKeys: [],
        returnedDrawerIndicatorKeys: [],
        missingDrawerIndicatorKeySet: new Set(),
        returnedDrawerIndicatorKeySet: new Set(),
      },
      actions: {
        setActiveSchoolDrawerTab: vi.fn(),
        setSelectedSchoolDrawerYear: vi.fn(),
        closeSchoolDrawer: vi.fn(),
        handleJumpToMissingIndicators: vi.fn(),
        handleJumpToReturnedIndicators: vi.fn(),
        toggleDrawerIndicatorLabel: vi.fn(),
      },
      formatting: {
        workflowTone: () => "",
        workflowLabel: (status: string | null) => status ?? "N/A",
        formatDateTime: () => "N/A",
      },
    };

    const { rerender } = render(<MonitorSchoolDrawer {...baseProps} />);

    expect(screen.getAllByRole("button", { name: "View" }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("button", { name: "Verify" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getAllByRole("button", { name: "Return" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Verify" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Return" })[0]);
    expect(reviewSubmissionScopeMock).not.toHaveBeenCalled();

    rerender(
      <MonitorSchoolDrawer
        {...baseProps}
        data={{
          ...baseProps.data,
          schoolDetail: {
            ...baseProps.data.schoolDetail!,
            schoolKey: "school-private",
            schoolName: "Private School",
            type: "Private",
            schoolTypeRaw: "private",
          },
          schoolDrawerYearDetail: {
            ...baseProps.data.schoolDrawerYearDetail!,
            packageRows: [
              {
                id: "fm_qad_001",
                label: "FM-QAD-001",
                kind: "file",
                statusLabel: "Not Submitted",
                tone: "warning",
                submittedAt: null,
                detail: "File is still missing for the selected year.",
                viewUrl: null,
                downloadUrl: null,
                actionLabel: null,
                submissionId: null,
                canReview: false,
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getAllByRole("button", { name: "View" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: "Verify" })[0].hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByRole("button", { name: "Return" })[0].hasAttribute("disabled")).toBe(true);
  });
});
