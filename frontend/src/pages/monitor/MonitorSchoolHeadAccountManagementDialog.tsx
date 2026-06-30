import {
  AlertCircle,
  CheckCircle2,
  Edit2,
  ExternalLink,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { SchoolRecord } from "@/types";
import type { SchoolHeadAccountActionsApi } from "./useSchoolHeadAccountActions";

interface MonitorSchoolHeadAccountManagementDialogProps {
  record: SchoolRecord | null;
  isSaving: boolean;
  isDeleteSchoolRecordLoading: boolean;
  isMobileViewport: boolean;
  onClose: () => void;
  onOpenSchoolRecord: (record: SchoolRecord) => void;
  onPreviewDeleteSchoolRecord: (record: SchoolRecord) => void | Promise<void>;
  formatDateTime: (value: string | null) => string;
  actions: SchoolHeadAccountActionsApi;
}

function accountStatusLabel(
  status: string | null | undefined,
  lifecycleStateLabel: string | null | undefined,
  lifecycleState: string | null | undefined,
): string {
  if (String(lifecycleState ?? "").toLowerCase() === "temporary_password_active") {
    return "Temp Password Active";
  }

  const normalizedLifecycleLabel = lifecycleStateLabel?.trim();
  if (normalizedLifecycleLabel) return normalizedLifecycleLabel;
  if (!status) return "No Account";
  const normalized = status.toLowerCase();
  if (normalized === "active") return "Active";
  if (normalized === "pending_setup") return "Pending Setup";
  if (normalized === "pending_verification") return "Pending Verification";
  if (normalized === "suspended") return "Suspended";
  if (normalized === "locked") return "Locked";
  if (normalized === "archived") return "Archived";
  return status;
}

function temporaryPasswordSummary(account: SchoolRecord["schoolHeadAccount"]): string {
  if (!account) return "No account";
  if (account.temporaryPasswordDisplay) return "Temporary password visible";
  if (account.lifecycleState === "temporary_password_active") return "Temporary password active";
  if (account.lifecycleState === "temporary_password_expired") return "Temporary password expired";
  if (account.lifecycleState === "pending_setup" || account.lifecycleState === "pending_verification") {
    return "Setup-link onboarding";
  }
  return "No temporary password";
}

function shouldShowResetLinkAction(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "active" || normalized === "locked";
}

function ManagementSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-sm border border-slate-200 bg-white p-3">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function actionButtonClass(tone: "default" | "warning" | "archive" | "danger" = "default"): string {
  const base =
    "inline-flex w-full items-center justify-start gap-2 rounded-sm border px-3 py-2 text-left text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

  if (tone === "danger") {
    return `${base} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`;
  }

  if (tone === "archive") {
    return `${base} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`;
  }

  if (tone === "warning") {
    return `${base} border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`;
  }

  return `${base} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`;
}

export function MonitorSchoolHeadAccountManagementDialog({
  record,
  isSaving,
  isMobileViewport,
  onClose,
  onOpenSchoolRecord,
  formatDateTime,
  actions,
}: MonitorSchoolHeadAccountManagementDialogProps): ReactElement | null {
  if (!record) return null;

  const account = record.schoolHeadAccount;
  const normalizedAccountStatus = String(account?.accountStatus ?? "").toLowerCase();
  const isRowSaving = Boolean(actions.accountActionKey?.startsWith(`${record.id}:`));
  const isActionDisabled = isSaving || isRowSaving;
  const dialogTitleId = "school-head-account-management-title";

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 z-[86] bg-slate-900/45"
        aria-label="Close school head account management"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className={`fixed z-[87] max-h-[86vh] w-[min(46rem,calc(100vw-2rem))] overflow-y-auto rounded-sm border border-slate-200 bg-slate-50 p-4 shadow-2xl ${
          isMobileViewport ? "inset-x-4 bottom-4" : "left-1/2 top-12 -translate-x-1/2"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary-700">School Head Account</p>
            <h3 id={dialogTitleId} className="mt-1 text-base font-extrabold text-slate-900">
              Manage School Head Account
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Use the existing guarded flows for account access, account status, and school removal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1 text-slate-600 transition-colors hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <ManagementSection title="Account Summary">
            <dl className="grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-slate-500">School</dt>
                <dd className="mt-0.5 font-semibold text-slate-900">{record.schoolName}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">School Code</dt>
                <dd className="mt-0.5 text-slate-900">{record.schoolCode ?? record.schoolId ?? "-"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Head Name</dt>
                <dd className="mt-0.5 text-slate-900">{account?.name ?? "No account linked"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Head Email</dt>
                <dd className="mt-0.5 break-all text-slate-900">{account?.email ?? "-"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Account Status</dt>
                <dd className="mt-0.5 text-slate-900">
                  {accountStatusLabel(account?.accountStatus, account?.lifecycleStateLabel, account?.lifecycleState)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Last Login</dt>
                <dd className="mt-0.5 text-slate-900">{account?.lastLoginAt ? formatDateTime(account.lastLoginAt) : "Never"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Temporary Password</dt>
                <dd className="mt-0.5 text-slate-900">{temporaryPasswordSummary(account)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Flags</dt>
                <dd className="mt-0.5 text-slate-900">
                  {account?.flagged || account?.deleteRecordFlagged ? "Flagged" : "No flags"}
                </dd>
              </div>
            </dl>
          </ManagementSection>

          <ManagementSection title="Account Profile">
            <p className="text-xs text-slate-600">
              Use the row {account ? "Edit" : "Create account"} action for profile editing in this pass.
            </p>
            <button
              type="button"
              onClick={() => {
                actions.beginEditing(record);
                onClose();
              }}
              disabled={isActionDisabled}
              className={actionButtonClass()}
            >
              <Edit2 className="h-3.5 w-3.5 text-slate-500" />
              {account ? "Edit account" : "Create account"}
            </button>
          </ManagementSection>

          <ManagementSection title="Account Access">
            {account ? (
              <>
                {normalizedAccountStatus === "pending_setup" && (
                  <button
                    type="button"
                    onClick={() => void actions.handleIssueSchoolHeadSetupLink(record)}
                    disabled={isActionDisabled}
                    className={actionButtonClass()}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-primary-600" />
                    Send setup link
                  </button>
                )}
                {shouldShowResetLinkAction(account.accountStatus) && (
                  <button
                    type="button"
                    onClick={() => void actions.handleIssueSchoolHeadSetupLink(record)}
                    disabled={isActionDisabled}
                    className={actionButtonClass()}
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-primary-600" />
                    Send password reset link
                  </button>
                )}
                {normalizedAccountStatus !== "pending_setup" &&
                  !shouldShowResetLinkAction(account.accountStatus) &&
                  normalizedAccountStatus !== "active" && (
                    <p className="text-xs text-slate-600">No account-access action is available for this status.</p>
                  )}
              </>
            ) : (
              <p className="text-xs text-slate-600">Create a School Head account before sending setup or reset links.</p>
            )}
          </ManagementSection>

          <ManagementSection title="Account Status">
            {account ? (
              <>
                {normalizedAccountStatus === "pending_verification" && (
                  <button
                    type="button"
                    onClick={() =>
                      actions.openPendingAccountAction({
                        kind: "activate",
                        schoolId: record.id,
                        schoolName: record.schoolName,
                        actionLabel: "Activate account",
                      })
                    }
                    disabled={isActionDisabled}
                    className={actionButtonClass()}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary-600" />
                    Activate account
                  </button>
                )}
                {normalizedAccountStatus !== "active" &&
                  normalizedAccountStatus !== "pending_setup" &&
                  normalizedAccountStatus !== "pending_verification" && (
                    <button
                      type="button"
                      onClick={() =>
                        actions.handleUpdateSchoolHeadAccount(record, { accountStatus: "active" }, "Reactivate account")
                      }
                      disabled={isActionDisabled}
                      className={actionButtonClass()}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary-600" />
                      Reactivate account
                    </button>
                  )}
                {normalizedAccountStatus === "active" && (
                  <button
                    type="button"
                    onClick={() =>
                      actions.handleUpdateSchoolHeadAccount(record, { accountStatus: "suspended" }, "Suspend account")
                    }
                    disabled={isActionDisabled}
                    className={actionButtonClass("warning")}
                  >
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                    Suspend account
                  </button>
                )}
                {normalizedAccountStatus === "pending_setup" && (
                  <p className="text-xs text-slate-600">Setup must be completed before status changes are available.</p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-600">No account status exists yet.</p>
            )}
          </ManagementSection>

          <ManagementSection title="School Record">
            <button
              type="button"
              onClick={() => {
                onOpenSchoolRecord(record);
                onClose();
              }}
              className={actionButtonClass()}
            >
              <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
              Open school record
            </button>
          </ManagementSection>

          <ManagementSection title="Danger Zone">
            {account ? (
              <button
                type="button"
                onClick={() =>
                  actions.openPendingAccountAction({
                    kind: "remove",
                    schoolId: record.id,
                    schoolName: record.schoolName,
                    actionLabel: "Remove account and school",
                  })
                }
                disabled={isActionDisabled}
                className={actionButtonClass("danger")}
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                Remove account and school
              </button>
            ) : (
              <p className="text-xs text-slate-600">No account is linked. Create an account before using account removal.</p>
            )}
          </ManagementSection>
        </div>
      </section>
    </>
  );
}
