import { describe, expect, it } from "vitest";
import {
  applyMonitorAccountStatusOverrides,
  buildMonitorAccountStatusOverride,
  pruneMonitorAccountStatusOverrides,
} from "@/pages/monitor/monitorAccountStatusOverrides";
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

function buildRecord(accountStatus = "active"): SchoolRecord {
  return {
    id: "school-1",
    schoolId: "108323",
    schoolCode: "108323",
    schoolName: "Abra Elementary School",
    level: "Elementary",
    district: null,
    address: null,
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

describe("monitor account status overrides", () => {
  it("overlays confirmed account status without mutating the school record status", () => {
    const record = buildRecord("active");
    const override = buildMonitorAccountStatusOverride("school-1", record, buildAccount("suspended"), 1000);
    const [nextRecord] = applyMonitorAccountStatusOverrides([record], { "school-1": override });

    expect(nextRecord.status).toBe("active");
    expect(nextRecord.schoolHeadAccount?.accountStatus).toBe("suspended");
    expect(record.status).toBe("active");
    expect(record.schoolHeadAccount?.accountStatus).toBe("active");
  });

  it("keeps a pending override across stale server data and clears it when the server confirms", () => {
    const staleRecord = buildRecord("active");
    const override = buildMonitorAccountStatusOverride("school-1", staleRecord, buildAccount("suspended"), 1000);
    const overrides = { "school-1": override };

    expect(pruneMonitorAccountStatusOverrides([staleRecord], overrides, 2000)).toBe(overrides);
    expect(pruneMonitorAccountStatusOverrides([buildRecord("suspended")], overrides, 2000)).toEqual({});
  });
});
