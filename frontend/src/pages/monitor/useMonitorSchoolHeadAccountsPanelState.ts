import { useCallback, useMemo, useState } from "react";
import { messageForApiError } from "@/lib/api";
import type {
  MonitorSchoolHeadAccountRow,
  MonitorSchoolHeadAccountsPanelProps,
  SchoolHeadAccountsStatusFilter,
} from "@/pages/monitor/MonitorSchoolHeadAccountsPanel";
import type { MonitorSchoolRecordsListRow } from "@/pages/monitor/MonitorSchoolRecordsList";
import { useSchoolHeadAccountActions } from "@/pages/monitor/useSchoolHeadAccountActions";
import type {
  SchoolHeadAccountActivationResult,
  SchoolHeadAccountActionVerificationCodeResult,
  SchoolHeadAccountBatchRemovalResult,
  SchoolHeadAccountPayload,
  SchoolHeadAccountProfileUpsertResult,
  SchoolHeadAccountRemovalResult,
  SchoolRecordDeletePreview,
  SchoolHeadAccountStatusUpdatePayload,
  SchoolHeadAccountStatusUpdateResult,
  SchoolHeadPasswordResetLinkResult,
  SchoolHeadSetupLinkResult,
  SchoolHeadTemporaryPasswordResult,
  SchoolRecord,
} from "@/types";

type ToastTone = "success" | "info" | "warning";

interface UseMonitorSchoolHeadAccountsPanelStateOptions {
  isMobileViewport: boolean;
  isSaving: boolean;
  records?: SchoolRecord[];
  compactSchoolRows?: MonitorSchoolRecordsListRow[];
  recordBySchoolKey?: Map<string, SchoolRecord>;
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
    targetStatus: "suspended" | "locked" | "archived" | "deleted" | "password_reset" | "email_change" | "temporary_password",
  ) => Promise<SchoolHeadAccountActionVerificationCodeResult>;
  issueSchoolHeadSetupLink: (schoolId: string, reason?: string | null) => Promise<SchoolHeadSetupLinkResult>;
  issueSchoolHeadPasswordResetLink: (
    schoolId: string,
    payload: { reason: string; verificationChallengeId: string; verificationCode: string },
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
    payload: { reason?: string | null },
  ) => Promise<SchoolHeadAccountRemovalResult>;
  removeSchoolHeadAccountsBatch?: (
    schoolIds: string[],
    payload?: { reason?: string | null },
  ) => Promise<SchoolHeadAccountBatchRemovalResult>;
  deleteRecord: (id: string) => Promise<void>;
  previewDeleteRecord: (id: string) => Promise<SchoolRecordDeletePreview>;
  onOpenSchoolRecord: (record: SchoolRecord) => void;
  formatDateTime: (value: string) => string;
}

export interface UseMonitorSchoolHeadAccountsPanelStateResult {
  showSchoolHeadAccountsPanel: boolean;
  toggleSchoolHeadAccountsPanel: () => void;
  openSchoolHeadAccountsPanelWithStatus: (status?: SchoolHeadAccountsStatusFilter) => void;
  schoolHeadAccountsPanelProps: MonitorSchoolHeadAccountsPanelProps | null;
}

export function useMonitorSchoolHeadAccountsPanelState({
  isMobileViewport,
  isSaving,
  records,
  compactSchoolRows,
  recordBySchoolKey,
  pushToast,
  updateSchoolHeadAccountStatus,
  activateSchoolHeadAccount,
  issueSchoolHeadAccountActionVerificationCode,
  issueSchoolHeadSetupLink,
  issueSchoolHeadPasswordResetLink,
  issueSchoolHeadTemporaryPassword,
  upsertSchoolHeadAccountProfile,
  removeSchoolHeadAccount,
  removeSchoolHeadAccountsBatch = async () => {
    throw new Error("Batch delete is unavailable.");
  },
  deleteRecord,
  previewDeleteRecord,
  onOpenSchoolRecord,
  formatDateTime,
}: UseMonitorSchoolHeadAccountsPanelStateOptions): UseMonitorSchoolHeadAccountsPanelStateResult {
  const [showSchoolHeadAccountsPanel, setShowSchoolHeadAccountsPanel] = useState(false);
  const [schoolHeadAccountsQuery, setSchoolHeadAccountsQuery] = useState("");
  const [schoolHeadAccountsStatusFilter, setSchoolHeadAccountsStatusFilter] =
    useState<SchoolHeadAccountsStatusFilter>("all");
  const [schoolHeadAccountsOnlyFlagged, setSchoolHeadAccountsOnlyFlagged] = useState(false);
  const [schoolHeadAccountsOnlyDeleteFlagged, setSchoolHeadAccountsOnlyDeleteFlagged] = useState(false);
  const [pendingDeleteSchoolRecord, setPendingDeleteSchoolRecord] = useState<SchoolRecord | null>(null);
  const [pendingDeleteSchoolRecordPreview, setPendingDeleteSchoolRecordPreview] = useState<SchoolRecordDeletePreview | null>(null);
  const [pendingDeleteSchoolRecordError, setPendingDeleteSchoolRecordError] = useState("");
  const [isDeleteSchoolRecordLoading, setIsDeleteSchoolRecordLoading] = useState(false);
  const [isBatchDeleteSchoolRecordsLoading, setIsBatchDeleteSchoolRecordsLoading] = useState(false);
  const [isBatchDeleteSchoolRecordsPending, setIsBatchDeleteSchoolRecordsPending] = useState(false);
  const [batchDeleteSchoolRecordsError, setBatchDeleteSchoolRecordsError] = useState("");

  const schoolHeadAccountActions = useSchoolHeadAccountActions({
    isPanelOpen: showSchoolHeadAccountsPanel,
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
  });

  const closeSchoolHeadAccountsPanel = useCallback(() => {
    setShowSchoolHeadAccountsPanel(false);
    schoolHeadAccountActions.resetPanelState();
    setPendingDeleteSchoolRecord(null);
    setPendingDeleteSchoolRecordPreview(null);
    setPendingDeleteSchoolRecordError("");
    setIsDeleteSchoolRecordLoading(false);
    setIsBatchDeleteSchoolRecordsLoading(false);
    setIsBatchDeleteSchoolRecordsPending(false);
    setBatchDeleteSchoolRecordsError("");
  }, [schoolHeadAccountActions]);

  const toggleSchoolHeadAccountsPanel = useCallback(() => {
    setShowSchoolHeadAccountsPanel((current) => {
      const next = !current;
      if (!next) {
        schoolHeadAccountActions.resetPanelState();
        setPendingDeleteSchoolRecord(null);
        setPendingDeleteSchoolRecordPreview(null);
        setPendingDeleteSchoolRecordError("");
        setIsDeleteSchoolRecordLoading(false);
        setIsBatchDeleteSchoolRecordsLoading(false);
        setIsBatchDeleteSchoolRecordsPending(false);
        setBatchDeleteSchoolRecordsError("");
      }
      return next;
    });
  }, [schoolHeadAccountActions]);

  const openSchoolHeadAccountsPanelWithStatus = useCallback((status: SchoolHeadAccountsStatusFilter = "all") => {
    setSchoolHeadAccountsQuery("");
    setSchoolHeadAccountsStatusFilter(status);
    setSchoolHeadAccountsOnlyFlagged(false);
    setSchoolHeadAccountsOnlyDeleteFlagged(false);
    setShowSchoolHeadAccountsPanel(true);
  }, []);

  const closePendingDeleteSchoolRecord = useCallback(() => {
    setPendingDeleteSchoolRecord(null);
    setPendingDeleteSchoolRecordPreview(null);
    setPendingDeleteSchoolRecordError("");
    setIsDeleteSchoolRecordLoading(false);
  }, []);

  const closePendingBatchDeleteSchoolRecords = useCallback(() => {
    setIsBatchDeleteSchoolRecordsPending(false);
    setIsBatchDeleteSchoolRecordsLoading(false);
    setBatchDeleteSchoolRecordsError("");
  }, []);

  const openPendingDeleteSchoolRecord = useCallback(
    async (record: SchoolRecord) => {
      schoolHeadAccountActions.toggleAccountRowMenu(record.id);
      setPendingDeleteSchoolRecord(record);
      setPendingDeleteSchoolRecordPreview(null);
      setPendingDeleteSchoolRecordError("");
      setIsDeleteSchoolRecordLoading(true);

      try {
        const preview = await previewDeleteRecord(record.id);
        setPendingDeleteSchoolRecordPreview(preview);
      } catch (err) {
        setPendingDeleteSchoolRecordError(
          messageForApiError(err, "Unable to load school archive preview."),
        );
      } finally {
        setIsDeleteSchoolRecordLoading(false);
      }
    },
    [previewDeleteRecord, schoolHeadAccountActions],
  );

  const confirmDeleteSchoolRecord = useCallback(async () => {
    if (!pendingDeleteSchoolRecord) {
      return;
    }

    setPendingDeleteSchoolRecordError("");
    setIsDeleteSchoolRecordLoading(true);

    try {
      await deleteRecord(pendingDeleteSchoolRecord.id);
      pushToast(`${pendingDeleteSchoolRecord.schoolName} moved to Archived Schools.`, "success");
      closePendingDeleteSchoolRecord();
    } catch (err) {
      setPendingDeleteSchoolRecordError(
        messageForApiError(err, "Unable to archive school record."),
      );
    } finally {
      setIsDeleteSchoolRecordLoading(false);
    }
  }, [closePendingDeleteSchoolRecord, deleteRecord, pendingDeleteSchoolRecord, pushToast]);

  const accountManagementRecords = useMemo<SchoolRecord[]>(() => {
    if (records) {
      return records;
    }

    return (compactSchoolRows ?? [])
      .map(({ summary, record }) => record ?? recordBySchoolKey?.get(summary.schoolKey) ?? null)
      .filter((record): record is SchoolRecord => Boolean(record));
  }, [compactSchoolRows, recordBySchoolKey, records]);

  const deleteFlaggedSchoolIds = useMemo(
    () =>
      accountManagementRecords
        .filter((record): record is SchoolRecord => Boolean(record.schoolHeadAccount?.deleteRecordFlagged))
        .map((record) => record.id),
    [accountManagementRecords],
  );

  const openPendingBatchDeleteSchoolRecords = useCallback(() => {
    if (deleteFlaggedSchoolIds.length === 0) {
      return;
    }

    setBatchDeleteSchoolRecordsError("");
    setIsBatchDeleteSchoolRecordsPending(true);
  }, [deleteFlaggedSchoolIds.length]);

  const confirmBatchDeleteSchoolRecords = useCallback(async () => {
    if (deleteFlaggedSchoolIds.length === 0) {
      setBatchDeleteSchoolRecordsError("There are no delete-flagged schools to remove.");
      return;
    }

    setBatchDeleteSchoolRecordsError("");
    setIsBatchDeleteSchoolRecordsLoading(true);

    try {
      const result = await removeSchoolHeadAccountsBatch(deleteFlaggedSchoolIds, {
        reason: "Batch remove delete-flagged school records and linked School Head accounts.",
      });

      if (result.deletedCount > 0) {
        pushToast(
          `${result.deletedCount} flagged school${result.deletedCount === 1 ? "" : "s"} permanently deleted.`,
          "success",
        );
      }

      if (result.blocked.length > 0) {
        pushToast(
          `${result.blocked.length} school${result.blocked.length === 1 ? " was" : "s were"} blocked from batch delete.`,
          "warning",
        );
      }

      if (result.missingSchoolIds.length > 0) {
        pushToast(
          `${result.missingSchoolIds.length} school${result.missingSchoolIds.length === 1 ? " was" : "s were"} already missing.`,
          "warning",
        );
      }

      if (result.deletedCount === 0 && result.blocked.length === 0 && result.missingSchoolIds.length === 0) {
        pushToast("No flagged schools were deleted.", "info");
      }

      closePendingBatchDeleteSchoolRecords();
    } catch (err) {
      setBatchDeleteSchoolRecordsError(
        messageForApiError(err, "Unable to batch delete flagged schools."),
      );
    } finally {
      setIsBatchDeleteSchoolRecordsLoading(false);
    }
  }, [
    closePendingBatchDeleteSchoolRecords,
    deleteFlaggedSchoolIds,
    pushToast,
    removeSchoolHeadAccountsBatch,
  ]);

  const accountMatchesStatusFilter = useCallback(
    (record: SchoolRecord, statusFilter: SchoolHeadAccountsStatusFilter): boolean => {
      const account = record.schoolHeadAccount ?? null;
      const normalizedAccountStatus = String(account?.accountStatus ?? "").toLowerCase();
      const lifecycleState = String(account?.lifecycleState ?? "").toLowerCase();
      const hasNoAccount = !account;
      const isPendingSetup = normalizedAccountStatus === "pending_setup";

      if (statusFilter === "all") return true;
      if (statusFilter === "no_account") return hasNoAccount;
      if (statusFilter === "pending_setup") return isPendingSetup;
      if (
        statusFilter === "password_reset_required" ||
        statusFilter === "temporary_password_expired" ||
        statusFilter === "temporary_password_active"
      ) {
        return lifecycleState === statusFilter;
      }

      return normalizedAccountStatus === statusFilter;
    },
    [],
  );

  const accountStatusCounts = useMemo<Record<SchoolHeadAccountsStatusFilter, number>>(() => {
    const counts: Record<SchoolHeadAccountsStatusFilter, number> = {
      all: accountManagementRecords.length,
      no_account: 0,
      temporary_password_active: 0,
      password_reset_required: 0,
      pending_setup: 0,
      pending_verification: 0,
      temporary_password_expired: 0,
      active: 0,
      suspended: 0,
      locked: 0,
      archived: 0,
    };

    accountManagementRecords.forEach((record) => {
      (Object.keys(counts) as SchoolHeadAccountsStatusFilter[]).forEach((statusFilter) => {
        if (statusFilter !== "all" && accountMatchesStatusFilter(record, statusFilter)) {
          counts[statusFilter] += 1;
        }
      });
    });

    return counts;
  }, [accountManagementRecords, accountMatchesStatusFilter]);

  const filteredSchoolHeadAccountRecords = useMemo(() => {
    const query = schoolHeadAccountsQuery.trim().toLowerCase();
    const statusFilter = schoolHeadAccountsStatusFilter;

    const rows = accountManagementRecords.filter((record) => {
      const account = record.schoolHeadAccount ?? null;

      if (!accountMatchesStatusFilter(record, statusFilter)) {
        return false;
      }

      if (schoolHeadAccountsOnlyFlagged && !(account?.flagged ?? false)) {
        return false;
      }

      if (schoolHeadAccountsOnlyDeleteFlagged && !(account?.deleteRecordFlagged ?? false)) {
        return false;
      }

      if (query.length === 0) {
        return true;
      }

      const haystack = [
        record.schoolCode ?? record.schoolId ?? "",
        record.schoolName,
        account?.name ?? "",
        account?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });

    const priorityFor = (record: SchoolRecord) => {
      const account = record.schoolHeadAccount ?? null;
      const normalizedAccountStatus = String(account?.accountStatus ?? "").toLowerCase();
      const lifecycleState = String(account?.lifecycleState ?? "").toLowerCase();

      if (account?.deleteRecordFlagged) return 0;
      if (!account) return 1;
      if (lifecycleState === "pending_setup") return 2;
      if (lifecycleState === "pending_verification") return 3;
      if (account.flagged) return 4;
      if (lifecycleState === "temporary_password_expired") return 5;
      if (lifecycleState === "password_reset_required") return 6;
      if (lifecycleState === "temporary_password_active") return 7;
      if (normalizedAccountStatus === "active") return 8;
      if (normalizedAccountStatus === "locked") return 9;
      if (normalizedAccountStatus === "suspended") return 10;
      if (normalizedAccountStatus === "archived") return 11;
      return 99;
    };

    rows.sort((a, b) => {
      const priorityDiff = priorityFor(a) - priorityFor(b);
      if (priorityDiff !== 0) return priorityDiff;
      return a.schoolName.localeCompare(b.schoolName);
    });

    return rows;
  }, [
    accountManagementRecords,
    accountMatchesStatusFilter,
    schoolHeadAccountsOnlyDeleteFlagged,
    schoolHeadAccountsOnlyFlagged,
    schoolHeadAccountsQuery,
    schoolHeadAccountsStatusFilter,
  ]);

  const schoolHeadAccountRows = useMemo<MonitorSchoolHeadAccountRow[]>(
    () =>
      filteredSchoolHeadAccountRecords.map((record) => ({
        schoolKey: record.id,
        schoolCode: record.schoolCode ?? record.schoolId ?? "",
        schoolName: record.schoolName,
        record,
      })),
    [filteredSchoolHeadAccountRecords],
  );

  return {
    showSchoolHeadAccountsPanel,
    toggleSchoolHeadAccountsPanel,
    openSchoolHeadAccountsPanelWithStatus,
    schoolHeadAccountsPanelProps: showSchoolHeadAccountsPanel
      ? {
          isOpen: showSchoolHeadAccountsPanel,
          isSaving,
          isMobileViewport,
          rows: schoolHeadAccountRows,
          totalCount: accountManagementRecords.length,
          accountStatusCounts,
          query: schoolHeadAccountsQuery,
          statusFilter: schoolHeadAccountsStatusFilter,
          onlyFlagged: schoolHeadAccountsOnlyFlagged,
          onlyDeleteFlagged: schoolHeadAccountsOnlyDeleteFlagged,
          onQueryChange: setSchoolHeadAccountsQuery,
          onStatusFilterChange: setSchoolHeadAccountsStatusFilter,
          onOnlyFlaggedChange: setSchoolHeadAccountsOnlyFlagged,
          onOnlyDeleteFlaggedChange: setSchoolHeadAccountsOnlyDeleteFlagged,
          onClearFilters: () => {
            setSchoolHeadAccountsQuery("");
            setSchoolHeadAccountsStatusFilter("all");
            setSchoolHeadAccountsOnlyFlagged(false);
            setSchoolHeadAccountsOnlyDeleteFlagged(false);
          },
          onClose: closeSchoolHeadAccountsPanel,
          onOpenSchoolRecord,
          pendingDeleteSchoolRecord,
          pendingDeleteSchoolRecordPreview,
          pendingDeleteSchoolRecordError,
          isDeleteSchoolRecordLoading,
          onPreviewDeleteSchoolRecord: openPendingDeleteSchoolRecord,
          onClosePendingDeleteSchoolRecord: closePendingDeleteSchoolRecord,
          onConfirmDeleteSchoolRecord: confirmDeleteSchoolRecord,
          deleteFlaggedSchoolCount: deleteFlaggedSchoolIds.length,
          isBatchDeleteSchoolRecordsPending,
          isBatchDeleteSchoolRecordsLoading,
          batchDeleteSchoolRecordsError,
          onOpenPendingBatchDeleteSchoolRecords: openPendingBatchDeleteSchoolRecords,
          onClosePendingBatchDeleteSchoolRecords: closePendingBatchDeleteSchoolRecords,
          onConfirmBatchDeleteSchoolRecords: confirmBatchDeleteSchoolRecords,
          formatDateTime: (value: string | null) => (value ? formatDateTime(value) : "-"),
          actions: schoolHeadAccountActions,
        }
      : null,
  };
}
