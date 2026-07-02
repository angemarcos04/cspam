import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MonitorSchoolHeadAccountsPanel,
  type SchoolHeadAccountsStatusFilter,
} from "@/pages/monitor/MonitorSchoolHeadAccountsPanel";
import { useSchoolHeadAccountActions } from "@/pages/monitor/useSchoolHeadAccountActions";
import type { MonitorSchoolRecordsListRow } from "@/pages/monitor/MonitorSchoolRecordsList";
import { useMonitorSchoolHeadAccountsPanelState } from "@/pages/monitor/useMonitorSchoolHeadAccountsPanelState";
import { schoolHeadAccountMatchesStatusFilter } from "@/pages/monitor/schoolHeadAccountStatus";
import type { SchoolHeadAccountActionsApi } from "@/pages/monitor/useSchoolHeadAccountActions";
import type { SchoolRecord } from "@/types";

function buildActions(): SchoolHeadAccountActionsApi {
  return {
    editingSchoolHeadAccountSchoolId: null,
    schoolHeadAccountDraft: { name: "", email: "" },
    schoolHeadAccountDraftError: "",
    temporaryPasswordReceipt: null,
    openAccountRowMenuSchoolId: null,
    pendingAccountAction: null,
    pendingAccountReason: "",
    pendingAccountReasonError: "",
    pendingReasonTooShort: false,
    pendingAccountVerificationChallenge: null,
    pendingAccountVerificationCode: "",
    pendingAccountVerificationError: "",
    pendingActionDescription: "",
    pendingActionRequiresVerification: false,
    pendingShowsNotifySchoolHead: false,
    pendingShowsIncludeReasonInEmail: false,
    pendingNotifySchoolHead: false,
    pendingIncludeReasonInEmail: false,
    isPendingAccountVerificationSending: false,
    isConfirmPendingAccountActionDisabled: false,
    confirmPendingAccountActionLabel: "Confirm",
    pendingRemoveCountdownSeconds: 0,
    accountActionKey: null,
    accountRowMenuRef: { current: null },
    pendingAccountReasonRef: { current: null },
    pendingAccountVerificationCodeRef: { current: null },
    beginEditing: vi.fn(),
    cancelEditing: vi.fn(),
    updateDraftField: vi.fn(),
    saveProfile: vi.fn(),
    toggleAccountRowMenu: vi.fn(),
    openPendingAccountAction: vi.fn(),
    closePendingAccountAction: vi.fn(),
    updatePendingAccountReason: vi.fn(),
    updatePendingNotifySchoolHead: vi.fn(),
    updatePendingIncludeReasonInEmail: vi.fn(),
    updatePendingVerificationCode: vi.fn(),
    sendPendingAccountVerificationCode: vi.fn(),
    confirmPendingAccountAction: vi.fn(),
    handleUpdateSchoolHeadAccount: vi.fn(),
    handleIssueSchoolHeadSetupLink: vi.fn(),
    copyTemporaryPasswordReceipt: vi.fn(),
    clearTemporaryPasswordReceipt: vi.fn(),
    resetPanelState: vi.fn(),
  };
}

describe("MonitorSchoolHeadAccountsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders account status filters with the search toolbar", () => {
    render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[]}
        totalCount={0}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={(value) => value ?? "-"}
        actions={buildActions()}
      />,
    );

    expect(screen.getByPlaceholderText("Search school, code, name, or email...")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "School Head Account Management" })).not.toBeNull();
    expect(screen.queryByText("Manage linked School Head accounts without leaving the Schools view.")).toBeNull();
    expect(screen.getByRole("button", { name: "Close Panel" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /All/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Active/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Activation Needed/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Suspended/i })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Setup Needed/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Needs account/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Temporary password active/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Locked/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Archived/i })).toBeNull();
    expect(screen.queryByText(/Showing \d+ of \d+ schools/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Open batch delete flagged schools" })).toBeNull();
  });

  it("filters rows without mutating account status or firing account actions", () => {
    const activeRecord: SchoolRecord = {
      id: "school-active",
      schoolId: "910001",
      schoolCode: "910001",
      schoolName: "Active Account School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-08T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-active",
        name: "Active Head",
        email: "active@cspams.local",
        accountStatus: "active",
        mustResetPassword: false,
        lifecycleState: "active_ready",
        lifecycleStateLabel: "Active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt: "2026-05-02T08:00:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };
    const suspendedRecord: SchoolRecord = {
      ...activeRecord,
      id: "school-suspended",
      schoolId: "910002",
      schoolCode: "910002",
      schoolName: "Suspended Account School",
      schoolHeadAccount: {
        ...activeRecord.schoolHeadAccount!,
        id: "account-suspended",
        name: "Suspended Head",
        email: "suspended@cspams.local",
        accountStatus: "suspended",
        lifecycleState: "suspended",
        lifecycleStateLabel: "Suspended",
      },
    };
    const setupNeededRecord: SchoolRecord = {
      ...activeRecord,
      id: "school-setup-needed",
      schoolId: "910003",
      schoolCode: "910003",
      schoolName: "Setup Needed Account School",
      schoolHeadAccount: {
        ...activeRecord.schoolHeadAccount!,
        id: "account-setup-needed",
        name: "Setup Needed Head",
        email: "setup-needed@cspams.local",
        accountStatus: "pending_setup",
        lifecycleState: "pending_setup",
        lifecycleStateLabel: "Pending setup",
        recommendedAction: "send_setup_link",
      },
    };

    const openPendingAccountAction = vi.fn();
    const handleUpdateSchoolHeadAccount = vi.fn();
    const handleIssueSchoolHeadSetupLink = vi.fn();

    function Wrapper(): ReactElement {
      const [statusFilter, setStatusFilter] = useState<SchoolHeadAccountsStatusFilter>("all");
      const actions = buildActions();
      actions.openPendingAccountAction = openPendingAccountAction;
      actions.handleUpdateSchoolHeadAccount = handleUpdateSchoolHeadAccount;
      actions.handleIssueSchoolHeadSetupLink = handleIssueSchoolHeadSetupLink;
      const allRows = [activeRecord, suspendedRecord, setupNeededRecord];
      const filteredRows = allRows
        .filter((record) => schoolHeadAccountMatchesStatusFilter(record.schoolHeadAccount ?? null, statusFilter))
        .map((record) => ({
          schoolKey: record.id,
          schoolCode: record.schoolCode ?? "",
          schoolName: record.schoolName,
          record,
        }));

      return (
        <MonitorSchoolHeadAccountsPanel
          isOpen
          isSaving={false}
          isMobileViewport={false}
          rows={filteredRows}
          totalCount={allRows.length}
          accountStatusCounts={{ all: 3, active: 1, activation_needed: 1, suspended: 1 }}
          query=""
          statusFilter={statusFilter}
          onlyFlagged={false}
          onlyDeleteFlagged={false}
          onQueryChange={vi.fn()}
          onStatusFilterChange={setStatusFilter}
          onOnlyFlaggedChange={vi.fn()}
          onOnlyDeleteFlaggedChange={vi.fn()}
          onClearFilters={vi.fn()}
          onClose={vi.fn()}
          onOpenSchoolRecord={vi.fn()}
          formatDateTime={(value) => value ?? "-"}
          actions={actions}
        />
      );
    }

    render(<Wrapper />);
    expect(screen.getByText("Active Account School")).not.toBeNull();
    expect(screen.getByText("Suspended Account School")).not.toBeNull();
    expect(screen.getByText("Setup Needed Account School")).not.toBeNull();
    const filterGroup = screen.getByLabelText("School Head account filters");

    fireEvent.click(within(filterGroup).getByRole("button", { name: /Active/i }));
    expect(screen.getByText("Active Account School")).not.toBeNull();
    expect(screen.queryByText("Suspended Account School")).toBeNull();
    expect(screen.queryByText("Setup Needed Account School")).toBeNull();
    expect(activeRecord.schoolHeadAccount?.accountStatus).toBe("active");
    expect(suspendedRecord.schoolHeadAccount?.accountStatus).toBe("suspended");

    fireEvent.click(within(filterGroup).getByRole("button", { name: /Activation Needed/i }));
    expect(screen.queryByText("Active Account School")).toBeNull();
    expect(screen.queryByText("Suspended Account School")).toBeNull();
    expect(screen.getByText("Setup Needed Account School")).not.toBeNull();
    expect(setupNeededRecord.schoolHeadAccount?.accountStatus).toBe("pending_setup");

    fireEvent.click(within(filterGroup).getByRole("button", { name: /Suspended/i }));
    expect(screen.queryByText("Active Account School")).toBeNull();
    expect(screen.queryByText("Setup Needed Account School")).toBeNull();
    expect(screen.getByText("Suspended Account School")).not.toBeNull();
    expect(activeRecord.schoolHeadAccount?.accountStatus).toBe("active");
    expect(suspendedRecord.schoolHeadAccount?.accountStatus).toBe("suspended");
    expect(openPendingAccountAction).not.toHaveBeenCalled();
    expect(handleUpdateSchoolHeadAccount).not.toHaveBeenCalled();
    expect(handleIssueSchoolHeadSetupLink).not.toHaveBeenCalled();
  });

  it("shows activation-needed rows without redundant labels and routes Activate Account through the pending action flow", () => {
    const activationNeededRecord: SchoolRecord = {
      id: "school-activation-needed",
      schoolId: "910003",
      schoolCode: "910003",
      schoolName: "Activation Needed School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-08T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-activation-needed",
        name: "Activation Head",
        email: "activation@cspams.local",
        accountStatus: "pending_verification",
        mustResetPassword: false,
        lifecycleState: "pending_verification",
        lifecycleStateLabel: "Pending Verification",
        recommendedAction: "activate_account",
        emailVerifiedAt: null,
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };
    const openPendingAccountAction = vi.fn();
    const handleUpdateSchoolHeadAccount = vi.fn();

    function Wrapper(): ReactElement {
      const [openAccountRowMenuSchoolId, setOpenAccountRowMenuSchoolId] = useState<string | null>(null);
      const actions = buildActions();
      actions.openAccountRowMenuSchoolId = openAccountRowMenuSchoolId;
      actions.toggleAccountRowMenu = (schoolId: string) => {
        setOpenAccountRowMenuSchoolId((current) => (current === schoolId ? null : schoolId));
      };
      actions.openPendingAccountAction = openPendingAccountAction;
      actions.handleUpdateSchoolHeadAccount = handleUpdateSchoolHeadAccount;

      return (
        <MonitorSchoolHeadAccountsPanel
          isOpen
          isSaving={false}
          isMobileViewport={false}
          rows={[{
            schoolKey: activationNeededRecord.id,
            schoolCode: activationNeededRecord.schoolCode ?? "",
            schoolName: activationNeededRecord.schoolName,
            record: activationNeededRecord,
          }]}
          totalCount={1}
          accountStatusCounts={{ all: 1, activation_needed: 1, active: 0, suspended: 0 }}
          query=""
          statusFilter="all"
          onlyFlagged={false}
          onlyDeleteFlagged={false}
          onQueryChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onOnlyFlaggedChange={vi.fn()}
          onOnlyDeleteFlaggedChange={vi.fn()}
          onClearFilters={vi.fn()}
          onClose={vi.fn()}
          onOpenSchoolRecord={vi.fn()}
          formatDateTime={(value) => value ?? "-"}
          actions={actions}
        />
      );
    }

    render(<Wrapper />);

    const row = screen.getAllByRole("row").find((candidate) => candidate.textContent?.includes("Activation Needed School"));
    expect(row).not.toBeUndefined();
    expect(within(row!).getByText("Activation Needed")).not.toBeNull();
    expect(within(row!).queryByText("Pending Verification")).toBeNull();
    expect(within(row!).queryByText("pending_verification")).toBeNull();
    expect(within(row!).queryByText("Awaiting monitor approval")).toBeNull();

    fireEvent.click(within(row!).getByRole("button", { name: "Actions" }));
    const menu = screen.getByRole("menu", { name: "Activation Needed School account actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Activate Account",
      "Remove Account and School",
    ]);
    expect(within(menu).queryByRole("menuitem", { name: "Send Password Reset Link" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Suspend Account" })).toBeNull();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Activate Account" }));
    expect(openPendingAccountAction).toHaveBeenCalledWith({
      kind: "activate",
      schoolId: "school-activation-needed",
      schoolName: "Activation Needed School",
      actionLabel: "Activate Account",
    });
    expect(handleUpdateSchoolHeadAccount).not.toHaveBeenCalled();
  });

  it("keeps no-account rows limited to the create-account action", () => {
    const record: SchoolRecord = {
      id: "school-1",
      schoolId: "900001",
      schoolCode: "900001",
      schoolName: "No Account School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-08T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: null,
      indicatorLatest: null,
    };

    function Wrapper(): ReactElement {
      const [openAccountRowMenuSchoolId, setOpenAccountRowMenuSchoolId] = useState<string | null>(null);
      const [query, setQuery] = useState("");
      const [statusFilter, setStatusFilter] = useState<SchoolHeadAccountsStatusFilter>("all");
      const [onlyFlagged, setOnlyFlagged] = useState(false);
      const [onlyDeleteFlagged, setOnlyDeleteFlagged] = useState(false);
      const actions = buildActions();
      actions.openAccountRowMenuSchoolId = openAccountRowMenuSchoolId;
      actions.toggleAccountRowMenu = (schoolId: string) => {
        setOpenAccountRowMenuSchoolId((current) => (current === schoolId ? null : schoolId));
      };

      return (
        <MonitorSchoolHeadAccountsPanel
          isOpen
          isSaving={false}
          isMobileViewport={false}
          rows={[
            {
              schoolKey: "school-1",
              schoolCode: "900001",
              schoolName: "No Account School",
              record,
            },
          ]}
          totalCount={1}
          query={query}
          statusFilter={statusFilter}
          onlyFlagged={onlyFlagged}
          onlyDeleteFlagged={onlyDeleteFlagged}
          onQueryChange={setQuery}
          onStatusFilterChange={setStatusFilter}
          onOnlyFlaggedChange={setOnlyFlagged}
          onOnlyDeleteFlaggedChange={setOnlyDeleteFlagged}
          onClearFilters={() => {
            setQuery("");
            setStatusFilter("all");
            setOnlyFlagged(false);
            setOnlyDeleteFlagged(false);
          }}
          onClose={vi.fn()}
          onOpenSchoolRecord={vi.fn()}
          formatDateTime={(value) => value ?? "-"}
          actions={actions}
        />
      );
    }

    render(<Wrapper />);

    expect(screen.getByText("No School Head account")).not.toBeNull();
    expect(screen.getAllByText("Needs account").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create account" })).not.toBeNull();

    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage Account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive school record" })).toBeNull();
  });

  it("opens compact account action dropdowns with the guarded action items", () => {
    const pendingRecord: SchoolRecord = {
      id: "school-2",
      schoolId: "900002",
      schoolCode: "900002",
      schoolName: "Pending Setup School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-08T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-1",
        name: "Pending User",
        email: "pending@cspams.local",
        accountStatus: "pending_setup",
        mustResetPassword: false,
        lifecycleState: "pending_setup",
        lifecycleStateLabel: "Pending setup",
        recommendedAction: "send_setup_link",
        emailVerifiedAt: null,
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };

    const activeRecord: SchoolRecord = {
      ...pendingRecord,
      id: "school-3",
      schoolId: "900003",
      schoolCode: "900003",
      schoolName: "Active School",
      schoolHeadAccount: {
        ...pendingRecord.schoolHeadAccount!,
        id: "account-2",
        accountStatus: "active",
        lifecycleState: "active_ready",
        lifecycleStateLabel: "Active",
        recommendedAction: "send_password_reset_link",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt: "2026-05-02T08:00:00.000Z",
        verifiedByName: "Monitor User",
      },
    };

    const lockedRecord: SchoolRecord = {
      ...pendingRecord,
      id: "school-4",
      schoolId: "900004",
      schoolCode: "900004",
      schoolName: "Locked School",
      schoolHeadAccount: {
        ...pendingRecord.schoolHeadAccount!,
        id: "account-3",
        accountStatus: "locked",
        lifecycleState: "locked",
        lifecycleStateLabel: "Locked",
        recommendedAction: "send_password_reset_link",
      },
    };

    const handleIssueSchoolHeadSetupLink = vi.fn();
    const openPendingAccountAction = vi.fn();

    function Wrapper(): ReactElement {
      const [openAccountRowMenuSchoolId, setOpenAccountRowMenuSchoolId] = useState<string | null>(null);
      const [query, setQuery] = useState("");
      const [statusFilter, setStatusFilter] = useState<SchoolHeadAccountsStatusFilter>("all");
      const [onlyFlagged, setOnlyFlagged] = useState(false);
      const [onlyDeleteFlagged, setOnlyDeleteFlagged] = useState(false);
      const actions = buildActions();
      actions.openAccountRowMenuSchoolId = openAccountRowMenuSchoolId;
      actions.toggleAccountRowMenu = (schoolId: string) => {
        setOpenAccountRowMenuSchoolId((current) => (current === schoolId ? null : schoolId));
      };
      actions.handleIssueSchoolHeadSetupLink = handleIssueSchoolHeadSetupLink;
      actions.openPendingAccountAction = openPendingAccountAction;

      return (
        <MonitorSchoolHeadAccountsPanel
          isOpen
          isSaving={false}
          isMobileViewport={false}
          rows={[
            {
              schoolKey: "school-2",
              schoolCode: "900002",
              schoolName: "Pending Setup School",
              record: pendingRecord,
            },
            {
              schoolKey: "school-3",
              schoolCode: "900003",
              schoolName: "Active School",
              record: activeRecord,
            },
            {
              schoolKey: "school-4",
              schoolCode: "900004",
              schoolName: "Locked School",
              record: lockedRecord,
            },
          ]}
          totalCount={3}
          query={query}
          statusFilter={statusFilter}
          onlyFlagged={onlyFlagged}
          onlyDeleteFlagged={onlyDeleteFlagged}
          onQueryChange={setQuery}
          onStatusFilterChange={setStatusFilter}
          onOnlyFlaggedChange={setOnlyFlagged}
          onOnlyDeleteFlaggedChange={setOnlyDeleteFlagged}
          onClearFilters={() => {
            setQuery("");
            setStatusFilter("all");
            setOnlyFlagged(false);
            setOnlyDeleteFlagged(false);
          }}
          onClose={vi.fn()}
          onOpenSchoolRecord={vi.fn()}
          formatDateTime={(value) => value ?? "-"}
          actions={actions}
        />
      );
    }

    render(<Wrapper />);

    const rows = screen.getAllByRole("row");
    const pendingRow = rows.find((row) => row.textContent?.includes("Pending Setup School"));
    const activeRow = rows.find((row) => row.textContent?.includes("Active School"));
    const lockedRow = rows.find((row) => row.textContent?.includes("Locked School"));

    expect(pendingRow).not.toBeUndefined();
    expect(activeRow).not.toBeUndefined();
    expect(lockedRow).not.toBeUndefined();
    expect(within(lockedRow!).getByText("Suspended")).not.toBeNull();
    expect(within(lockedRow!).queryByText("Locked")).toBeNull();
    expect(within(pendingRow!).getByText("Activation Needed")).not.toBeNull();
    expect(within(pendingRow!).queryByText("Setup Needed")).toBeNull();
    expect(within(pendingRow!).queryByText("Pending Setup")).toBeNull();
    expect(within(pendingRow!).queryByText("pending_setup")).toBeNull();
    expect(within(pendingRow!).getByText("Setup Link")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Manage Account" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Manage School Head Account" })).toBeNull();

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 520,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });

    const pendingActionButton = within(pendingRow!).getByRole("button", { name: "Actions" });
    pendingActionButton.getBoundingClientRect = vi.fn(() => ({
      x: 780,
      y: 420,
      width: 80,
      height: 32,
      top: 420,
      right: 860,
      bottom: 452,
      left: 780,
      toJSON: () => ({}),
    }));

    fireEvent.click(pendingActionButton);
    let menu = screen.getByRole("menu", { name: "Pending Setup School account actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Activate Account",
      "Remove Account and School",
    ]);
    expect(within(menu).queryByRole("menuitem", { name: "Send Setup Link" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Send Password Reset Link" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Suspend Account" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Activate Account" }));
    expect(openPendingAccountAction).toHaveBeenCalledWith({
      kind: "activate",
      schoolId: "school-2",
      schoolName: "Pending Setup School",
      actionLabel: "Activate Account",
    });
    expect(handleIssueSchoolHeadSetupLink).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Pending Setup School account actions" })).toBeNull();

    const actionButton = within(activeRow!).getByRole("button", { name: "Actions" });
    actionButton.getBoundingClientRect = vi.fn(() => ({
      x: 780,
      y: 460,
      width: 80,
      height: 32,
      top: 460,
      right: 860,
      bottom: 492,
      left: 780,
      toJSON: () => ({}),
    }));

    fireEvent.click(actionButton);
    menu = screen.getByRole("menu", { name: "Active School account actions" });
    expect(menu.closest(".overflow-x-auto")).toBeNull();
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(460);
    const menuItems = within(menu).getAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Send Password Reset Link",
      "Suspend Account",
      "Remove Account and School",
    ]);
    expect(within(menu).queryByRole("menuitem", { name: "Send Setup Link" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Open school record" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Regenerate temporary password" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Lock account" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Archive account" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Reactivate Account" })).toBeNull();
  });

  it("dispatches dropdown actions through the existing guarded flows", () => {
    const buildRecord = (
      id: string,
      schoolCode: string,
      schoolName: string,
      verifiedAt: string | null,
      accountStatus: "active" | "suspended" = "active",
    ): SchoolRecord => ({
      id,
      schoolId: schoolCode,
      schoolCode,
      schoolName,
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-08T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: `account-${id}`,
        name: `${schoolName} Head`,
        email: `${id}@cspams.local`,
        accountStatus,
        mustResetPassword: false,
        lifecycleState: accountStatus === "suspended" ? "suspended" : "active_ready",
        lifecycleStateLabel: accountStatus === "suspended" ? "Suspended" : "Active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt,
        verifiedByUserId: verifiedAt ? "1" : null,
        verifiedByName: verifiedAt ? "Monitor User" : null,
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    });

    const records = [
      buildRecord("school-40", "940001", "Approved Top School", "2026-05-02T08:00:00.000Z"),
      buildRecord("school-41", "940002", "Not Verified Middle School", null),
      buildRecord("school-42", "940003", "Approved Bottom School", "2026-05-03T08:00:00.000Z"),
      buildRecord("school-43", "940004", "Another Bottom School", null),
      buildRecord("school-44", "940005", "Suspended Bottom School", "2026-05-04T08:00:00.000Z", "suspended"),
    ];

    const openPendingAccountAction = vi.fn();
    const handleUpdateSchoolHeadAccount = vi.fn();

    function Wrapper(): ReactElement {
      const [openAccountRowMenuSchoolId, setOpenAccountRowMenuSchoolId] = useState<string | null>(null);
      const actions = buildActions();
      actions.openAccountRowMenuSchoolId = openAccountRowMenuSchoolId;
      actions.toggleAccountRowMenu = (schoolId: string) => {
        setOpenAccountRowMenuSchoolId((current) => (current === schoolId ? null : schoolId));
      };
      actions.openPendingAccountAction = (action) => {
        openPendingAccountAction(action);
      };
      actions.handleUpdateSchoolHeadAccount = (record, update, actionLabel) => {
        handleUpdateSchoolHeadAccount(record, update, actionLabel);
      };

      return (
        <MonitorSchoolHeadAccountsPanel
          isOpen
          isSaving={false}
          isMobileViewport={false}
          rows={records.map((record) => ({
            schoolKey: record.id,
            schoolCode: record.schoolCode ?? "",
            schoolName: record.schoolName,
            record,
          }))}
          totalCount={records.length}
          query=""
          statusFilter="all"
          onlyFlagged={false}
          onlyDeleteFlagged={false}
          onQueryChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onOnlyFlaggedChange={vi.fn()}
          onOnlyDeleteFlaggedChange={vi.fn()}
          onClearFilters={vi.fn()}
          onClose={vi.fn()}
          onOpenSchoolRecord={vi.fn()}
          formatDateTime={(value) => value ?? "-"}
          actions={actions}
        />
      );
    }

    render(<Wrapper />);
    const bottomRow = screen.getAllByRole("row").find((row) => row.textContent?.includes("Another Bottom School"));

    expect(bottomRow).not.toBeUndefined();

    fireEvent.click(within(bottomRow!).getByRole("button", { name: "Actions" }));
    let menu = screen.getByRole("menu", { name: "Another Bottom School account actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Send Password Reset Link" }));
    expect(openPendingAccountAction).toHaveBeenCalledWith({
      kind: "reset_password",
      schoolId: "school-43",
      schoolName: "Another Bottom School",
      actionLabel: "Send Password Reset Link",
    });
    expect(screen.queryByRole("menu", { name: "Another Bottom School account actions" })).toBeNull();

    const suspendedRow = screen.getAllByRole("row").find((row) => row.textContent?.includes("Suspended Bottom School"));
    expect(suspendedRow).not.toBeUndefined();
    fireEvent.click(within(suspendedRow!).getByRole("button", { name: "Actions" }));
    menu = screen.getByRole("menu", { name: "Suspended Bottom School account actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Reactivate Account",
      "Remove Account and School",
    ]);
    expect(within(menu).queryByRole("menuitem", { name: "Send Password Reset Link" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Suspend Account" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Reactivate Account" }));
    expect(handleUpdateSchoolHeadAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: "school-44", schoolName: "Suspended Bottom School" }),
      { accountStatus: "active" },
      "Reactivate Account",
    );
    expect(screen.queryByRole("menu", { name: "Suspended Bottom School account actions" })).toBeNull();

    fireEvent.click(within(bottomRow!).getByRole("button", { name: "Actions" }));
    menu = screen.getByRole("menu", { name: "Another Bottom School account actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Suspend Account" }));
    expect(handleUpdateSchoolHeadAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: "school-43", schoolName: "Another Bottom School" }),
      { accountStatus: "suspended" },
      "Suspend Account",
    );
    expect(screen.queryByRole("menu", { name: "Another Bottom School account actions" })).toBeNull();

    fireEvent.click(within(bottomRow!).getByRole("button", { name: "Actions" }));
    menu = screen.getByRole("menu", { name: "Another Bottom School account actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove Account and School" }));
    expect(openPendingAccountAction).toHaveBeenCalledWith({
      kind: "remove",
      schoolId: "school-43",
      schoolName: "Another Bottom School",
      actionLabel: "Remove Account and School",
    });
    expect(screen.queryByRole("menu", { name: "Another Bottom School account actions" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Manage School Head Account" })).toBeNull();
  });

  it("shows setup-link and temporary-password states distinctly in the Access column", () => {
    const setupLinkRecord: SchoolRecord = {
      id: "school-5",
      schoolId: "900005",
      schoolCode: "900005",
      schoolName: "Setup Link School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-08T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-5",
        name: "Setup User",
        email: "setup@cspams.local",
        accountStatus: "pending_setup",
        mustResetPassword: false,
        onboardingFlow: "setup_link",
        lifecycleState: "pending_setup",
        lifecycleStateLabel: "Pending setup",
        recommendedAction: "send_setup_link",
        emailVerifiedAt: null,
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };

    const tempActiveRecord: SchoolRecord = {
      ...setupLinkRecord,
      id: "school-6",
      schoolId: "900006",
      schoolCode: "900006",
      schoolName: "Temp Active School",
      schoolHeadAccount: {
        ...setupLinkRecord.schoolHeadAccount!,
        id: "account-6",
        email: "temp-active@cspams.local",
        accountStatus: "active",
        mustResetPassword: true,
        onboardingFlow: "temporary_password",
        lifecycleState: "temporary_password_active",
        lifecycleStateLabel: "Temporary password active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        temporaryPasswordIssuedAt: "2026-05-01T08:00:00.000Z",
        temporaryPasswordExpiresAt: "2026-05-03T08:00:00.000Z",
        temporaryPasswordExpired: false,
        temporaryPasswordDisplay: "Ab3Cd4Ef",
      },
    };

    const tempExpiredRecord: SchoolRecord = {
      ...setupLinkRecord,
      id: "school-7",
      schoolId: "900007",
      schoolCode: "900007",
      schoolName: "Temp Expired School",
      schoolHeadAccount: {
        ...tempActiveRecord.schoolHeadAccount!,
        id: "account-7",
        email: "temp-expired@cspams.local",
        lifecycleState: "temporary_password_expired",
        lifecycleStateLabel: "Temporary password expired",
        recommendedAction: "regenerate_temporary_password",
        temporaryPasswordExpired: true,
        temporaryPasswordDisplay: null,
      },
    };

    render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[
          { schoolKey: "school-5", schoolCode: "900005", schoolName: "Setup Link School", record: setupLinkRecord },
          { schoolKey: "school-6", schoolCode: "900006", schoolName: "Temp Active School", record: tempActiveRecord },
          { schoolKey: "school-7", schoolCode: "900007", schoolName: "Temp Expired School", record: tempExpiredRecord },
        ]}
        totalCount={3}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={(value) => value ?? "-"}
        actions={buildActions()}
      />,
    );

    const rows = screen.getAllByRole("row");
    const setupRow = rows.find((row) => row.textContent?.includes("Setup Link School"));
    const activeRow = rows.find((row) => row.textContent?.includes("Temp Active School"));
    const expiredRow = rows.find((row) => row.textContent?.includes("Temp Expired School"));

    expect(setupRow).not.toBeUndefined();
    expect(activeRow).not.toBeUndefined();
    expect(expiredRow).not.toBeUndefined();

    expect(screen.getByRole("columnheader", { name: "Access" })).not.toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Temp Pass" })).toBeNull();
    expect(within(setupRow!).getByText("Setup Link")).not.toBeNull();
    expect(within(activeRow!).getByText("Ab3Cd4Ef")).not.toBeNull();
    expect(within(expiredRow!).getByText("Expired")).not.toBeNull();
  });

  it("uses compact temp-password wording and keeps Activity driven only by lastLoginAt", () => {
    const record: SchoolRecord = {
      id: "school-60",
      schoolId: "906000",
      schoolCode: "906000",
      schoolName: "Temp Password School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-14T06:41:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-60",
        name: "Temp User",
        email: "temp-user@cspams.local",
        accountStatus: "active",
        mustResetPassword: true,
        onboardingFlow: "temporary_password",
        lifecycleState: "temporary_password_active",
        lifecycleStateLabel: "Temporary password active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-14T06:41:00.000Z",
        verifiedAt: "2026-05-14T06:41:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: "2026-05-14T06:41:00.000Z",
        temporaryPasswordExpiresAt: "2026-05-15T06:41:00.000Z",
        temporaryPasswordExpired: false,
        temporaryPasswordDisplay: "fBm57ysr",
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };

    render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[{ schoolKey: "school-60", schoolCode: "906000", schoolName: "Temp Password School", record }]}
        totalCount={1}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={() => "5/14/2026 06:41 AM"}
        actions={buildActions()}
      />,
    );

    const row = screen.getAllByRole("row").find((candidate) => candidate.textContent?.includes("Temp Password School"));

    expect(row).not.toBeUndefined();
    expect(within(row!).getByText("Active")).not.toBeNull();
    expect(within(row!).queryByText("Temp Password Active")).toBeNull();
    expect(within(row!).queryByText("Temporary password active")).toBeNull();
    expect(within(row!).queryByText("Monitor approved")).toBeNull();
    expect(within(row!).getByText("Never")).not.toBeNull();
    expect(within(row!).queryByText(/Approved 5\/14\/2026 06:41 AM/i)).toBeNull();
  });

  it("shows only formatted lastLoginAt in Activity once the account has been used", () => {
    const record: SchoolRecord = {
      id: "school-61",
      schoolId: "906001",
      schoolCode: "906001",
      schoolName: "Used Account School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-14T06:41:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-61",
        name: "Used User",
        email: "used-user@cspams.local",
        accountStatus: "active",
        mustResetPassword: false,
        onboardingFlow: "standard",
        lifecycleState: "active_ready",
        lifecycleStateLabel: "Active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-14T06:41:00.000Z",
        verifiedAt: "2026-05-14T06:41:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        temporaryPasswordDisplay: null,
        lastLoginAt: "2026-05-14T06:55:00.000Z",
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };

    render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[{ schoolKey: "school-61", schoolCode: "906001", schoolName: "Used Account School", record }]}
        totalCount={1}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={() => "5/14/2026 06:55 AM"}
        actions={buildActions()}
      />,
    );

    const row = screen.getAllByRole("row").find((candidate) => candidate.textContent?.includes("Used Account School"));

    expect(row).not.toBeUndefined();
    expect(within(row!).getByText("5/14/2026 06:55 AM")).not.toBeNull();
    expect(within(row!).queryByText("Never")).toBeNull();
    expect(within(row!).queryByText(/Approved/i)).toBeNull();
  });

  it("filters activation-needed and suspended account rows with legacy suspended fallbacks", () => {
    const noAccountRecord: SchoolRecord = {
      id: "school-10",
      schoolId: "901010",
      schoolCode: "901010",
      schoolName: "No Account School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-09T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: null,
      indicatorLatest: null,
    };

    const activationNeededRecord: SchoolRecord = {
      ...noAccountRecord,
      id: "school-11",
      schoolId: "901011",
      schoolCode: "901011",
      schoolName: "Activation Needed School",
      schoolHeadAccount: {
        id: "account-11",
        name: "Activation User",
        email: "activation@cspams.local",
        accountStatus: "pending_verification",
        mustResetPassword: false,
        lifecycleState: "pending_verification",
        lifecycleStateLabel: "Pending Verification",
        recommendedAction: "activate_account",
        emailVerifiedAt: null,
        verifiedAt: null,
        verifiedByUserId: null,
        verifiedByName: null,
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
    };

    const suspendedRecord: SchoolRecord = {
      ...activationNeededRecord,
      id: "school-12",
      schoolId: "901012",
      schoolCode: "901012",
      schoolName: "Suspended School",
      schoolHeadAccount: {
        ...activationNeededRecord.schoolHeadAccount!,
        id: "account-12",
        email: "suspended@cspams.local",
        accountStatus: "suspended",
        lifecycleState: "suspended",
        lifecycleStateLabel: "Suspended",
        recommendedAction: "none",
      },
    };

    const setupPendingRecord: SchoolRecord = {
      ...activationNeededRecord,
      id: "school-15",
      schoolId: "901015",
      schoolCode: "901015",
      schoolName: "Setup Pending School",
      schoolHeadAccount: {
        ...activationNeededRecord.schoolHeadAccount!,
        id: "account-15",
        email: "setup-pending@cspams.local",
        accountStatus: "pending_setup",
        lifecycleState: "pending_setup",
        lifecycleStateLabel: "Pending setup",
        recommendedAction: "send_setup_link",
      },
    };

    const legacyLockedRecord: SchoolRecord = {
      ...activationNeededRecord,
      id: "school-13",
      schoolId: "901013",
      schoolCode: "901013",
      schoolName: "Legacy Locked School",
      schoolHeadAccount: {
        ...activationNeededRecord.schoolHeadAccount!,
        id: "account-13",
        email: "locked@cspams.local",
        accountStatus: "locked",
        lifecycleState: "locked",
        lifecycleStateLabel: "Locked",
        recommendedAction: "none",
      },
    };

    const legacyArchivedRecord: SchoolRecord = {
      ...activationNeededRecord,
      id: "school-14",
      schoolId: "901014",
      schoolCode: "901014",
      schoolName: "Legacy Archived School",
      schoolHeadAccount: {
        ...activationNeededRecord.schoolHeadAccount!,
        id: "account-14",
        email: "archived@cspams.local",
        accountStatus: "active",
        lifecycleState: "archived",
        lifecycleStateLabel: "Archived",
        recommendedAction: "none",
      },
    };

    const compactSchoolRows: MonitorSchoolRecordsListRow[] = [
      {
        summary: {
          schoolKey: "school-10",
          schoolCode: "901010",
          schoolName: "No Account School",
          region: "Region II",
          schoolStatus: "active",
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 1,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: noAccountRecord,
      },
      {
        summary: {
          schoolKey: "school-11",
          schoolCode: "901011",
          schoolName: "Activation Needed School",
          region: "Region II",
          schoolStatus: "active",
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 1,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: activationNeededRecord,
      },
      {
        summary: {
          schoolKey: "school-12",
          schoolCode: "901012",
          schoolName: "Suspended School",
          region: "Region II",
          schoolStatus: "active",
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 1,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: suspendedRecord,
      },
      {
        summary: {
          schoolKey: "school-13",
          schoolCode: "901013",
          schoolName: "Legacy Locked School",
          region: "Region II",
          schoolStatus: "active",
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 1,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: legacyLockedRecord,
      },
      {
        summary: {
          schoolKey: "school-14",
          schoolCode: "901014",
          schoolName: "Legacy Archived School",
          region: "Region II",
          schoolStatus: "active",
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 1,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: legacyArchivedRecord,
      },
      {
        summary: {
          schoolKey: "school-15",
          schoolCode: "901015",
          schoolName: "Setup Pending School",
          region: "Region II",
          schoolStatus: "active",
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 1,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: setupPendingRecord,
      },
    ];

    const recordBySchoolKey = new Map<string, SchoolRecord>([
      ["school-10", noAccountRecord],
      ["school-11", activationNeededRecord],
      ["school-12", suspendedRecord],
      ["school-13", legacyLockedRecord],
      ["school-14", legacyArchivedRecord],
      ["school-15", setupPendingRecord],
    ]);

    const { result } = renderHook(() =>
      useMonitorSchoolHeadAccountsPanelState({
        isMobileViewport: false,
        isSaving: false,
        compactSchoolRows,
        recordBySchoolKey,
        pushToast: vi.fn(),
        updateSchoolHeadAccountStatus: vi.fn() as any,
        activateSchoolHeadAccount: vi.fn() as any,
        issueSchoolHeadAccountActionVerificationCode: vi.fn() as any,
        issueSchoolHeadSetupLink: vi.fn() as any,
        issueSchoolHeadPasswordResetLink: vi.fn() as any,
        issueSchoolHeadTemporaryPassword: vi.fn() as any,
        upsertSchoolHeadAccountProfile: vi.fn() as any,
        removeSchoolHeadAccount: vi.fn() as any,
        onOpenSchoolRecord: vi.fn(),
        formatDateTime: (value) => value,
      }),
    );

    act(() => {
      result.current.toggleSchoolHeadAccountsPanel();
    });

    const panelProps = result.current.schoolHeadAccountsPanelProps;
    expect(panelProps).not.toBeNull();

    act(() => {
      panelProps!.onStatusFilterChange("activation_needed");
    });
    expect(result.current.schoolHeadAccountsPanelProps?.rows.map((row) => row.schoolName)).toEqual([
      "Activation Needed School",
      "Setup Pending School",
    ]);

    act(() => {
      result.current.schoolHeadAccountsPanelProps!.onStatusFilterChange("suspended");
    });
    expect(result.current.schoolHeadAccountsPanelProps?.rows.map((row) => row.schoolName)).toEqual([
      "Legacy Archived School",
      "Legacy Locked School",
      "Suspended School",
    ]);
  });

  it("uses all school records for account management instead of the filtered compact rows", () => {
    const hiddenNoAccountRecord: SchoolRecord = {
      id: "school-15",
      schoolId: "901015",
      schoolCode: "901015",
      schoolName: "Filtered Out No Account School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-09T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: null,
      indicatorLatest: null,
    };
    const visibleAccountRecord: SchoolRecord = {
      ...hiddenNoAccountRecord,
      id: "school-16",
      schoolId: "901016",
      schoolCode: "901016",
      schoolName: "Visible Account School",
      schoolHeadAccount: {
        id: "account-16",
        name: "Visible Head",
        email: "visible@cspams.local",
        accountStatus: "active",
        mustResetPassword: false,
        lifecycleState: "active_ready",
        lifecycleStateLabel: "Active",
        recommendedAction: "none",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt: "2026-05-02T08:00:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
    };
    const compactSchoolRows: MonitorSchoolRecordsListRow[] = [
      {
        summary: {
          schoolKey: visibleAccountRecord.id,
          schoolCode: visibleAccountRecord.schoolCode ?? "",
          schoolName: visibleAccountRecord.schoolName,
          region: visibleAccountRecord.region,
          schoolStatus: visibleAccountRecord.status,
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: true,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 0,
          lastActivityAt: null,
          lastActivityTime: 0,
        },
        record: visibleAccountRecord,
      },
    ];

    const { result } = renderHook(() =>
      useMonitorSchoolHeadAccountsPanelState({
        isMobileViewport: false,
        isSaving: false,
        records: [hiddenNoAccountRecord, visibleAccountRecord],
        compactSchoolRows,
        pushToast: vi.fn(),
        updateSchoolHeadAccountStatus: vi.fn() as any,
        activateSchoolHeadAccount: vi.fn() as any,
        issueSchoolHeadAccountActionVerificationCode: vi.fn() as any,
        issueSchoolHeadSetupLink: vi.fn() as any,
        issueSchoolHeadPasswordResetLink: vi.fn() as any,
        issueSchoolHeadTemporaryPassword: vi.fn() as any,
        upsertSchoolHeadAccountProfile: vi.fn() as any,
        removeSchoolHeadAccount: vi.fn() as any,
        onOpenSchoolRecord: vi.fn(),
        formatDateTime: (value) => value,
      }),
    );

    act(() => {
      result.current.openSchoolHeadAccountsPanelWithStatus("active");
    });

    expect(result.current.schoolHeadAccountsPanelProps?.totalCount).toBe(2);
    expect(result.current.schoolHeadAccountsPanelProps?.statusFilter).toBe("active");
    expect(result.current.schoolHeadAccountsPanelProps?.rows.map((row) => row.schoolName)).toEqual(["Visible Account School"]);
  });

  it("sorts collapsed active lifecycle states alphabetically within the Active bucket", () => {
    const expiredTempRecord: SchoolRecord = {
      id: "school-20",
      schoolId: "902020",
      schoolCode: "902020",
      schoolName: "Expired Temp Password School",
      level: "Elementary",
      district: "District 1",
      address: "District 1",
      type: "public",
      studentCount: 0,
      teacherCount: 0,
      region: "Region II",
      status: "active",
      submittedBy: "Monitor User",
      lastUpdated: "2026-05-09T08:00:00.000Z",
      deletedAt: null,
      schoolHeadAccount: {
        id: "account-20",
        name: "Expired Temp User",
        email: "expired-temp@cspams.local",
        accountStatus: "active",
        mustResetPassword: true,
        lifecycleState: "temporary_password_expired",
        lifecycleStateLabel: "Temporary password expired",
        recommendedAction: "regenerate_temporary_password",
        emailVerifiedAt: "2026-05-01T08:00:00.000Z",
        verifiedAt: "2026-05-02T08:00:00.000Z",
        verifiedByUserId: "1",
        verifiedByName: "Monitor User",
        verificationNotes: null,
        setupLinkExpiresAt: null,
        temporaryPasswordIssuedAt: "2026-05-01T08:00:00.000Z",
        temporaryPasswordExpiresAt: "2026-05-03T08:00:00.000Z",
        temporaryPasswordExpired: true,
        lastLoginAt: null,
        flagged: false,
        flaggedAt: null,
        flagReason: null,
        deleteRecordFlagged: false,
        deleteRecordFlaggedAt: null,
        deleteRecordReason: null,
      },
      indicatorLatest: null,
    };

    const resetRequiredRecord: SchoolRecord = {
      ...expiredTempRecord,
      id: "school-21",
      schoolId: "902021",
      schoolCode: "902021",
      schoolName: "Password Reset School",
      schoolHeadAccount: {
        ...expiredTempRecord.schoolHeadAccount!,
        id: "account-21",
        email: "reset-needed@cspams.local",
        lifecycleState: "password_reset_required",
        lifecycleStateLabel: "Password change required",
        recommendedAction: "send_password_reset_link",
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
      },
    };

    const activeReadyRecord: SchoolRecord = {
      ...expiredTempRecord,
      id: "school-22",
      schoolId: "902022",
      schoolCode: "902022",
      schoolName: "Active Ready School",
      schoolHeadAccount: {
        ...expiredTempRecord.schoolHeadAccount!,
        id: "account-22",
        email: "ready@cspams.local",
        mustResetPassword: false,
        lifecycleState: "active_ready",
        lifecycleStateLabel: "Active",
        recommendedAction: "none",
        temporaryPasswordIssuedAt: null,
        temporaryPasswordExpiresAt: null,
        temporaryPasswordExpired: false,
      },
    };

    const compactSchoolRows: MonitorSchoolRecordsListRow[] = [expiredTempRecord, resetRequiredRecord, activeReadyRecord].map((record) => ({
      summary: {
        schoolKey: record.id,
        schoolCode: record.schoolCode ?? "",
        schoolName: record.schoolName,
        region: record.region,
        schoolStatus: record.status,
        packageSchoolType: "public",
        requirementModeLabel: "Active package requirements: BMEF and SMEA.",
        activePackageLabel: "BMEF and SMEA",
        hasComplianceRecord: true,
        indicatorStatus: null,
        hasActivePackageSubmission: false,
        hasAnySubmitted: false,
        isComplete: false,
        awaitingReviewCount: 0,
        missingCount: 0,
        lastActivityAt: null,
        lastActivityTime: 0,
      },
      record,
    }));

    const recordBySchoolKey = new Map<string, SchoolRecord>(
      compactSchoolRows.flatMap(({ summary, record }) => (record ? [[summary.schoolKey, record] as const] : [])),
    );

    const { result } = renderHook(() =>
      useMonitorSchoolHeadAccountsPanelState({
        isMobileViewport: false,
        isSaving: false,
        compactSchoolRows,
        recordBySchoolKey,
        pushToast: vi.fn(),
        updateSchoolHeadAccountStatus: vi.fn() as any,
        activateSchoolHeadAccount: vi.fn() as any,
        issueSchoolHeadAccountActionVerificationCode: vi.fn() as any,
        issueSchoolHeadSetupLink: vi.fn() as any,
        issueSchoolHeadPasswordResetLink: vi.fn() as any,
        issueSchoolHeadTemporaryPassword: vi.fn() as any,
        upsertSchoolHeadAccountProfile: vi.fn() as any,
        removeSchoolHeadAccount: vi.fn() as any,
        onOpenSchoolRecord: vi.fn(),
        formatDateTime: (value) => value,
      }),
    );

    act(() => {
      result.current.toggleSchoolHeadAccountsPanel();
    });

    expect(result.current.schoolHeadAccountsPanelProps?.rows.map((row) => row.schoolName)).toEqual([
      "Active Ready School",
      "Expired Temp Password School",
      "Password Reset School",
    ]);
  });

  it("requires reason and confirmation for remove-account-and-school actions", () => {
    const { result } = renderHook(() =>
      useSchoolHeadAccountActions({
        isPanelOpen: true,
        isSaving: false,
        pushToast: vi.fn(),
        updateSchoolHeadAccountStatus: vi.fn() as any,
        activateSchoolHeadAccount: vi.fn() as any,
        issueSchoolHeadAccountActionVerificationCode: vi.fn() as any,
        issueSchoolHeadSetupLink: vi.fn() as any,
        issueSchoolHeadPasswordResetLink: vi.fn() as any,
        issueSchoolHeadTemporaryPassword: vi.fn() as any,
        upsertSchoolHeadAccountProfile: vi.fn() as any,
        removeSchoolHeadAccount: vi.fn() as any,
      }),
    );

    act(() => {
      result.current.openPendingAccountAction({
        kind: "remove",
        schoolId: "school-12",
        schoolName: "Delete Me School",
        actionLabel: "Remove account and school",
      });
    });

    expect(result.current.pendingActionDescription).toContain("This will remove the School Head account");
    expect(result.current.pendingActionRequiresVerification).toBe(true);
    expect(result.current.pendingReasonTooShort).toBe(true);
    expect(result.current.isConfirmPendingAccountActionDisabled).toBe(true);
    expect(result.current.confirmPendingAccountActionLabel).toBe("Remove in 3s");
  });

  it("keeps email-change confirmation disabled while the reason is missing", () => {
    const { result } = renderHook(() =>
      useSchoolHeadAccountActions({
        isPanelOpen: true,
        isSaving: false,
        pushToast: vi.fn(),
        updateSchoolHeadAccountStatus: vi.fn() as any,
        activateSchoolHeadAccount: vi.fn() as any,
        issueSchoolHeadAccountActionVerificationCode: vi.fn() as any,
        issueSchoolHeadSetupLink: vi.fn() as any,
        issueSchoolHeadPasswordResetLink: vi.fn() as any,
        issueSchoolHeadTemporaryPassword: vi.fn() as any,
        upsertSchoolHeadAccountProfile: vi.fn() as any,
        removeSchoolHeadAccount: vi.fn() as any,
      }),
    );

    act(() => {
      result.current.openPendingAccountAction({
        kind: "email_change",
        schoolId: "school-12",
        schoolName: "AMA Computer College - Santiago",
        actionLabel: "Confirm Email Change",
        payload: {
          name: "School Head",
          email: "new.schoolhead@example.com",
        },
      });
    });

    expect(result.current.pendingActionDescription).toContain("security confirmation");
    expect(result.current.pendingReasonTooShort).toBe(true);
    expect(result.current.isConfirmPendingAccountActionDisabled).toBe(true);
  });

  it("submits email-change confirmation with reason, challenge, and code", async () => {
    const issueVerification = vi.fn().mockResolvedValue({
      challengeId: "2acb2c69-26f4-4590-9b68-177b0a3f72d6",
      expiresAt: "2026-06-03T08:00:00.000Z",
      delivery: "sent",
      deliveryMessage: "Confirmation code sent.",
    });
    const upsertProfile = vi.fn().mockResolvedValue({
      account: {
        id: "user-1",
        name: "School Head",
        email: "new.schoolhead@example.com",
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
        setupLinkExpiresAt: null,
      },
      message: "School Head account updated. Setup link reissued for email verification.",
      delivery: "sent",
      deliveryMessage: "Setup link sent to the School Head email.",
    });

    const { result } = renderHook(() =>
      useSchoolHeadAccountActions({
        isPanelOpen: true,
        isSaving: false,
        pushToast: vi.fn(),
        updateSchoolHeadAccountStatus: vi.fn() as any,
        activateSchoolHeadAccount: vi.fn() as any,
        issueSchoolHeadAccountActionVerificationCode: issueVerification,
        issueSchoolHeadSetupLink: vi.fn() as any,
        issueSchoolHeadPasswordResetLink: vi.fn() as any,
        issueSchoolHeadTemporaryPassword: vi.fn() as any,
        upsertSchoolHeadAccountProfile: upsertProfile,
        removeSchoolHeadAccount: vi.fn() as any,
      }),
    );

    act(() => {
      result.current.openPendingAccountAction({
        kind: "email_change",
        schoolId: "school-12",
        schoolName: "AMA Computer College - Santiago",
        actionLabel: "Confirm Email Change",
        payload: {
          name: "School Head",
          email: "new.schoolhead@example.com",
        },
      });
    });

    await act(async () => {
      await result.current.sendPendingAccountVerificationCode();
    });
    act(() => {
      result.current.updatePendingAccountReason("Email owner changed.");
      result.current.updatePendingVerificationCode("927523");
    });

    await waitFor(() => expect(result.current.isConfirmPendingAccountActionDisabled).toBe(false));

    await act(async () => {
      await result.current.confirmPendingAccountAction();
    });

    expect(upsertProfile).toHaveBeenCalledWith("school-12", {
      name: "School Head",
      email: "new.schoolhead@example.com",
      reason: "Email owner changed.",
      verificationChallengeId: "2acb2c69-26f4-4590-9b68-177b0a3f72d6",
      verificationCode: "927523",
    });
  });

  it("renders reason and confirmation-code controls for remove-account-and-school", () => {
    const actions = buildActions();
    actions.pendingAccountAction = {
      kind: "remove",
      schoolId: "school-12",
      schoolName: "Batal Elementary School",
      actionLabel: "Remove account and school",
    };
    actions.pendingActionDescription =
      "This will remove the School Head account and linked school record from the active monitor dashboard. This action cannot be undone from this screen.";
    actions.pendingActionRequiresVerification = true;
    actions.confirmPendingAccountActionLabel = "Remove Account and School";
    actions.isConfirmPendingAccountActionDisabled = true;

    render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[]}
        totalCount={0}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={(value) => value ?? "-"}
        actions={actions}
      />,
    );

    expect(screen.queryByText(/This permanently deletes Batal Elementary School/i)).toBeNull();
    expect(screen.getByLabelText("Internal Reason")).not.toBeNull();
    expect(screen.queryByPlaceholderText(/Optional note for permanent removal/i)).toBeNull();
    expect(screen.queryByText(/This removes Batal Elementary School from active Schools/i)).toBeNull();
    expect(screen.getByText(/This will remove the School Head account/i)).not.toBeNull();
    expect(screen.getByText(/School: Batal Elementary School/i)).not.toBeNull();
    expect(screen.getAllByText(/Internal Reason/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Security Confirmation/i)).not.toBeNull();
    expect(screen.getByText("Confirmation Code")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send code" })).not.toBeNull();
    expect(screen.queryByText("Please provide a reason with at least 5 characters.")).toBeNull();
    expect(screen.queryByText("Enter a reason and the 6-digit code sent to your monitor email.")).toBeNull();
  });

  it("shows sectioned notification controls in guarded account action dialogs without removed helper wording", () => {
    const renderDialog = (actions: SchoolHeadAccountActionsApi) => render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[]}
        totalCount={0}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={(value) => value ?? "-"}
        actions={actions}
      />,
    );

    const suspendActions = buildActions();
    suspendActions.pendingAccountAction = {
      kind: "status",
      schoolId: "school-1",
      schoolName: "Suspended School",
      actionLabel: "Suspend Account",
      update: { accountStatus: "suspended" },
    };
    suspendActions.pendingActionRequiresVerification = true;
    suspendActions.pendingShowsNotifySchoolHead = true;
    suspendActions.pendingShowsIncludeReasonInEmail = true;
    suspendActions.pendingNotifySchoolHead = true;
    suspendActions.confirmPendingAccountActionLabel = "Suspend Account";
    const { unmount } = renderDialog(suspendActions);

    expect(screen.getByRole("heading", { name: "Suspend Account" })).not.toBeNull();
    expect(screen.queryByText("Enter a reason and the 6-digit code sent to your monitor email.")).toBeNull();
    expect(screen.queryByText("Please provide a reason with at least 5 characters.")).toBeNull();
    expect(screen.getByLabelText("Internal Reason")).not.toBeNull();
    expect(screen.getAllByText(/Internal Reason/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Email Notice/i)).not.toBeNull();
    expect(screen.getByText(/Security Confirmation/i)).not.toBeNull();
    expect(screen.getByText("Confirmation Code")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send code" })).not.toBeNull();
    expect((screen.getByLabelText("Notify School Head by email") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Include internal reason in the email")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Suspend Account" })).not.toBeNull();
    unmount();

    const removeActions = buildActions();
    removeActions.pendingAccountAction = {
      kind: "remove",
      schoolId: "school-2",
      schoolName: "Removed School",
      actionLabel: "Remove Account and School",
    };
    removeActions.pendingActionRequiresVerification = true;
    removeActions.pendingShowsNotifySchoolHead = true;
    removeActions.pendingShowsIncludeReasonInEmail = true;
    removeActions.pendingNotifySchoolHead = true;
    removeActions.confirmPendingAccountActionLabel = "Remove Account and School";
    const removeRender = renderDialog(removeActions);
    expect(screen.getByRole("heading", { name: "Remove Account and School" })).not.toBeNull();
    expect(screen.getAllByText(/Internal Reason/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Email Notice/i)).not.toBeNull();
    expect(screen.getByText(/Security Confirmation/i)).not.toBeNull();
    expect(screen.getByLabelText("Notify School Head by email before removal")).not.toBeNull();
    expect((screen.getByLabelText("Notify School Head by email before removal") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Include internal reason in the removal notice")).not.toBeNull();
    removeRender.unmount();

    const resetActions = buildActions();
    resetActions.pendingAccountAction = {
      kind: "reset_password",
      schoolId: "school-3",
      schoolName: "Reset School",
      actionLabel: "Send Password Reset Link",
    };
    resetActions.pendingActionRequiresVerification = true;
    resetActions.pendingShowsNotifySchoolHead = false;
    resetActions.pendingShowsIncludeReasonInEmail = true;
    resetActions.confirmPendingAccountActionLabel = "Send Reset Link";
    renderDialog(resetActions);
    expect(screen.getByRole("heading", { name: "Send Password Reset Link" })).not.toBeNull();
    expect(screen.getAllByText(/Internal Reason/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Email Content/i)).not.toBeNull();
    expect(screen.getByText(/Security Confirmation/i)).not.toBeNull();
    expect(screen.queryByLabelText("Notify School Head by email")).toBeNull();
    expect(screen.getByLabelText("Include internal reason in the password reset email")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Send Reset Link" })).not.toBeNull();
  });

  it("does not surface the batch delete toolbar trigger even when flagged-school counts are present", () => {
    render(
      <MonitorSchoolHeadAccountsPanel
        isOpen
        isSaving={false}
        isMobileViewport={false}
        rows={[]}
        totalCount={0}
        query=""
        statusFilter="all"
        onlyFlagged={false}
        onlyDeleteFlagged={false}
        onQueryChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onOnlyFlaggedChange={vi.fn()}
        onOnlyDeleteFlaggedChange={vi.fn()}
        onClearFilters={vi.fn()}
        onClose={vi.fn()}
        onOpenSchoolRecord={vi.fn()}
        formatDateTime={(value) => value ?? "-"}
        actions={buildActions()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Open batch delete flagged schools" })).toBeNull();
    expect(screen.queryByText(/Permanently delete 3 flagged schools/i)).toBeNull();
  });
});
