import { describe, expect, it } from "vitest";
import {
  resolveSchoolHeadAccountUiStatus,
  schoolHeadAccountMatchesStatusFilter,
  schoolHeadAccountStatusLabel,
} from "@/pages/monitor/schoolHeadAccountStatus";
import type { SchoolHeadAccountSummary } from "@/types";

function account(
  accountStatus: string,
  lifecycleState = accountStatus,
): SchoolHeadAccountSummary {
  return {
    id: `account-${accountStatus}-${lifecycleState}`,
    name: "School Head",
    email: "head@cspams.local",
    emailVerifiedAt: null,
    lastLoginAt: null,
    accountStatus,
    mustResetPassword: false,
    lifecycleState,
    lifecycleStateLabel: null,
    recommendedAction: "none",
    verifiedAt: null,
    verifiedByUserId: null,
    verifiedByName: null,
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

describe("schoolHeadAccountStatus", () => {
  it("maps backend account states to the simplified frontend statuses", () => {
    expect(resolveSchoolHeadAccountUiStatus(null)).toBe("no_account");
    expect(resolveSchoolHeadAccountUiStatus(account("pending_setup"))).toBe("activation_needed");
    expect(resolveSchoolHeadAccountUiStatus(account("pending_verification"))).toBe("activation_needed");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "temporary_password_active"))).toBe("active");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "temporary_password_expired"))).toBe("active");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "password_reset_required"))).toBe("active");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "active_ready"))).toBe("active");
    expect(resolveSchoolHeadAccountUiStatus(account("suspended"))).toBe("suspended");
    expect(resolveSchoolHeadAccountUiStatus(account("locked"))).toBe("suspended");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "archived"))).toBe("suspended");
  });

  it("uses the simplified labels and combined activation filter", () => {
    expect(schoolHeadAccountStatusLabel("activation_needed")).toBe("Activation Needed");
    expect(schoolHeadAccountStatusLabel("no_account")).toBe("No Account");
    expect(schoolHeadAccountMatchesStatusFilter(account("pending_setup"), "activation_needed")).toBe(true);
    expect(schoolHeadAccountMatchesStatusFilter(account("pending_verification"), "activation_needed")).toBe(true);
    expect(schoolHeadAccountMatchesStatusFilter(account("pending_setup"), "active")).toBe(false);
  });
});
