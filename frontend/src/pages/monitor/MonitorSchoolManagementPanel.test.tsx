import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonitorSchoolManagementPanel } from "@/pages/monitor/MonitorSchoolManagementPanel";
import type { SchoolHeadAccountSummary, SchoolRecord } from "@/types";

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

    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(screen.queryByText("Inactive")).toBeNull();
    expect(screen.queryByText("Update school profile fields for this selected school.")).toBeNull();
    expect(screen.queryByText(/Manage School Head account actions/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as Suspended" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Archive School Record" })).toBeNull();
    expect(record.status).toBe("active");
  });
});
