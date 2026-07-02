import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { messageForApiError } from "@/lib/api";
import type {
  SchoolHeadAccountActivationResult,
  SchoolHeadAccountActionVerificationCodeResult,
  SchoolHeadAccountPayload,
  SchoolHeadAccountProfileUpsertResult,
  SchoolHeadAccountRemovalPayload,
  SchoolHeadAccountRemovalResult,
  SchoolHeadAccountStatusUpdatePayload,
  SchoolHeadAccountStatusUpdateResult,
  SchoolHeadPasswordResetLinkPayload,
  SchoolHeadPasswordResetLinkResult,
  SchoolHeadSetupLinkResult,
  SchoolHeadTemporaryPasswordResult,
  SchoolRecord,
} from "@/types";

type ToastTone = "success" | "info" | "warning";

export type PendingAccountAction =
  | {
      kind: "status";
      schoolId: string;
      schoolName: string;
      actionLabel: string;
      update: Omit<SchoolHeadAccountStatusUpdatePayload, "reason">;
    }
  | {
      kind: "activate";
      schoolId: string;
      schoolName: string;
      actionLabel: string;
    }
  | {
      kind: "reset_password";
      schoolId: string;
      schoolName: string;
      actionLabel: string;
    }
  | {
      kind: "email_change";
      schoolId: string;
      schoolName: string;
      actionLabel: string;
      payload: SchoolHeadAccountPayload;
    }
  | {
      kind: "temporary_password";
      schoolId: string;
      schoolName: string;
      actionLabel: string;
    }
  | {
      kind: "remove";
      schoolId: string;
      schoolName: string;
      actionLabel: string;
    };

interface UseSchoolHeadAccountActionsOptions {
  isPanelOpen: boolean;
  isSaving: boolean;
  pushToast: (message: string, tone: ToastTone) => void;
  updateSchoolHeadAccountStatus: (
    schoolId: string,
    payload: SchoolHeadAccountStatusUpdatePayload,
  ) => Promise<SchoolHeadAccountStatusUpdateResult>;
  activateSchoolHeadAccount: (
    schoolId: string,
    payload?: { reason?: string | null },
  ) => Promise<SchoolHeadAccountActivationResult>;
  issueSchoolHeadAccountActionVerificationCode: (
    schoolId: string,
    targetStatus: "suspended" | "deleted" | "password_reset" | "email_change" | "temporary_password",
  ) => Promise<SchoolHeadAccountActionVerificationCodeResult>;
  issueSchoolHeadSetupLink: (schoolId: string, reason?: string | null) => Promise<SchoolHeadSetupLinkResult>;
  issueSchoolHeadPasswordResetLink: (
    schoolId: string,
    payload: SchoolHeadPasswordResetLinkPayload,
  ) => Promise<SchoolHeadPasswordResetLinkResult>;
  issueSchoolHeadTemporaryPassword: (
    schoolId: string,
    payload: { reason: string; verificationChallengeId: string; verificationCode: string },
  ) => Promise<SchoolHeadTemporaryPasswordResult>;
  upsertSchoolHeadAccountProfile: (
    schoolId: string,
    payload: SchoolHeadAccountPayload,
  ) => Promise<SchoolHeadAccountProfileUpsertResult>;
  removeSchoolHeadAccount: (
    schoolId: string,
    payload: SchoolHeadAccountRemovalPayload,
  ) => Promise<SchoolHeadAccountRemovalResult>;
}

export interface SchoolHeadAccountActionsApi {
  editingSchoolHeadAccountSchoolId: string | null;
  schoolHeadAccountDraft: SchoolHeadAccountPayload;
  schoolHeadAccountDraftError: string;
  temporaryPasswordReceipt: { schoolName: string; email: string; temporaryPassword: string; message: string } | null;
  openAccountRowMenuSchoolId: string | null;
  pendingAccountAction: PendingAccountAction | null;
  pendingAccountReason: string;
  pendingAccountReasonError: string;
  pendingReasonTooShort: boolean;
  pendingAccountVerificationChallenge: SchoolHeadAccountActionVerificationCodeResult | null;
  pendingAccountVerificationCode: string;
  pendingAccountVerificationError: string;
  pendingActionDescription: string;
  pendingActionRequiresVerification: boolean;
  pendingShowsNotifySchoolHead: boolean;
  pendingShowsIncludeReasonInEmail: boolean;
  pendingNotifySchoolHead: boolean;
  pendingIncludeReasonInEmail: boolean;
  isPendingAccountVerificationSending: boolean;
  isConfirmPendingAccountActionDisabled: boolean;
  confirmPendingAccountActionLabel: string;
  pendingRemoveCountdownSeconds: number;
  accountActionKey: string | null;
  accountRowMenuRef: MutableRefObject<HTMLDivElement | null>;
  pendingAccountReasonRef: MutableRefObject<HTMLTextAreaElement | null>;
  pendingAccountVerificationCodeRef: MutableRefObject<HTMLInputElement | null>;
  beginEditing: (record: SchoolRecord) => void;
  cancelEditing: () => void;
  updateDraftField: (field: "name" | "email", value: string) => void;
  saveProfile: (record: SchoolRecord) => Promise<void>;
  toggleAccountRowMenu: (schoolId: string) => void;
  openPendingAccountAction: (action: PendingAccountAction) => void;
  closePendingAccountAction: () => void;
  updatePendingAccountReason: (value: string) => void;
  updatePendingNotifySchoolHead: (value: boolean) => void;
  updatePendingIncludeReasonInEmail: (value: boolean) => void;
  updatePendingVerificationCode: (value: string) => void;
  sendPendingAccountVerificationCode: () => Promise<void>;
  confirmPendingAccountAction: () => Promise<void>;
  handleUpdateSchoolHeadAccount: (
    record: SchoolRecord,
    update: Omit<SchoolHeadAccountStatusUpdatePayload, "reason">,
    actionLabel: string,
  ) => void;
  handleIssueSchoolHeadSetupLink: (record: SchoolRecord) => Promise<void>;
  copyTemporaryPasswordReceipt: () => void | Promise<void>;
  clearTemporaryPasswordReceipt: () => void;
  resetPanelState: () => void;
}

const EMPTY_DRAFT: SchoolHeadAccountPayload = {
  name: "",
  email: "",
};

function normalizeActionVerificationCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

function isDeactivationStatus(value: unknown): value is "suspended" {
  const normalized = String(value ?? "").toLowerCase();
  return normalized === "suspended";
}

function requiresReason(action: PendingAccountAction | null): boolean {
  if (!action) {
    return false;
  }

  return (
    action.kind === "status"
    || action.kind === "reset_password"
    || action.kind === "temporary_password"
    || action.kind === "email_change"
    || action.kind === "remove"
  );
}

function requiresVerification(action: PendingAccountAction | null): boolean {
  if (!action) {
    return false;
  }

  return (
    action.kind === "reset_password"
    || action.kind === "temporary_password"
    || action.kind === "email_change"
    || action.kind === "remove"
    || (action.kind === "status" && isDeactivationStatus(action.update.accountStatus))
  );
}

function supportsNotifySchoolHead(action: PendingAccountAction | null): boolean {
  return Boolean(
    action?.kind === "remove"
    || (action?.kind === "status" && isDeactivationStatus(action.update.accountStatus)),
  );
}

function supportsIncludeReasonInEmail(action: PendingAccountAction | null): boolean {
  return Boolean(
    action?.kind === "reset_password"
    || action?.kind === "remove"
    || (action?.kind === "status" && isDeactivationStatus(action.update.accountStatus)),
  );
}

function defaultNotifySchoolHead(action: PendingAccountAction): boolean {
  return supportsNotifySchoolHead(action);
}

function verificationTargetForAction(
  action: PendingAccountAction | null,
): "suspended" | "deleted" | "password_reset" | "email_change" | "temporary_password" | null {
  if (!action) {
    return null;
  }

  if (action.kind === "status" && isDeactivationStatus(action.update.accountStatus)) {
    return "suspended";
  }

  if (action.kind === "reset_password") {
    return "password_reset";
  }

  if (action.kind === "temporary_password") {
    return "temporary_password";
  }

  if (action.kind === "remove") {
    return "deleted";
  }

  if (action.kind === "email_change") {
    return "email_change";
  }

  return null;
}

function pendingActionDescription(action: PendingAccountAction | null): string {
  if (!action) {
    return "";
  }

  if (action.kind === "remove") {
    return "This will remove the School Head account and linked school record from the active monitor dashboard. This action cannot be undone from this screen.";
  }

  if (action.kind === "activate") {
    return "This will allow the School Head account to sign in to CSPAMS.";
  }

  if (action.kind === "status") {
    return isDeactivationStatus(action.update.accountStatus)
      ? "This will prevent the School Head from signing in to CSPAMS until the account is reactivated."
      : "This will update the School Head account status.";
  }

  if (action.kind === "reset_password") {
    return "This will send a password reset link to the School Head email and require the account owner to set a new password.";
  }

  if (action.kind === "temporary_password") {
    return "This will generate a new temporary password for the School Head account.";
  }

  return "This will update the School Head account email after security confirmation.";
}

function confirmLabelForAction(action: PendingAccountAction | null, removeCountdownSeconds: number): string {
  if (!action) {
    return "Confirm";
  }

  if (action.kind === "remove") {
    return removeCountdownSeconds > 0
      ? `Remove in ${removeCountdownSeconds}s`
      : "Remove Account and School";
  }

  if (action.kind === "activate") {
    return "Activate Account";
  }

  if (action.kind === "status" && isDeactivationStatus(action.update.accountStatus)) {
    return "Suspend Account";
  }

  if (action.kind === "reset_password") {
    return "Send Reset Link";
  }

  if (action.kind === "temporary_password") {
    return "Generate Temporary Password";
  }

  return action.actionLabel || "Confirm";
}

function announceSchoolHeadAccountDelivery(
  receipt: { delivery?: unknown; deliveryMessage?: string | null },
  schoolName: string,
  linkLabel: "Setup link" | "Password reset link",
  pushToast: (message: string, tone: ToastTone) => void,
): void {
  const normalizedDelivery = String(receipt.delivery ?? "").toLowerCase();
  const deliveryFailed = normalizedDelivery === "failed";

  pushToast(
    deliveryFailed
      ? `${linkLabel} was prepared for ${schoolName}, but email delivery failed.`
      : `${linkLabel} email sent for ${schoolName}.`,
    deliveryFailed ? "warning" : "success",
  );

  const deliveryMessage = receipt.deliveryMessage?.trim();
  if (deliveryMessage) {
    pushToast(deliveryMessage, deliveryFailed ? "warning" : "info");
  }
}

export function useSchoolHeadAccountActions({
  isPanelOpen,
  isSaving,
  pushToast,
  updateSchoolHeadAccountStatus,
  activateSchoolHeadAccount,
  issueSchoolHeadAccountActionVerificationCode,
  issueSchoolHeadSetupLink,
  issueSchoolHeadPasswordResetLink,
  issueSchoolHeadTemporaryPassword,
  upsertSchoolHeadAccountProfile,
  removeSchoolHeadAccount,
}: UseSchoolHeadAccountActionsOptions): SchoolHeadAccountActionsApi {
  const [editingSchoolHeadAccountSchoolId, setEditingSchoolHeadAccountSchoolId] = useState<string | null>(null);
  const [schoolHeadAccountDraft, setSchoolHeadAccountDraft] = useState<SchoolHeadAccountPayload>(EMPTY_DRAFT);
  const [schoolHeadAccountDraftError, setSchoolHeadAccountDraftError] = useState("");
  const [temporaryPasswordReceipt, setTemporaryPasswordReceipt] = useState<{
    schoolName: string;
    email: string;
    temporaryPassword: string;
    message: string;
  } | null>(null);
  const [openAccountRowMenuSchoolId, setOpenAccountRowMenuSchoolId] = useState<string | null>(null);
  const [pendingAccountAction, setPendingAccountAction] = useState<PendingAccountAction | null>(null);
  const [pendingAccountReason, setPendingAccountReason] = useState("");
  const [pendingAccountReasonError, setPendingAccountReasonError] = useState("");
  const [pendingAccountVerificationChallenge, setPendingAccountVerificationChallenge] =
    useState<SchoolHeadAccountActionVerificationCodeResult | null>(null);
  const [pendingAccountVerificationCode, setPendingAccountVerificationCode] = useState("");
  const [pendingAccountVerificationError, setPendingAccountVerificationError] = useState("");
  const [pendingNotifySchoolHead, setPendingNotifySchoolHead] = useState(false);
  const [pendingIncludeReasonInEmail, setPendingIncludeReasonInEmail] = useState(false);
  const [isPendingAccountVerificationSending, setIsPendingAccountVerificationSending] = useState(false);
  const [accountActionKey, setAccountActionKey] = useState<string | null>(null);
  const [pendingRemoveCountdownSeconds, setPendingRemoveCountdownSeconds] = useState(0);

  const accountRowMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingAccountReasonRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingAccountVerificationCodeRef = useRef<HTMLInputElement | null>(null);

  const closePendingAccountAction = useCallback(() => {
    setPendingAccountAction(null);
    setPendingAccountReason("");
    setPendingAccountReasonError("");
    setPendingAccountVerificationChallenge(null);
    setPendingAccountVerificationCode("");
    setPendingAccountVerificationError("");
    setPendingNotifySchoolHead(false);
    setPendingIncludeReasonInEmail(false);
    setPendingRemoveCountdownSeconds(0);
  }, []);

  const resetPanelState = useCallback(() => {
    setEditingSchoolHeadAccountSchoolId(null);
    setSchoolHeadAccountDraft(EMPTY_DRAFT);
    setSchoolHeadAccountDraftError("");
    setTemporaryPasswordReceipt(null);
    setOpenAccountRowMenuSchoolId(null);
    closePendingAccountAction();
  }, [closePendingAccountAction]);

  useEffect(() => {
    if (isPanelOpen) {
      return;
    }

    setOpenAccountRowMenuSchoolId(null);
    closePendingAccountAction();
  }, [closePendingAccountAction, isPanelOpen]);

  useEffect(() => {
    if (!openAccountRowMenuSchoolId || typeof window === "undefined") {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const menu = accountRowMenuRef.current;
      if (!menu) {
        setOpenAccountRowMenuSchoolId(null);
        return;
      }
      if (menu.contains(event.target as Node)) {
        return;
      }
      setOpenAccountRowMenuSchoolId(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAccountRowMenuSchoolId(null);
      }
    };
    const closeMenu = () => setOpenAccountRowMenuSchoolId(null);

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [openAccountRowMenuSchoolId]);

  useEffect(() => {
    if (!pendingAccountAction || typeof window === "undefined") {
      return;
    }

    window.setTimeout(() => {
      pendingAccountReasonRef.current?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePendingAccountAction();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closePendingAccountAction, pendingAccountAction]);

  useEffect(() => {
    if (pendingAccountAction?.kind !== "remove" || typeof window === "undefined") {
      setPendingRemoveCountdownSeconds(0);
      return;
    }

    setPendingRemoveCountdownSeconds(3);
    const intervalId = window.setInterval(() => {
      setPendingRemoveCountdownSeconds((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pendingAccountAction]);

  const openPendingAccountAction = useCallback(
    (action: PendingAccountAction) => {
      setOpenAccountRowMenuSchoolId(null);
      setPendingAccountAction(action);
      setPendingAccountReason("");
      setPendingAccountReasonError("");
      setPendingAccountVerificationChallenge(null);
      setPendingAccountVerificationCode("");
      setPendingAccountVerificationError("");
      setPendingNotifySchoolHead(defaultNotifySchoolHead(action));
      setPendingIncludeReasonInEmail(false);
    },
    [],
  );

  const beginEditing = useCallback((record: SchoolRecord) => {
    const account = record.schoolHeadAccount;
    setEditingSchoolHeadAccountSchoolId(record.id);
    setSchoolHeadAccountDraft({
      name: account?.name ?? "",
      email: account?.email ?? "",
    });
    setSchoolHeadAccountDraftError("");
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingSchoolHeadAccountSchoolId(null);
    setSchoolHeadAccountDraftError("");
  }, []);

  const updateDraftField = useCallback((field: "name" | "email", value: string) => {
    setSchoolHeadAccountDraft((current) => ({
      ...current,
      [field]: value,
    }));
    setSchoolHeadAccountDraftError("");
  }, []);

  const updatePendingAccountReason = useCallback((value: string) => {
    setPendingAccountReason(value);
    setPendingAccountReasonError("");
  }, []);

  const updatePendingNotifySchoolHead = useCallback((value: boolean) => {
    setPendingNotifySchoolHead(value);
    if (!value) {
      setPendingIncludeReasonInEmail(false);
    }
  }, []);

  const updatePendingIncludeReasonInEmail = useCallback((value: boolean) => {
    setPendingIncludeReasonInEmail(value);
  }, []);

  const updatePendingVerificationCode = useCallback((value: string) => {
    setPendingAccountVerificationCode(normalizeActionVerificationCode(value));
    setPendingAccountVerificationError("");
  }, []);

  const toggleAccountRowMenu = useCallback((schoolId: string) => {
    setOpenAccountRowMenuSchoolId((current) => (current === schoolId ? null : schoolId));
  }, []);

  const sendPendingAccountVerificationCode = useCallback(async () => {
    const targetStatus = verificationTargetForAction(pendingAccountAction);
    if (!pendingAccountAction || !targetStatus) {
      return;
    }

    setIsPendingAccountVerificationSending(true);
    setPendingAccountVerificationError("");
    setPendingAccountVerificationCode("");

    try {
      const result = await issueSchoolHeadAccountActionVerificationCode(pendingAccountAction.schoolId, targetStatus);
      setPendingAccountVerificationChallenge(result);
      pushToast(result.deliveryMessage || "Confirmation code sent.", "info");

      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          pendingAccountVerificationCodeRef.current?.focus();
        }, 0);
      }
    } catch (err) {
      setPendingAccountVerificationError(messageForApiError(err, "Unable to send confirmation code."));
    } finally {
      setIsPendingAccountVerificationSending(false);
    }
  }, [issueSchoolHeadAccountActionVerificationCode, pendingAccountAction, pushToast]);

  const confirmPendingAccountAction = useCallback(async () => {
    if (!pendingAccountAction) {
      return;
    }

    const reason = pendingAccountReason.trim();
    if (requiresReason(pendingAccountAction) && reason.length < 5) {
      setPendingAccountReasonError("Enter at least 5 characters.");
      return;
    }

    const actionKey = `${pendingAccountAction.schoolId}:${pendingAccountAction.actionLabel}`;
    setAccountActionKey(actionKey);
    setPendingAccountReasonError("");
    setPendingAccountVerificationError("");

    try {
      if (pendingAccountAction.kind === "activate") {
        const result = await activateSchoolHeadAccount(pendingAccountAction.schoolId, {
          reason: reason || undefined,
        });
        pushToast(result.message || `School Head account activated for ${pendingAccountAction.schoolName}.`, "success");
        closePendingAccountAction();
        return;
      }

      if (pendingAccountAction.kind === "status") {
        if (isDeactivationStatus(pendingAccountAction.update.accountStatus)) {
          const challengeId = pendingAccountVerificationChallenge?.challengeId ?? "";
          const code = pendingAccountVerificationCode.trim();

          if (!challengeId) {
            setPendingAccountVerificationError("Send the 6-digit confirmation code first.");
            return;
          }

          if (!/^\d{6}$/.test(code)) {
            setPendingAccountVerificationError("Enter the 6-digit confirmation code.");
            return;
          }

          const result = await updateSchoolHeadAccountStatus(pendingAccountAction.schoolId, {
            ...pendingAccountAction.update,
            reason,
            verificationChallengeId: challengeId,
            verificationCode: code,
            notifySchoolHead: pendingNotifySchoolHead,
            includeReasonInEmail: pendingIncludeReasonInEmail,
          });
          const deliveryFailed = String(result.notificationDeliveryStatus ?? "").toLowerCase() === "failed";
          pushToast(result.message || `School Head account updated for ${pendingAccountAction.schoolName}.`, deliveryFailed ? "warning" : "success");
          if (result.notificationDeliveryMessage) {
            pushToast(result.notificationDeliveryMessage, deliveryFailed ? "warning" : "info");
          }
          closePendingAccountAction();
          return;
        }

        const result = await updateSchoolHeadAccountStatus(pendingAccountAction.schoolId, {
          ...pendingAccountAction.update,
          reason,
        });
        pushToast(result.message || `School Head account updated for ${pendingAccountAction.schoolName}.`, "success");
        closePendingAccountAction();
        return;
      }

      if (pendingAccountAction.kind === "remove") {
        if (pendingRemoveCountdownSeconds > 0) {
          setPendingAccountReasonError(`Wait ${pendingRemoveCountdownSeconds} second${pendingRemoveCountdownSeconds === 1 ? "" : "s"} before confirming deletion.`);
          return;
        }

        const challengeId = pendingAccountVerificationChallenge?.challengeId ?? "";
        const code = pendingAccountVerificationCode.trim();

        if (!challengeId) {
          setPendingAccountVerificationError("Send the 6-digit confirmation code first.");
          return;
        }

        if (!/^\d{6}$/.test(code)) {
          setPendingAccountVerificationError("Enter the 6-digit confirmation code.");
          return;
        }

        const result = await removeSchoolHeadAccount(pendingAccountAction.schoolId, {
          reason,
          verificationChallengeId: challengeId,
          verificationCode: code,
          notifySchoolHead: pendingNotifySchoolHead,
          includeReasonInEmail: pendingIncludeReasonInEmail,
        });
        const deliveryFailed = String(result.notificationDeliveryStatus ?? "").toLowerCase() === "failed";
        pushToast(result.message || `${pendingAccountAction.schoolName} permanently deleted.`, deliveryFailed ? "warning" : "success");
        if (result.notificationDeliveryMessage) {
          pushToast(result.notificationDeliveryMessage, deliveryFailed ? "warning" : "info");
        }
        closePendingAccountAction();
        return;
      }

      if (pendingAccountAction.kind === "reset_password") {
        const challengeId = pendingAccountVerificationChallenge?.challengeId ?? "";
        const code = pendingAccountVerificationCode.trim();

        if (!challengeId) {
          setPendingAccountVerificationError("Send the 6-digit confirmation code first.");
          return;
        }

        if (!/^\d{6}$/.test(code)) {
          setPendingAccountVerificationError("Enter the 6-digit confirmation code.");
          return;
        }

        const receipt = await issueSchoolHeadPasswordResetLink(pendingAccountAction.schoolId, {
          reason,
          verificationChallengeId: challengeId,
          verificationCode: code,
          includeReasonInEmail: pendingIncludeReasonInEmail,
        });
        announceSchoolHeadAccountDelivery(receipt, pendingAccountAction.schoolName, "Password reset link", pushToast);
        closePendingAccountAction();
        return;
      }

      if (pendingAccountAction.kind === "temporary_password") {
        const challengeId = pendingAccountVerificationChallenge?.challengeId ?? "";
        const code = pendingAccountVerificationCode.trim();

        if (!challengeId) {
          setPendingAccountVerificationError("Send the 6-digit confirmation code first.");
          return;
        }

        if (!/^\d{6}$/.test(code)) {
          setPendingAccountVerificationError("Enter the 6-digit confirmation code.");
          return;
        }

        const receipt = await issueSchoolHeadTemporaryPassword(pendingAccountAction.schoolId, {
          reason,
          verificationChallengeId: challengeId,
          verificationCode: code,
        });
        setTemporaryPasswordReceipt({
          schoolName: pendingAccountAction.schoolName,
          email: receipt.account.email,
          temporaryPassword: receipt.temporaryPassword,
          message: receipt.message || "Temporary password generated.",
        });
        pushToast(`Temporary password generated for ${pendingAccountAction.schoolName}.`, "success");
        closePendingAccountAction();
        return;
      }

      const challengeId = pendingAccountVerificationChallenge?.challengeId ?? "";
      const code = pendingAccountVerificationCode.trim();

      if (!challengeId) {
        setPendingAccountVerificationError("Send the 6-digit confirmation code first.");
        return;
      }

      if (!/^\d{6}$/.test(code)) {
        setPendingAccountVerificationError("Enter the 6-digit confirmation code.");
        return;
      }

      const result = await upsertSchoolHeadAccountProfile(pendingAccountAction.schoolId, {
        ...pendingAccountAction.payload,
        reason,
        verificationChallengeId: challengeId,
        verificationCode: code,
      });
      pushToast(result.message || `School Head account saved for ${pendingAccountAction.schoolName}.`, "success");
      const deliveryMessage = result.deliveryMessage?.trim();
      if (deliveryMessage) {
        pushToast(deliveryMessage, String(result.delivery ?? "").toLowerCase() === "failed" ? "warning" : "info");
      }
      setEditingSchoolHeadAccountSchoolId(null);
      closePendingAccountAction();
    } catch (err) {
      const message = messageForApiError(err, "Unable to complete account action.");
      if (requiresVerification(pendingAccountAction)) {
        setPendingAccountVerificationError(message);
      } else {
        setPendingAccountReasonError(message);
      }
    } finally {
      setAccountActionKey(null);
    }
  }, [
    closePendingAccountAction,
    issueSchoolHeadPasswordResetLink,
    issueSchoolHeadTemporaryPassword,
    pendingAccountAction,
    pendingAccountReason,
    pendingAccountVerificationChallenge,
    pendingAccountVerificationCode,
    pendingIncludeReasonInEmail,
    pendingNotifySchoolHead,
    pendingRemoveCountdownSeconds,
    pushToast,
    removeSchoolHeadAccount,
    activateSchoolHeadAccount,
    updateSchoolHeadAccountStatus,
    upsertSchoolHeadAccountProfile,
  ]);

  const handleUpdateSchoolHeadAccount = useCallback(
    (
      record: SchoolRecord,
      update: Omit<SchoolHeadAccountStatusUpdatePayload, "reason">,
      actionLabel: string,
    ) => {
      const account = record.schoolHeadAccount;
      if (!account) {
        pushToast(`No School Head account is linked to ${record.schoolName}.`, "warning");
        return;
      }

      openPendingAccountAction({
        kind: "status",
        schoolId: record.id,
        schoolName: record.schoolName,
        actionLabel,
        update,
      });
    },
    [openPendingAccountAction, pushToast],
  );

  const handleIssueSchoolHeadSetupLink = useCallback(
    async (record: SchoolRecord) => {
      const account = record.schoolHeadAccount;
      if (!account) {
        pushToast(`No School Head account is linked to ${record.schoolName}.`, "warning");
        return;
      }

      const accountStatus = String(account.accountStatus ?? "").toLowerCase();
      if (accountStatus === "pending_verification") {
        openPendingAccountAction({
          kind: "activate",
          schoolId: record.id,
          schoolName: record.schoolName,
          actionLabel: "Activate account",
        });
        return;
      }

      if (accountStatus !== "pending_setup") {
        openPendingAccountAction({
          kind: "reset_password",
          schoolId: record.id,
          schoolName: record.schoolName,
          actionLabel: "Send Password Reset Link",
        });
        return;
      }

      const actionKey = `${record.id}:setup-link`;
      setAccountActionKey(actionKey);
      try {
        const receipt = await issueSchoolHeadSetupLink(record.id, null);
        announceSchoolHeadAccountDelivery(receipt, record.schoolName, "Setup link", pushToast);
      } catch (err) {
        pushToast(messageForApiError(err, "Unable to send setup link."), "warning");
      } finally {
        setAccountActionKey(null);
      }
    },
    [issueSchoolHeadSetupLink, openPendingAccountAction, pushToast],
  );

  const copyTemporaryPasswordReceipt = useCallback(async () => {
    const password = temporaryPasswordReceipt?.temporaryPassword;
    if (!password || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(password);
      pushToast("Temporary password copied.", "info");
    } catch {
      pushToast("Copy the temporary password manually.", "warning");
    }
  }, [pushToast, temporaryPasswordReceipt?.temporaryPassword]);

  const clearTemporaryPasswordReceipt = useCallback(() => {
    setTemporaryPasswordReceipt(null);
  }, []);

  const saveProfile = useCallback(
    async (record: SchoolRecord) => {
      const account = record.schoolHeadAccount;
      const name = schoolHeadAccountDraft.name.trim();
      const email = schoolHeadAccountDraft.email.trim();
      if (!name || !email) {
        setSchoolHeadAccountDraftError("Account name and email are required.");
        return;
      }

      const previousEmail = (account?.email ?? "").trim().toLowerCase();
      const nextEmail = email.toLowerCase();
      if (account && previousEmail && previousEmail !== nextEmail) {
        setSchoolHeadAccountDraftError("");
        openPendingAccountAction({
          kind: "email_change",
          schoolId: record.id,
          schoolName: record.schoolName,
          actionLabel: "Confirm Email Change",
          payload: {
            name,
            email: nextEmail,
          },
        });
        return;
      }

      const actionKey = `${record.id}:profile`;
      setAccountActionKey(actionKey);
      setSchoolHeadAccountDraftError("");
      try {
        const result = await upsertSchoolHeadAccountProfile(record.id, {
          name,
          email: nextEmail,
        });
        if (!account && result.temporaryPassword) {
          setTemporaryPasswordReceipt({
            schoolName: record.schoolName,
            email: result.account.email,
            temporaryPassword: result.temporaryPassword,
            message: result.message || "Temporary password generated.",
          });
          pushToast(`Temporary password generated for ${record.schoolName}.`, "success");
        } else {
          pushToast(result.message || "School Head account saved.", "success");
        }
        setEditingSchoolHeadAccountSchoolId(null);
      } catch (err) {
        setSchoolHeadAccountDraftError(
          messageForApiError(err, "Unable to save School Head account."),
        );
      } finally {
        setAccountActionKey(null);
      }
    },
    [openPendingAccountAction, pushToast, schoolHeadAccountDraft.email, schoolHeadAccountDraft.name, upsertSchoolHeadAccountProfile],
  );

  const pendingActionRequiresVerification = requiresVerification(pendingAccountAction);
  const pendingShowsNotifySchoolHead = supportsNotifySchoolHead(pendingAccountAction);
  const pendingShowsIncludeReasonInEmail = supportsIncludeReasonInEmail(pendingAccountAction);
  const pendingReasonTooShort = requiresReason(pendingAccountAction) && pendingAccountReason.trim().length < 5;
  const isConfirmPendingAccountActionDisabled = Boolean(
    isSaving
    || isPendingAccountVerificationSending
    || pendingReasonTooShort
    || (pendingAccountAction?.kind === "remove" && pendingRemoveCountdownSeconds > 0)
    || (
      pendingActionRequiresVerification
      && (!pendingAccountVerificationChallenge || !/^\d{6}$/.test(pendingAccountVerificationCode.trim()))
    )
  );
  const confirmPendingAccountActionLabel =
    confirmLabelForAction(pendingAccountAction, pendingRemoveCountdownSeconds);

  return {
    editingSchoolHeadAccountSchoolId,
    schoolHeadAccountDraft,
    schoolHeadAccountDraftError,
    temporaryPasswordReceipt,
    openAccountRowMenuSchoolId,
    pendingAccountAction,
    pendingAccountReason,
    pendingAccountReasonError,
    pendingReasonTooShort,
    pendingAccountVerificationChallenge,
    pendingAccountVerificationCode,
    pendingAccountVerificationError,
    pendingActionDescription: pendingActionDescription(pendingAccountAction),
    pendingActionRequiresVerification,
    pendingShowsNotifySchoolHead,
    pendingShowsIncludeReasonInEmail,
    pendingNotifySchoolHead,
    pendingIncludeReasonInEmail,
    isPendingAccountVerificationSending,
    isConfirmPendingAccountActionDisabled,
    confirmPendingAccountActionLabel,
    pendingRemoveCountdownSeconds,
    accountActionKey,
    accountRowMenuRef,
    pendingAccountReasonRef,
    pendingAccountVerificationCodeRef,
    beginEditing,
    cancelEditing,
    updateDraftField,
    saveProfile,
    toggleAccountRowMenu,
    openPendingAccountAction,
    closePendingAccountAction,
    updatePendingAccountReason,
    updatePendingNotifySchoolHead,
    updatePendingIncludeReasonInEmail,
    updatePendingVerificationCode,
    sendPendingAccountVerificationCode,
    confirmPendingAccountAction,
    handleUpdateSchoolHeadAccount,
    handleIssueSchoolHeadSetupLink,
    copyTemporaryPasswordReceipt,
    clearTemporaryPasswordReceipt,
    resetPanelState,
  };
}
