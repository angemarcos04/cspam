import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorSchoolDrawer } from "@/pages/monitor/MonitorSchoolDrawer";

const reviewSubmissionScopeMock = vi.hoisted(() => vi.fn());

vi.mock("@/context/IndicatorData", () => ({
  useIndicatorData: () => ({
    reviewSubmissionScope: reviewSubmissionScopeMock,
  }),
}));

describe("MonitorSchoolDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps submissions as the main page and history as secondary reference", () => {
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
          availableSchoolDrawerYears: ["2025-2026"],
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
                actionLabel: null,
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

    expect(screen.getByLabelText("Monitor school detail academic year")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submissions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Indicator History" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Snapshot" })).toBeNull();
    expect(screen.getByText("Submitted Packages")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View FM-QAD-001" })).toBeTruthy();
    expect(screen.queryByText("Year Checklist")).toBeNull();
    expect(screen.queryByText("Submitted Report View")).toBeNull();
    expect(screen.queryByText("Data Sync")).toBeNull();
    expect(screen.queryByText("Critical Alerts")).toBeNull();
    expect(screen.queryByText("Active Package Context")).toBeNull();
    expect(screen.queryByText("Monitor Package")).toBeNull();
    expect(screen.queryByText("Active package requirements: FM-QAD uploads only.")).toBeNull();
    expect(screen.queryByText(/Compliance is submitted\. Active private package/i)).toBeNull();
  });

  it("keeps the no-indicator-data history state plain and collapses package details", () => {
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
          availableSchoolDrawerYears: ["2025-2026"],
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

    expect(screen.getAllByText("This package has no indicator data to display.")).toHaveLength(1);
    expect(screen.getByText("No indicator data available yet")).toBeTruthy();
    expect(screen.queryByText("Packages exist, but none contain indicator rows for history rendering.")).toBeNull();
    expect(screen.queryByText("History Source")).toBeNull();
    expect(screen.queryByText(/Matrix source year:/)).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Package" })).toBeNull();

    const toggle = screen.getByRole("button", { name: "Show package details" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Hide package details" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Matrix source year:/)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Package" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Reviewed" })).toBeNull();
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
          availableSchoolDrawerYears: ["2025-2026"],
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
          schoolIndicatorPackageRows: [],
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
          formatDateTime: () => "N/A",
        }}
      />,
    );

    expect(screen.getByText("Submitted Report View")).toBeTruthy();
    expect(screen.getByText("School's Achievement (SY 2025-2026)")).toBeTruthy();
    expect(screen.getByText("Key Performance Indicators (SY 2025-2026)")).toBeTruthy();
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("98.00%")).toBeTruthy();
    expect(screen.queryByText("Historical Indicator Matrix")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show package details" }));
    expect(screen.getByText("Historical Indicator Matrix")).toBeTruthy();
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
        availableSchoolDrawerYears: ["2026-2027", "2025-2026"],
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

    expect(screen.getAllByText("Viewing SY 2025-2026.").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View BMEF" }).getAttribute("href")).toBe("/api/submissions/sub-2025/view/bmef");

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

    expect(screen.getAllByText("Viewing SY 2026-2027.").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View BMEF" }).getAttribute("href")).toBe("/api/submissions/sub-2026/view/bmef");
    expect(screen.queryByText("bmef.pdf")).toBeNull();
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
        availableSchoolDrawerYears: ["2025-2026"],
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
