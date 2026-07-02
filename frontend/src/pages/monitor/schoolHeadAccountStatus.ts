import type { SchoolRecord } from "@/types";

export type SchoolHeadAccountUiStatus = "no_account" | "activation_needed" | "active" | "suspended";
export type SchoolHeadAccountsStatusFilter = "all" | Exclude<SchoolHeadAccountUiStatus, "no_account">;

type SchoolHeadAccount = SchoolRecord["schoolHeadAccount"];

const ACTIVE_STATES = new Set([
  "active",
  "active_ready",
  "temporary_password_active",
  "temporary_password_expired",
  "password_reset_required",
]);
const ACTIVATION_NEEDED_STATES = new Set(["pending_setup", "pending_verification"]);
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

  if (ACTIVATION_NEEDED_STATES.has(accountStatus) || ACTIVATION_NEEDED_STATES.has(lifecycleState)) {
    return "activation_needed";
  }

  if (ACTIVE_STATES.has(accountStatus) || ACTIVE_STATES.has(lifecycleState)) {
    return "active";
  }

  return "active";
}

export function schoolHeadAccountStatusLabel(status: SchoolHeadAccountUiStatus): string {
  if (status === "activation_needed") return "Activation Needed";
  if (status === "suspended") return "Suspended";
  if (status === "active") return "Active";
  return "No Account";
}

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

export const SCHOOL_HEAD_ACCOUNT_STATUS_FILTER_OPTIONS: Array<{
  id: SchoolHeadAccountsStatusFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "activation_needed", label: "Activation Needed" },
  { id: "suspended", label: "Suspended" },
];
