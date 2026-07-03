import type { SchoolRecord } from "@/types";

export type SchoolHeadAccountUiStatus = "no_account" | "activation_needed" | "active" | "suspended";
export type SchoolHeadAccountsStatusFilter = "all" | Exclude<SchoolHeadAccountUiStatus, "no_account">;

type SchoolHeadAccount = SchoolRecord["schoolHeadAccount"];

const ACTIVE_LIFECYCLE_STATES = new Set(["active_ready"]);
const ACTIVATION_NEEDED_STATES = new Set([
  "pending_setup",
  "pending_verification",
  "temporary_password_active",
  "temporary_password_expired",
  "password_reset_required",
]);
const SUSPENDED_STATES = new Set(["suspended", "locked", "archived"]);

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveSchoolHeadAccountUiStatus(account: SchoolHeadAccount): SchoolHeadAccountUiStatus {
  if (!account) {
    return "no_account";
  }

  const accountStatus = normalizeStatus(account.accountStatus);
  const lifecycleState = normalizeStatus(account.lifecycleState);

  if (SUSPENDED_STATES.has(accountStatus) || SUSPENDED_STATES.has(lifecycleState)) {
    return "suspended";
  }

  if (lifecycleState) {
    if (ACTIVE_LIFECYCLE_STATES.has(lifecycleState)) {
      return "active";
    }

    return "activation_needed";
  }

  if (ACTIVATION_NEEDED_STATES.has(accountStatus)) {
    return "activation_needed";
  }

  if (accountStatus === "active" || ACTIVE_LIFECYCLE_STATES.has(accountStatus)) {
    return "active";
  }

  return "activation_needed";
}

export function schoolHeadAccountCanBeActivated(account: SchoolHeadAccount): boolean {
  if (!account) {
    return false;
  }

  return (
    normalizeStatus(account.accountStatus) === "pending_verification" ||
    normalizeStatus(account.lifecycleState) === "pending_verification"
  );
}

export function schoolHeadAccountStatusLabel(status: SchoolHeadAccountUiStatus): string {
  if (status === "activation_needed") return "Activation Needed";
  if (status === "suspended") return "Suspended";
  if (status === "active") return "Active";
  return "No Account";
}

export const formatSchoolHeadAccountUiStatus = schoolHeadAccountStatusLabel;

export function schoolHeadAccountStatusTone(status: SchoolHeadAccountUiStatus): string {
  if (status === "activation_needed") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (status === "suspended") return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
  if (status === "active") return "bg-primary-100 text-primary-700 ring-1 ring-primary-300";
  return "bg-slate-200 text-slate-700 ring-1 ring-slate-300";
}

export function schoolHeadAccountMatchesStatusFilter(
  account: SchoolHeadAccount,
  statusFilter: SchoolHeadAccountsStatusFilter,
): boolean {
  if (statusFilter === "all") {
    return true;
  }

  return resolveSchoolHeadAccountUiStatus(account) === statusFilter;
}

export const schoolHeadAccountMatchesFilter = schoolHeadAccountMatchesStatusFilter;

export const SCHOOL_HEAD_ACCOUNT_STATUS_FILTER_OPTIONS: Array<{
  id: SchoolHeadAccountsStatusFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "activation_needed", label: "Activation Needed" },
  { id: "suspended", label: "Suspended" },
];
