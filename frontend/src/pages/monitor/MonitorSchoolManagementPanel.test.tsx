import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    lifecycleState: accountStatus === "suspended" ? "suspended" : "active_ready",
    lifecycleStateLabel: accountStatus === "suspended" ? "Suspended" : "Active",
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

    expect(screen.getByText("Pending Setup")).toBeTruthy();
    expect(screen.queryByText("pending setup")).toBeNull();
  });

  it("formats school levels for display while keeping edit options backend-supported", () => {
    render(
      <MonitorSchoolManagementPanel
        record={{ ...buildRecord("active"), level: "Senior High" }}
        isSaving={false}
        updateRecord={vi.fn()}
        onToast={vi.fn()}
      />,
    );

    expect(screen.getByText("Senior High")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit School Details" }));

    const levelSelect = screen.getByLabelText("Level") as HTMLSelectElement;
    const options = Array.from(levelSelect.options).map((option) => option.value);

    expect(options).toEqual(["Elementary", "High School"]);
    expect(options).not.toContain("Junior High");
    expect(options).not.toContain("Senior High");
  });
});
