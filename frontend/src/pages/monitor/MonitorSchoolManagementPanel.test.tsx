import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorSchoolManagementPanel } from "@/pages/monitor/MonitorSchoolManagementPanel";
import type { SchoolHeadAccountSummary, SchoolRecord } from "@/types";

afterEach(() => {
  cleanup();
});

function buildAccount(accountStatus: string): SchoolHeadAccountSummary {
  return {
    id: "account-1",
    name: "School Head",
    email: "head@example.com",
    emailVerifiedAt: "2026-05-01T08:00:00.000Z",
    lastLoginAt: null,
    accountStatus,
    mustResetPassword: false,
    lifecycleState: accountStatus === "suspended" || accountStatus === "pending_setup" ? accountStatus : "active_ready",
    lifecycleStateLabel: accountStatus === "suspended" ? "Suspended" : accountStatus === "pending_setup" ? "Pending setup" : "Active",
    recommendedAction: "none",
    verifiedAt: "2026-05-01T08:00:00.000Z",
    verifiedByUserId: "1",
    verifiedByName: "Monitor User",
    verificationNotes: null,
    flagged: false,
    flaggedAt: null,
    flagReason: null,
    deleteRecordFlagged: false,
    deleteRecordFlaggedAt: null,
    deleteRecordReason: null,
    setupLinkExpiresAt: null,
  };
}

function buildRecord(accountStatus: string): SchoolRecord {
  return {
    id: "school-1",
    schoolId: "108323",
    schoolCode: "108323",
    schoolName: "Abra Elementary School",
    level: "Elementary",
    district: null,
    address: "Main Road",
    type: "public",
    studentCount: 0,
    teacherCount: 0,
    region: "Region II",
    status: "active",
    submittedBy: "Monitor User",
    lastUpdated: "2026-05-01T08:00:00.000Z",
    schoolHeadAccount: buildAccount(accountStatus),
    indicatorLatest: null,
  };
}

describe("MonitorSchoolManagementPanel", () => {
  it("displays Suspended when the linked School Head account is suspended without mutating school status", () => {
    const record = buildRecord("suspended");

    render(
      <MonitorSchoolManagementPanel
        record={record}
        isSaving={false}
        updateRecord={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Suspended")).toHaveLength(2);
    expect(screen.queryByText("Inactive")).toBeNull();
    expect(screen.queryByText("Update school profile fields for this selected school.")).toBeNull();
    expect(screen.queryByText(/Manage School Head account actions/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as Suspended" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Archive School Record" })).toBeNull();
    expect(record.status).toBe("active");
  });

  it("formats School Head account status labels in the management tab", () => {
    const record = buildRecord("pending_setup");

    render(
      <MonitorSchoolManagementPanel
        record={record}
        isSaving={false}
        updateRecord={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    expect(screen.getByText("Activation Needed")).toBeTruthy();
    expect(screen.queryByText("Pending Setup")).toBeNull();
    expect(screen.queryByText("pending setup")).toBeNull();
  });

  it("formats school coverage for display and edits canonical checkbox coverage", async () => {
    const updateRecord = vi.fn().mockResolvedValue(undefined);

    render(
      <MonitorSchoolManagementPanel
        record={{ ...buildRecord("active"), level: "Junior High / Senior High" }}
        isSaving={false}
        updateRecord={updateRecord}
        onToast={vi.fn()}
      />,
    );

    expect(screen.getByText("School Coverage")).toBeTruthy();
    expect(screen.getByText("Junior High / Senior High")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit School Details" }));

    expect(screen.queryByLabelText("Level")).toBeNull();
    fireEvent.click(screen.getByLabelText("Elementary"));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecord).toHaveBeenCalledWith(
        "school-1",
        expect.objectContaining({ level: "Elementary / Junior High / Senior High" }),
      );
    });
  });

  it("preserves untouched legacy High School coverage and warns before saving", async () => {
    const updateRecord = vi.fn().mockResolvedValue(undefined);

    render(
      <MonitorSchoolManagementPanel
        record={{ ...buildRecord("active"), level: "High School" }}
        isSaving={false}
        updateRecord={updateRecord}
        onToast={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit School Details" }));

    expect(screen.getByText("This record uses the old High School label. Select the actual coverage before saving changes.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("School Name"), { target: { value: "Updated Legacy School" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecord).toHaveBeenCalledWith(
        "school-1",
        expect.objectContaining({ schoolName: "Updated Legacy School", level: "High School" }),
      );
    });
  });

  it("submits canonical coverage when a legacy record coverage is changed", async () => {
    const updateRecord = vi.fn().mockResolvedValue(undefined);

    render(
      <MonitorSchoolManagementPanel
        record={{ ...buildRecord("active"), level: "High School" }}
        isSaving={false}
        updateRecord={updateRecord}
        onToast={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit School Details" }));
    fireEvent.click(screen.getByLabelText("Junior High"));
    fireEvent.click(screen.getByLabelText("Senior High"));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecord).toHaveBeenCalledWith(
        "school-1",
        expect.objectContaining({ level: "Junior High / Senior High" }),
      );
    });
  });

  it("rejects empty coverage when editing a non-legacy record", async () => {
    const updateRecord = vi.fn().mockResolvedValue(undefined);

    render(
      <MonitorSchoolManagementPanel
        record={{ ...buildRecord("active"), level: "Elementary" }}
        isSaving={false}
        updateRecord={updateRecord}
        onToast={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit School Details" }));
    fireEvent.click(screen.getByLabelText("Elementary"));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("School coverage is required.")).toBeTruthy();
    expect(updateRecord).not.toHaveBeenCalled();
  });
});
