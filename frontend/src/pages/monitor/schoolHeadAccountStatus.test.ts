import { describe, expect, it } from "vitest";
import {
  formatSchoolHeadAccountUiStatus,
  schoolHeadAccountMatchesFilter,
  schoolHeadAccountCanBeActivated,
  resolveSchoolHeadAccountUiStatus,
  schoolHeadAccountMatchesStatusFilter,
  schoolHeadAccountStatusLabel,
  schoolHeadAccountStatusTone,
} from "@/pages/monitor/schoolHeadAccountStatus";
import type { SchoolHeadAccountSummary } from "@/types";

function account(
  accountStatus: string,
  lifecycleState?: string,
): SchoolHeadAccountSummary {
  const resolvedLifecycleState = arguments.length > 1 ? lifecycleState : accountStatus;

  return {
    id: `account-${accountStatus}-${lifecycleState}`,
    name: "School Head",
    email: "head@cspams.local",
    emailVerifiedAt: null,
    lastLoginAt: null,
    accountStatus,
    mustResetPassword: false,
    lifecycleState: resolvedLifecycleState,
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
    expect(resolveSchoolHeadAccountUiStatus(account("active", "temporary_password_active"))).toBe("activation_needed");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "temporary_password_expired"))).toBe("activation_needed");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "password_reset_required"))).toBe("activation_needed");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "active_ready"))).toBe("active");
    expect(resolveSchoolHeadAccountUiStatus(account("active", undefined))).toBe("active");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "new_backend_lifecycle"))).toBe("activation_needed");
    expect(resolveSchoolHeadAccountUiStatus(account("suspended"))).toBe("suspended");
    expect(resolveSchoolHeadAccountUiStatus(account("locked"))).toBe("suspended");
    expect(resolveSchoolHeadAccountUiStatus(account("active", "archived"))).toBe("suspended");
  });

  it("uses the simplified labels and combined activation filter", () => {
    expect(schoolHeadAccountStatusLabel("activation_needed")).toBe("Activation Needed");
    expect(formatSchoolHeadAccountUiStatus("suspended")).toBe("Suspended");
    expect(schoolHeadAccountStatusLabel("no_account")).toBe("No Account");
    expect(schoolHeadAccountMatchesStatusFilter(account("pending_setup"), "activation_needed")).toBe(true);
    expect(schoolHeadAccountMatchesFilter(account("pending_setup"), "activation_needed")).toBe(true);
    expect(schoolHeadAccountMatchesStatusFilter(account("pending_verification"), "activation_needed")).toBe(true);
    expect(schoolHeadAccountMatchesStatusFilter(account("active", "temporary_password_active"), "activation_needed")).toBe(true);
    expect(schoolHeadAccountMatchesStatusFilter(account("active", "temporary_password_active"), "active")).toBe(false);
    expect(schoolHeadAccountMatchesStatusFilter(account("pending_setup"), "active")).toBe(false);
  });

  it("only allows the activate action for pending verification accounts", () => {
    expect(schoolHeadAccountCanBeActivated(account("pending_verification"))).toBe(true);
    expect(schoolHeadAccountCanBeActivated(account("active", "pending_verification"))).toBe(true);
    expect(schoolHeadAccountCanBeActivated(account("pending_setup"))).toBe(false);
    expect(schoolHeadAccountCanBeActivated(account("active", "temporary_password_active"))).toBe(false);
    expect(schoolHeadAccountCanBeActivated(account("active", "temporary_password_expired"))).toBe(false);
    expect(schoolHeadAccountCanBeActivated(account("active", "password_reset_required"))).toBe(false);
    expect(schoolHeadAccountCanBeActivated(null)).toBe(false);
  });

  it("returns consistent status badge tones", () => {
    expect(schoolHeadAccountStatusTone("active")).toContain("bg-primary-100");
    expect(schoolHeadAccountStatusTone("activation_needed")).toContain("bg-amber-50");
    expect(schoolHeadAccountStatusTone("suspended")).toContain("bg-rose-50");
    expect(schoolHeadAccountStatusTone("no_account")).toContain("bg-slate-");
  });
});
