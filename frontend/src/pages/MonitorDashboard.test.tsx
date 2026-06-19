import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorDashboard } from "@/pages/MonitorDashboard";
import { useAuth } from "@/context/Auth";
import { useData } from "@/context/Data";
import { useIndicatorData } from "@/context/IndicatorData";
import { useStudentData } from "@/context/StudentData";
import { useTeacherData } from "@/context/TeacherData";
import type { IndicatorDataContextType } from "@/context/IndicatorData";
import type { StudentDataContextType } from "@/context/StudentData";
import type { TeacherDataContextType } from "@/context/TeacherData";

vi.mock("@/context/Auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/context/Data", () => ({
  useData: vi.fn(),
}));

vi.mock("@/context/IndicatorData", () => ({
  useIndicatorData: vi.fn(),
}));

vi.mock("@/context/StudentData", () => ({
  useStudentData: vi.fn(),
}));

vi.mock("@/context/TeacherData", () => ({
  useTeacherData: vi.fn(),
}));

vi.mock("@/components/Shell", () => ({
  Shell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock("@/components/DashboardHelpDialog", () => ({
  DashboardHelpDialog: () => null,
}));

vi.mock("@/components/MonitorMfaResetApprovalsDialog", () => ({
  MonitorMfaResetApprovalsDialog: () => null,
}));

vi.mock("@/components/StatCard", () => ({
  StatCard: () => null,
}));

vi.mock("@/components/charts/StatusPieChart", () => ({
  StatusPieChart: () => null,
}));

vi.mock("@/components/charts/RegionBarChart", () => ({
  RegionBarChart: () => null,
}));

vi.mock("@/components/charts/SubmissionTrendChart", () => ({
  SubmissionTrendChart: () => null,
}));

vi.mock("@/components/students/StudentRecordsPanel", () => ({
  StudentRecordsPanel: () => null,
}));

const issueSchoolHeadSetupLinkMock = vi.fn();
const sendReminderMock = vi.fn();
const bulkImportRecordsMock = vi.fn();
const refreshRecordsMock = vi.fn();
const refreshSubmissionsMock = vi.fn();
const scrollIntoViewMock = vi.fn();

describe("MonitorDashboard School Head delivery flows", () => {
  beforeEach(() => {
    window.localStorage.clear();
    issueSchoolHeadSetupLinkMock.mockReset();
    sendReminderMock.mockReset();
    bulkImportRecordsMock.mockReset();
    refreshRecordsMock.mockReset();
    refreshSubmissionsMock.mockReset();
    scrollIntoViewMock.mockReset();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    issueSchoolHeadSetupLinkMock.mockResolvedValue({
      account: {
        id: "account-1",
        name: "Maria Santos",
        email: "maria@example.com",
        emailVerifiedAt: null,
        lastLoginAt: null,
        accountStatus: "pending_setup",
        mustResetPassword: true,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
        setupLinkExpiresAt: "2026-03-28T12:00:00.000Z",
      },
      expiresAt: "2026-03-28T12:00:00.000Z",
      delivery: "sent",
      deliveryMessage: "Message queued.",
    });
    sendReminderMock.mockResolvedValue({
      schoolId: "900001",
      schoolName: "Santiago Elementary",
      recipientCount: 1,
      recipientEmails: ["maria@example.com"],
      remindedAt: "2026-03-27T09:00:00.000Z",
      deliveryMode: "sync",
      deliveryStatus: "sent",
      deliveryWarning: null,
    });
    bulkImportRecordsMock.mockResolvedValue({
      created: 1,
      updated: 0,
      restored: 0,
      skipped: 0,
      failed: 0,
      accounts: {
        created: 0,
        unchanged: 0,
        skippedExistingAccount: 0,
        failed: 0,
        none: 1,
      },
      results: [
        {
          row: 1,
          schoolId: "955570",
          schoolName: "Imported No Account School",
          action: "created",
          accountAction: "none",
        },
      ],
    });

    vi.mocked(useAuth).mockReturnValue({
      role: "monitor",
      username: "Monitor User",
      user: {
        id: 1,
        name: "Monitor User",
        email: "monitor@cspams.local",
        role: "monitor",
        schoolId: null,
        schoolCode: null,
        schoolName: null,
      },
      apiToken: "test-bearer-token",
      authError: "",
      authErrorCode: null,
      accountStatus: null,
      isLoading: false,
      isAuthenticating: false,
      isLoggingOut: false,
      clearAuthError: vi.fn(),
      handleUnauthorizedResponse: vi.fn(),
      login: vi.fn(),
      verifyMfa: vi.fn(),
      requestMonitorPasswordReset: vi.fn(),
      resetMonitorPassword: vi.fn(),
      requestMonitorMfaReset: vi.fn(),
      completeMonitorMfaReset: vi.fn(),
      completeAccountSetup: vi.fn(),
      resetRequiredPassword: vi.fn(),
      logout: vi.fn(),
      listActiveSessions: vi.fn(),
      revokeSessionDevice: vi.fn(),
      revokeOtherSessions: vi.fn(),
    });

    vi.mocked(useData).mockReturnValue({
      records: [
        {
          id: "1",
          schoolId: "900001",
          schoolCode: "900001",
          schoolName: "Santiago Elementary",
          level: "Elementary",
          district: "District 1",
          address: "District 1, Santiago City",
          type: "public",
          studentCount: 120,
          teacherCount: 12,
          region: "Region II",
          status: "active",
          submittedBy: "Monitor User",
          lastUpdated: "2026-03-27T09:00:00.000Z",
          deletedAt: null,
          schoolHeadAccount: {
            id: "account-1",
            name: "Maria Santos",
            email: "maria@example.com",
            emailVerifiedAt: null,
            lastLoginAt: null,
            accountStatus: "pending_setup",
            mustResetPassword: true,
            flagged: false,
            flaggedAt: null,
            flagReason: null,
            deleteRecordFlagged: false,
            deleteRecordFlaggedAt: null,
            deleteRecordReason: null,
            setupLinkExpiresAt: "2026-03-28T12:00:00.000Z",
          },
          indicatorLatest: null,
        },
      ],
      recordCount: 1,
      targetsMet: {
        generatedAt: "2026-03-27T09:00:00.000Z",
        schoolsMonitored: 1,
        activeSchools: 1,
        pendingSchools: 0,
        inactiveSchools: 0,
        reportedStudents: 120,
        reportedTeachers: 12,
        trackedLearners: 120,
        enrolledLearners: 120,
        atRiskLearners: 0,
        dropoutLearners: 0,
        completerLearners: 0,
        transfereeLearners: 0,
        studentTeacherRatio: 10,
        studentClassroomRatio: 30,
        enrollmentRatePercent: 100,
        retentionRatePercent: 100,
        dropoutRatePercent: 0,
        completionRatePercent: 0,
        atRiskRatePercent: 0,
        transitionRatePercent: 0,
      },
      syncAlerts: [],
      isLoading: false,
      isSaving: false,
      error: "",
      lastSyncedAt: "2026-03-27T09:00:00.000Z",
      syncScope: "division",
      syncStatus: "updated",
      refreshRecords: refreshRecordsMock,
      addRecord: vi.fn(),
      updateRecord: vi.fn(),
      deleteRecord: vi.fn(),
      previewDeleteRecord: vi.fn(),
      listArchivedRecords: vi.fn(),
      restoreRecord: vi.fn(),
      permanentlyDeleteArchivedRecord: vi.fn(),
      sendReminder: sendReminderMock,
      updateSchoolHeadAccountStatus: vi.fn(),
      activateSchoolHeadAccount: vi.fn(),
      issueSchoolHeadAccountActionVerificationCode: vi.fn(),
      issueSchoolHeadSetupLink: issueSchoolHeadSetupLinkMock,
      issueSchoolHeadPasswordResetLink: vi.fn(),
      issueSchoolHeadTemporaryPassword: vi.fn(),
      upsertSchoolHeadAccountProfile: vi.fn(),
      removeSchoolHeadAccount: vi.fn(),
      removeSchoolHeadAccountsBatch: vi.fn(),
      bulkImportRecords: bulkImportRecordsMock,
    });

    const indicatorDataMock = {
      submissions: [],
      allSubmissions: [],
      metrics: [],
      academicYears: [],
      isLoading: false,
      isAllSubmissionsLoading: false,
      isSaving: false,
      error: "",
      lastSyncedAt: null,
      refreshSubmissions: refreshSubmissionsMock,
      refreshAllSubmissions: vi.fn(),
      listSubmissions: vi.fn(),
      loadSubmissionsForYear: vi.fn().mockResolvedValue([]),
      listSubmissionsForSchool: vi.fn().mockResolvedValue([]),
      loadAllSubmissions: vi.fn(),
      bootstrapSubmission: vi.fn(),
      createSubmission: vi.fn(),
      updateSubmission: vi.fn(),
      fetchSubmission: vi.fn(),
      resetSubmissionWorkspace: vi.fn(),
      // NEW 2026 COMPLIANCE UI: BMEF tab replaces TARGETS-MET
      // 4-tab layout (School Achievements | Key Performance | BMEF | SMEA)
      // Monitor & School Head views updated for DepEd standards
      uploadSubmissionFile: vi.fn(),
      downloadSubmissionFile: vi.fn(),
      submitSubmission: vi.fn(),
      submitSubmissionScopes: vi.fn(),
      reviewSubmission: vi.fn(),
      reviewSubmissionScope: vi.fn(),
      loadHistory: vi.fn(),
    } satisfies IndicatorDataContextType;
    vi.mocked(useIndicatorData).mockReturnValue(indicatorDataMock);

    const studentDataMock = {
      students: [],
      isLoading: false,
      isSaving: false,
      error: "",
      lastSyncedAt: null,
      syncScope: "division",
      totalCount: 0,
      dataVersion: 0,
      refreshStudents: vi.fn(),
      queryStudents: vi.fn().mockResolvedValue({
        data: [],
        meta: {
          syncedAt: null,
          scope: "division",
          recordCount: 0,
          currentPage: 1,
          lastPage: 1,
          perPage: 1,
          total: 0,
          from: null,
          to: null,
          hasMorePages: false,
        },
      }),
      listStudentHistory: vi.fn(),
      addStudent: vi.fn(),
      updateStudent: vi.fn(),
      deleteStudent: vi.fn(),
      deleteStudents: vi.fn(),
    } satisfies StudentDataContextType;
    vi.mocked(useStudentData).mockReturnValue(studentDataMock);

    const teacherDataMock = {
      teachers: [],
      teacherSnapshot: [],
      isLoading: false,
      isSaving: false,
      error: "",
      lastSyncedAt: null,
      syncScope: "division",
      totalCount: 0,
      dataVersion: 0,
      refreshTeachers: vi.fn(),
      listTeachers: vi.fn().mockResolvedValue({
        data: [],
        meta: {
          syncedAt: null,
          scope: "division",
          recordCount: 0,
          currentPage: 1,
          lastPage: 1,
          perPage: 1,
          total: 0,
          from: null,
          to: null,
          hasMorePages: false,
        },
      }),
      addTeacher: vi.fn(),
      updateTeacher: vi.fn(),
      deleteTeacher: vi.fn(),
    } satisfies TeacherDataContextType;
    vi.mocked(useTeacherData).mockReturnValue(teacherDataMock);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses delivery metadata only when sending a School Head setup link", async () => {
    render(<MonitorDashboard />);

    fireEvent.click(screen.getByRole("button", { name: "Open Schools" }));
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Send Setup Link" }));

    await waitFor(() => {
      expect(issueSchoolHeadSetupLinkMock).toHaveBeenCalledWith("1", null);
    });

    expect(screen.getByText("Setup link email sent for Santiago Elementary.")).toBeTruthy();
    expect(screen.getByText("Message queued.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reveal link/i })).toBeNull();
  });

  it("uses the same focus-and-scroll behavior for keyboard top navigation", async () => {
    render(<MonitorDashboard />);
    scrollIntoViewMock.mockClear();

    fireEvent.keyDown(window, { key: "2", altKey: true });

    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });

    const openReviewsButtons = screen.getAllByRole("button", { name: "Open Reviews" });
    expect(openReviewsButtons.every((button) => button.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("forces monitor review data refresh after a School Head sends a scope", async () => {
    render(<MonitorDashboard />);

    await waitFor(() => {
      expect(refreshRecordsMock).toHaveBeenCalled();
      expect(refreshSubmissionsMock).toHaveBeenCalled();
    });
    refreshRecordsMock.mockClear();
    refreshSubmissionsMock.mockClear();

    act(() => {
      window.dispatchEvent(new CustomEvent("cspams:update", {
        detail: {
          entity: "indicators",
          eventType: "indicators.scopes_submitted",
          submissionId: "submission-77",
          schoolId: "1",
          schoolCode: "900001",
          academicYearId: "ay-2025",
          touchedScopes: ["fm_qad_001"],
        },
      }));
    });

    await waitFor(() => {
      expect(refreshRecordsMock).toHaveBeenCalledWith({ force: true });
      expect(refreshSubmissionsMock).toHaveBeenCalled();
    });
  });

  it("labels the Schools card status pill as school status to avoid account-state ambiguity", async () => {
    render(<MonitorDashboard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Schools" })[0]!);

    const schoolStatusPills = await screen.findAllByRole("button", { name: "School Active" });
    expect(schoolStatusPills.length).toBeGreaterThan(0);
  });

  it("downloads the editable school CSV format from the Schools menu", async () => {
    const originalCreateObjectUrl = window.URL.createObjectURL;
    const originalRevokeObjectUrl = window.URL.revokeObjectURL;
    const createObjectUrlMock = vi.fn((_blob: Blob | MediaSource) => "blob:cspams-school-csv");
    const revokeObjectUrlMock = vi.fn();
    const clickMock = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    Object.defineProperty(window.URL, "createObjectURL", { configurable: true, value: createObjectUrlMock });
    Object.defineProperty(window.URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrlMock });

    try {
      render(<MonitorDashboard />);

      fireEvent.click(screen.getAllByRole("button", { name: "Open Schools" })[0]!);
      fireEvent.click(screen.getByRole("button", { name: "More" }));

      const downloadButton = screen.getByRole("button", { name: "Download CSV Format" });
      expect(downloadButton).toBeTruthy();
      expect(screen.getByRole("button", { name: "Import CSV" })).toBeTruthy();

      fireEvent.click(downloadButton);

      expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
      const csvBlob = createObjectUrlMock.mock.calls[0]?.[0] as Blob;
      const csvText = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(csvBlob);
      });

      expect(csvText).toContain(
        "school_id,school_name,level,type,address,district,region,status,school_head_name,school_head_email",
      );
      expect(csvText).toContain("900001,Santiago Elementary,Elementary,public,\"District 1, Santiago City\"");
      expect(csvText).toContain("Maria Santos,maria@example.com");
      expect(csvText).not.toContain("temporary_password");
      expect(clickMock).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      Object.defineProperty(window.URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
      clickMock.mockRestore();
    }
  });

  it("explains CSV imports that did not create School Head accounts", async () => {
    const { container } = render(<MonitorDashboard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Schools" })[0]!);

    const csv = "school_id,school_name,level,type,address\n955570,Imported No Account School,Elementary,public,Main";
    const file = new File([csv], "schools.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: vi.fn().mockResolvedValue(csv),
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(bulkImportRecordsMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/No School Head accounts were created/i)).not.toBeNull();
    expect(screen.getByText(/school_head_name and school_head_email/i)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Review schools needing accounts" }));

    expect(screen.getByText("School Head Accounts")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Needs account/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens School Detail for a queue row when no dashboard filters are active", async () => {
    render(<MonitorDashboard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Reviews" })[0]!);

    expect(await screen.findByRole("heading", { name: "Queue List" })).toBeTruthy();
    expect(screen.queryByText("Select a school from the queue to start reviewing submissions.")).toBeNull();
    expect(screen.queryByTestId("monitor-indicator-panel")).toBeNull();

    await new Promise((resolve) => window.setTimeout(resolve, 120));
    scrollIntoViewMock.mockClear();
    fireEvent.click((await screen.findAllByRole("button", { name: "Review" }))[0]!);

    await waitFor(() => {
      const schoolDetail = screen.getByText("School Detail").closest("aside");
      expect(schoolDetail).toBeTruthy();
      expect(within(schoolDetail as HTMLElement).getByText("Santiago Elementary")).toBeTruthy();
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("simplifies the queue list columns and removes the duplicate open school action", async () => {
    render(<MonitorDashboard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Reviews" })[0]!);

    const reviewsHeadings = await screen.findAllByRole("heading", { name: "Reviews" });
    const topReviewsToolbar = reviewsHeadings[0]?.closest("section");

    expect(topReviewsToolbar).toBeTruthy();
    expect(within(topReviewsToolbar as HTMLElement).queryByRole("button", { name: "Review" })).toBeNull();
    expect(within(topReviewsToolbar as HTMLElement).queryByRole("button", { name: "Filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Queue List" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review Workspace" })).toBeNull();
    expect(screen.queryByTestId("monitor-indicator-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I-META" })).toBeNull();
    expect(screen.queryByLabelText("Auto-open next school after review")).toBeNull();

    const globalSearch = screen.getByPlaceholderText("Search school code, school name, or school head") as HTMLInputElement;
    fireEvent.change(globalSearch, { target: { value: "Santiago" } });
    expect(globalSearch.value).toBe("Santiago");

    expect(await screen.findByRole("heading", { name: "Queue List" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Location" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "School Data" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Package" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Compliance" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Indicators" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "For Review" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Priority" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open School" })).toBeNull();
    expect((await screen.findAllByRole("button", { name: "Review" })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: "Reminder" })).length).toBeGreaterThan(0);

    scrollIntoViewMock.mockClear();
    fireEvent.click((await screen.findAllByRole("button", { name: "Review" }))[0]!);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
    const schoolDetail = screen.getByText("School Detail").closest("aside");
    expect(schoolDetail).toBeTruthy();
    expect(within(schoolDetail as HTMLElement).getByText("Santiago Elementary")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Queue List" }));
    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("sends queue reminders with an optional note", async () => {
    render(<MonitorDashboard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Reviews" })[0]!);

    fireEvent.click((await screen.findAllByRole("button", { name: "Reminder" }))[0]!);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Please submit your package this week." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reminder" }));

    await waitFor(() => {
      expect(sendReminderMock).toHaveBeenCalledWith("1", "Please submit your package this week.");
    });
  });

  it("blocks queue reminder notes longer than 500 characters", async () => {
    render(<MonitorDashboard />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open Reviews" })[0]!);

    fireEvent.click((await screen.findAllByRole("button", { name: "Reminder" }))[0]!);
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "a".repeat(501) },
    });

    expect(screen.getByText("Reminder note must be 500 characters or less.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send Reminder" }) as HTMLButtonElement).disabled).toBe(true);
    expect(sendReminderMock).not.toHaveBeenCalled();
  });
});
