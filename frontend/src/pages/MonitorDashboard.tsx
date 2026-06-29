import { useCallback, useMemo, useRef, useState } from "react";
import { DashboardHelpDialog } from "@/components/DashboardHelpDialog";
import { useEffect } from "react";
import { MonitorMfaResetApprovalsDialog } from "@/components/MonitorMfaResetApprovalsDialog";
import { Shell } from "@/components/Shell";
import { useAuth } from "@/context/Auth";
import { useData } from "@/context/Data";
import { useIndicatorData } from "@/context/IndicatorData";
import { useStudentData } from "@/context/StudentData";
import { useTeacherData } from "@/context/TeacherData";
import { runRefreshBatches } from "@/lib/runRefreshBatches";
import { MonitorSchoolDrawer } from "@/pages/monitor/MonitorSchoolDrawer";
import { MonitorAuditTrail } from "@/pages/monitor/MonitorAuditTrail";
import { MonitorDashboardToolbar } from "@/pages/monitor/MonitorDashboardToolbar";
import { MonitorFiltersPanel } from "@/pages/monitor/MonitorFiltersPanel";
import { MonitorManualScreen } from "@/pages/monitor/MonitorManualScreen";
import { MonitorMobileNavigator } from "@/pages/monitor/MonitorMobileNavigator";
import { MonitorDashboardShellActions } from "@/pages/monitor/MonitorDashboardShellActions";
import { MonitorReviewsSection } from "@/pages/monitor/MonitorReviewsSection";
import { MonitorSchoolsSection } from "@/pages/monitor/MonitorSchoolsSection";
import { MonitorSideNavigator } from "@/pages/monitor/MonitorSideNavigator";
import { MonitorToastStack } from "@/pages/monitor/MonitorToastStack";
import {
  MONITOR_QUICK_JUMPS,
  MONITOR_TOP_NAVIGATOR_IDS,
  RECORD_PAGE_SIZE,
  REQUIREMENT_FILTER_OPTIONS,
  REQUIREMENT_PAGE_SIZE,
} from "@/pages/monitor/monitorDashboardConfig";
import {
  downloadCsvFile,
  isUrgentRequirement,
  queuePriorityLabel,
  queuePriorityTone,
  requirementFilterLabel,
  sanitizeAnchorToken,
  statusTone,
  urgencyRowTone,
  workflowLabel,
  workflowTone,
} from "@/pages/monitor/monitorDashboardUiUtils";
import {
  ALL_SCHOOL_SCOPE,
  type MonitorTopNavigatorId,
  type QueueLane,
  type RequirementFilter,
  type SchoolLevelFilter,
  type SchoolQuickPreset,
  type SchoolSectorFilter,
} from "@/pages/monitor/monitorFilters";
import { normalizeSchoolKey } from "@/pages/monitor/monitorRequirementRules";
import { useMonitorFilters } from "@/pages/monitor/useMonitorFilters";
import {
  useMonitorLookups,
} from "@/pages/monitor/useMonitorLookups";
import { useMonitorDashboardShell } from "@/pages/monitor/useMonitorDashboardShell";
import { useMonitorDashboardGlobalCommands } from "@/pages/monitor/useMonitorDashboardGlobalCommands";
import { useMonitorDashboardHotkeys } from "@/pages/monitor/useMonitorDashboardHotkeys";
import { useMonitorDrawerViewModel } from "@/pages/monitor/useMonitorDrawerViewModel";
import { useMonitorFilterUi } from "@/pages/monitor/useMonitorFilterUi";
import { useMonitorDrawerJumpActions } from "@/pages/monitor/useMonitorDrawerJumpActions";
import { useMonitorPageStateGuard } from "@/pages/monitor/useMonitorPageStateGuard";
import { useMonitorRadarTotals } from "@/pages/monitor/useMonitorRadarTotals";
import { useMonitorQuickJump } from "@/pages/monitor/useMonitorQuickJump";
import { useMonitorRequirementData } from "@/pages/monitor/useMonitorRequirementData";
import { refreshMonitorReviewData } from "@/pages/monitor/monitorReviewDataRefresh";
import { useMonitorSchoolActionRouter } from "@/pages/monitor/useMonitorSchoolActionRouter";
import { useMonitorSchoolsSection } from "@/pages/monitor/useMonitorSchoolsSection";
import { useMonitorDashboardBindings } from "@/pages/monitor/useMonitorDashboardBindings";
import { useMonitorDashboardCommands } from "@/pages/monitor/useMonitorDashboardCommands";
import { useMonitorUiRefresh } from "@/pages/monitor/useMonitorUiRefresh";
import { useSchoolDrawer } from "@/pages/monitor/useSchoolDrawer";
import {
  formatDateTime,
  statusLabel,
} from "@/utils/analytics";
import type { IndicatorSubmission, SchoolRecord, WorkflowStatus } from "@/types";

type MonitorReviewStatusOverride = {
  schoolCode: string;
  submissionId: string;
  status: WorkflowStatus;
  reviewedAt: string | null;
  updatedAt: string | null;
};

type MonitorDashboardErrorSource = {
  label: string;
  message?: string | null;
};

export function resolveMonitorDashboardError(
  sources: MonitorDashboardErrorSource[],
): MonitorDashboardErrorSource | null {
  return sources.find((source) => Boolean(source.message?.trim())) ?? null;
}

function normalizeMonitorScopeId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function latestIsoTimestamp(...values: Array<string | null | undefined>): string | null {
  let latestTime = 0;
  let latestValue: string | null = null;

  for (const value of values) {
    const time = new Date(value ?? 0).getTime();
    if (Number.isFinite(time) && time > latestTime) {
      latestTime = time;
      latestValue = value ?? null;
    }
  }

  return latestValue;
}

function buildMonitorReviewStatusOverride(
  submission: IndicatorSubmission | null | undefined,
  decision: "verified" | "returned" | "unverified" | undefined,
): MonitorReviewStatusOverride | null {
  if (!submission || !decision) {
    return null;
  }

  const schoolCode = String(submission.school?.schoolCode ?? "").trim().toUpperCase();
  if (!schoolCode) {
    return null;
  }

  const submittedScopeIds = (submission.scopeProgress?.submittedScopeIds ?? [])
    .map(normalizeMonitorScopeId)
    .filter(Boolean);
  const reviewsByScope = new Map(
    (submission.scopeReviews ?? []).map((review) => [
      normalizeMonitorScopeId(review.scopeId),
      review,
    ]),
  );
  const reviewedAt = latestIsoTimestamp(
    submission.reviewedAt,
    ...submittedScopeIds.map((scopeId) => reviewsByScope.get(scopeId)?.reviewedAt ?? null),
    ...submittedScopeIds.map((scopeId) => reviewsByScope.get(scopeId)?.updatedAt ?? null),
  );
  const updatedAt = latestIsoTimestamp(reviewedAt, submission.updatedAt, submission.createdAt);

  if (decision === "returned") {
    return {
      schoolCode,
      submissionId: submission.id,
      status: "returned",
      reviewedAt,
      updatedAt,
    };
  }

  const allSentScopesVerified = submittedScopeIds.length > 0
    && submittedScopeIds.every((scopeId) => reviewsByScope.get(scopeId)?.decision === "verified");

  return {
    schoolCode,
    submissionId: submission.id,
    status: allSentScopesVerified ? "validated" : "submitted",
    reviewedAt,
    updatedAt,
  };
}

function applyMonitorReviewStatusOverrides(
  records: SchoolRecord[],
  overrides: Record<string, MonitorReviewStatusOverride>,
): SchoolRecord[] {
  if (Object.keys(overrides).length === 0) {
    return records;
  }

  return records.map((record) => {
    const schoolCode = String(record.schoolCode ?? record.schoolId ?? "").trim().toUpperCase();
    const override = schoolCode ? overrides[schoolCode] : null;
    if (!override) {
      return record;
    }

    const current = record.indicatorLatest ?? null;
    return {
      ...record,
      lastUpdated: latestIsoTimestamp(override.updatedAt, override.reviewedAt, record.lastUpdated) ?? record.lastUpdated,
      indicatorLatest: {
        id: override.submissionId,
        status: override.status,
        submittedAt: current?.submittedAt ?? null,
        reviewedAt: override.reviewedAt ?? current?.reviewedAt ?? null,
        createdAt: current?.createdAt ?? null,
        updatedAt: override.updatedAt ?? current?.updatedAt ?? null,
      },
    };
  });
}

export function MonitorDashboard() {
  const { user } = useAuth();
  const isAuthenticated = Boolean(user);
  const authSessionKey = user ? `${user.role}:${user.id}` : "";
  const [reviewStatusOverrides, setReviewStatusOverrides] = useState<Record<string, MonitorReviewStatusOverride>>({});
  const {
    records,
    recordCount,
    targetsMet,
    syncAlerts,
    isLoading,
    isSaving,
    error: recordError,
    lastSyncedAt,
    syncScope,
    syncStatus,
    refreshRecords,
    addRecord,
    updateRecord,
    deleteRecord,
    previewDeleteRecord,
    listArchivedRecords,
    restoreRecord,
    permanentlyDeleteArchivedRecord,
    sendReminder,
    updateSchoolHeadAccountStatus,
    activateSchoolHeadAccount,
    issueSchoolHeadAccountActionVerificationCode,
    issueSchoolHeadSetupLink,
    issueSchoolHeadPasswordResetLink,
    issueSchoolHeadTemporaryPassword,
    upsertSchoolHeadAccountProfile,
    removeSchoolHeadAccount,
    removeSchoolHeadAccountsBatch,
    bulkImportRecords,
  } = useData();
  const {
    allSubmissions,
    isLoading: isIndicatorDataLoading,
    error: indicatorError,
    lastSyncedAt: indicatorLastSyncedAt,
    fetchSubmission,
    listSubmissionsForSchool,
    refreshSubmissions,
  } = useIndicatorData();
  const {
    students,
    isLoading: isStudentDataLoading,
    error: studentError,
    lastSyncedAt: studentLastSyncedAt,
    refreshStudents,
    queryStudents,
  } = useStudentData();
  const {
    isLoading: isTeacherDataLoading,
    error: teacherError,
    lastSyncedAt: teacherLastSyncedAt,
    refreshTeachers,
    listTeachers,
  } = useTeacherData();

  const {
    search,
    effectiveSearch,
    statusFilter,
    filterDateFrom,
    filterDateTo,
    requirementFilter,
    selectedSchoolScopeKey,
    filtersHydrated,
    activeTopNavigator,
    queueLane,
    schoolQuickPreset,
    schoolSectorFilter,
    schoolLevelFilter,
    setSearch,
    setStatusFilter,
    setFilterDateFrom,
    setFilterDateTo,
    setRequirementFilter,
    setSelectedSchoolScopeKey,
    setActiveTopNavigator,
    setQueueLane,
    setSchoolQuickPreset,
    setSchoolSectorFilter,
    setSchoolLevelFilter,
    resetFilters: resetMonitorFilters,
  } = useMonitorFilters(authSessionKey);
  const { radarTotalsTick, latestRealtimeBatch } = useMonitorUiRefresh();
  const {
    isNavigatorCompact,
    setIsNavigatorCompact,
    isNavigatorVisible,
    setIsNavigatorVisible,
    isMobileViewport,
    showNavigatorManual,
    setShowNavigatorManual,
    showAdvancedFilters,
    setShowAdvancedFilters,
    showAdvancedAnalytics,
    setShowAdvancedAnalytics,
    showHelpDialog,
    setShowHelpDialog,
    showMfaResetApprovalsDialog,
    setShowMfaResetApprovalsDialog,
    renderAdvancedAnalytics,
    isHidingAdvancedAnalytics,
    focusedSectionId,
    setFocusedSectionId,
    showMoreFilters,
    setShowMoreFilters,
    toasts,
    pushToast,
    dismissToast,
    focusAndScrollTo,
    sectionFocusClass,
  } = useMonitorDashboardShell();
  const [requirementsPage, setRequirementsPage] = useState(1);
  const [recordsPage, setRecordsPage] = useState(1);
  const initialLoadStartedRef = useRef(false);
  const {
    schoolScopeQuery,
    setSchoolScopeQuery,
    openScopeDropdownId,
    setOpenScopeDropdownId,
    toggleScopeDropdown,
    schoolScopeOptions,
    filteredSchoolScopeOptions,
    selectedSchoolScope,
    scopedSchoolKeys,
    scopedSchoolCodes,
    totalSchoolsInScope,
    handleSelectAllSchools,
    handleSelectSchoolScope,
  } = useMonitorLookups({
    records,
    recordCount,
    selectedSchoolScopeKey,
    setSelectedSchoolScopeKey,
    showMoreFilters,
    showAdvancedFilters,
  });
  const { monitorRadarTotals } = useMonitorRadarTotals({
    authSessionKey,
    activeTopNavigator,
    showNavigatorManual,
    scopedSchoolCodes,
    radarTotalsTick,
    queryStudents,
    listTeachers,
  });
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const {
    handleRefreshDashboard,
    handleMonitorTopNavigate,
  } = useMonitorDashboardGlobalCommands({
    refreshRecords,
    refreshSubmissions,
    refreshStudents,
    refreshTeachers,
    onToast: pushToast,
    setShowNavigatorManual,
    setActiveTopNavigator,
    focusAndScrollTo,
    isMobileViewport,
    setIsNavigatorVisible,
  });

  useEffect(() => {
    if (initialLoadStartedRef.current) {
      return;
    }

    initialLoadStartedRef.current = true;
    void runRefreshBatches([
      [refreshRecords],
      [refreshSubmissions],
      [refreshStudents, refreshTeachers],
    ]);
  }, [refreshRecords, refreshSubmissions, refreshStudents, refreshTeachers]);

  useEffect(() => {
    setReviewStatusOverrides({});
  }, [authSessionKey]);

  useEffect(() => {
    if (Object.keys(reviewStatusOverrides).length === 0) {
      return;
    }

    setReviewStatusOverrides((current) => {
      let changed = false;
      const next = { ...current };
      for (const record of records) {
        const schoolCode = String(record.schoolCode ?? record.schoolId ?? "").trim().toUpperCase();
        const override = schoolCode ? next[schoolCode] : null;
        if (!override) {
          continue;
        }

        const latest = record.indicatorLatest ?? null;
        const latestUpdatedAt = new Date(latest?.updatedAt ?? latest?.reviewedAt ?? record.lastUpdated ?? 0).getTime();
        const overrideUpdatedAt = new Date(override.updatedAt ?? override.reviewedAt ?? 0).getTime();
        const serverMatchesOverride = latest?.id === override.submissionId && latest.status === override.status;
        const serverMovedPastOverride =
          Number.isFinite(latestUpdatedAt)
          && Number.isFinite(overrideUpdatedAt)
          && latestUpdatedAt > 0
          && overrideUpdatedAt > 0
          && latestUpdatedAt > overrideUpdatedAt;

        if (serverMatchesOverride || serverMovedPastOverride) {
          delete next[schoolCode];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [records, reviewStatusOverrides]);

  const recordsWithReviewStatusOverrides = useMemo(
    () => applyMonitorReviewStatusOverrides(records, reviewStatusOverrides),
    [records, reviewStatusOverrides],
  );

  const scopedRecords = useMemo(() => {
    if (!scopedSchoolKeys) {
      return recordsWithReviewStatusOverrides;
    }

    return recordsWithReviewStatusOverrides.filter((record) =>
      scopedSchoolKeys.has(
        normalizeSchoolKey(record.schoolId ?? record.schoolCode ?? null, record.schoolName),
      ),
    );
  }, [recordsWithReviewStatusOverrides, scopedSchoolKeys]);

  const {
    schoolRequirementByKey,
    recordBySchoolKey,
    scopedRecordBySchoolKey,
    schoolStatusCounts,
    visibleRequirementFilterIds,
    visibleRequirementFilterOptions,
    filteredRequirementRows,
    hasDashboardFilters,
    requirementCounts,
    needsActionCount,
    actionQueueRows,
    queueLaneCounts,
    laneFilteredQueueRows,
    schoolPresetCounts,
    schoolCategoryCounts,
    stickySummaryStats,
    compactSchoolRows,
    totalRequirementPages,
    safeRequirementsPage,
    paginatedRequirementRows,
    totalRecordPages,
    safeRecordsPage,
    paginatedCompactSchoolRows,
  } = useMonitorRequirementData({
    records: recordsWithReviewStatusOverrides,
    scopedRecords,
    scopedSchoolKeys,
    selectedSchoolScopeKey,
    hasSelectedSchoolScope: Boolean(selectedSchoolScope),
    filterDateFrom,
    filterDateTo,
    requirementFilter,
    statusFilter,
    schoolQuickPreset,
    schoolSectorFilter,
    schoolLevelFilter,
    queueLane,
    effectiveSearch,
    activeTopNavigator,
    requirementsPage,
    recordsPage,
    requirementPageSize: REQUIREMENT_PAGE_SIZE,
    recordPageSize: RECORD_PAGE_SIZE,
    allSchoolScopeKey: ALL_SCHOOL_SCOPE,
    requirementFilterOptions: REQUIREMENT_FILTER_OPTIONS,
  });
  const dashboardLastSyncedAt = useMemo(() => {
    const recordTime = lastSyncedAt ? Date.parse(lastSyncedAt) : Number.NaN;
    const indicatorTime = indicatorLastSyncedAt ? Date.parse(indicatorLastSyncedAt) : Number.NaN;
    const studentTime = studentLastSyncedAt ? Date.parse(studentLastSyncedAt) : Number.NaN;
    const teacherTime = teacherLastSyncedAt ? Date.parse(teacherLastSyncedAt) : Number.NaN;
    const maxTime = Math.max(
      Number.isFinite(recordTime) ? recordTime : 0,
      Number.isFinite(indicatorTime) ? indicatorTime : 0,
      Number.isFinite(studentTime) ? studentTime : 0,
      Number.isFinite(teacherTime) ? teacherTime : 0,
    );
    return maxTime > 0 ? new Date(maxTime).toISOString() : null;
  }, [indicatorLastSyncedAt, lastSyncedAt, studentLastSyncedAt, teacherLastSyncedAt]);
  const dashboardError = resolveMonitorDashboardError([
    { label: "School records", message: recordError },
    { label: "Indicator submissions", message: indicatorError },
    { label: "Student records", message: studentError },
    { label: "Teacher records", message: teacherError },
  ]);
  const isDashboardSyncing =
    isLoading || isIndicatorDataLoading || isStudentDataLoading || isTeacherDataLoading;
  const showSubmissionFilters = showAdvancedFilters;
  const returnedCount = requirementCounts.returned;
  const submittedCount = requirementCounts.submittedAny;
  const shouldRenderNavigatorItems = isMobileViewport ? isNavigatorVisible : true;
  const showNavigatorHeaderText = isMobileViewport ? isNavigatorVisible : !isNavigatorCompact;
  const navigatorBadges = useMemo<
    Record<MonitorTopNavigatorId, { primary?: number; secondary?: number; urgency: "none" | "high" | "medium" }>
  >(
    () => ({
      reviews: {
        primary: needsActionCount,
        urgency: requirementCounts.missing > 0 ? "high" : needsActionCount > 0 ? "medium" : "none",
      },
      schools: { urgency: "none" },
      audit: { urgency: "none" },
    }),
    [needsActionCount, requirementCounts.missing, returnedCount],
  );
  const quickJumpItems = useMemo(
    () => MONITOR_QUICK_JUMPS[activeTopNavigator] ?? [],
    [activeTopNavigator],
  );
  const studentStatsBySchoolKey = useMemo(() => {
    const map = new Map<string, { students: number; teachers: Set<string> }>();

    for (const student of students) {
      const key = normalizeSchoolKey(student.school?.schoolCode ?? null, student.school?.name ?? null);
      if (key === "unknown") continue;

      if (!map.has(key)) {
        map.set(key, { students: 0, teachers: new Set<string>() });
      }

      const row = map.get(key);
      if (!row) continue;
      row.students += 1;

      const teacherName = student.teacher?.trim();
      if (teacherName) {
        row.teachers.add(teacherName);
      }
    }

    return map;
  }, [students]);

  const resolveSchoolDrawerRecord = useCallback(
    (schoolKey: string | null) => {
      if (!schoolKey) {
        return null;
      }

      const directRecord = recordBySchoolKey.get(schoolKey) ?? null;
      if (directRecord) {
        return directRecord;
      }

      const summary = schoolRequirementByKey.get(schoolKey) ?? null;
      const normalizedKey = schoolKey.trim().toLowerCase();
      const keyCode = normalizedKey.startsWith("code:") ? normalizedKey.slice("code:".length).trim().toUpperCase() : "";
      const keyName = normalizedKey.startsWith("name:") ? normalizedKey.slice("name:".length).trim() : "";
      const summaryCode = String(summary?.schoolCode ?? "").trim().toUpperCase();
      const summaryName = String(summary?.schoolName ?? "").trim().toLowerCase();

      return recordsWithReviewStatusOverrides.find((record) => {
        const recordCode = String(record.schoolCode ?? record.schoolId ?? "").trim().toUpperCase();
        const recordName = String(record.schoolName ?? "").trim().toLowerCase();

        return (
          (Boolean(summaryCode) && recordCode === summaryCode) ||
          (Boolean(keyCode) && recordCode === keyCode) ||
          (Boolean(summaryName) && recordName === summaryName) ||
          (Boolean(keyName) && recordName === keyName)
        );
      }) ?? null;
    },
    [recordBySchoolKey, recordsWithReviewStatusOverrides, schoolRequirementByKey],
  );

  const resolveSchoolDrawerRecordId = useCallback(
    (schoolKey: string | null) => {
      return String(resolveSchoolDrawerRecord(schoolKey)?.id ?? "").trim();
    },
    [resolveSchoolDrawerRecord],
  );

  const resolveSchoolDrawerCode = useCallback(
    (schoolKey: string | null) => {
      if (!schoolKey) {
        return "";
      }

      const summary = schoolRequirementByKey.get(schoolKey) ?? null;
      const record = resolveSchoolDrawerRecord(schoolKey);
      return (summary?.schoolCode ?? record?.schoolId ?? record?.schoolCode ?? "").trim();
    },
    [resolveSchoolDrawerRecord, schoolRequirementByKey],
  );

  const resolveSchoolDrawerLatestIndicatorSubmissionId = useCallback(
    (schoolKey: string | null) => {
      if (!schoolKey) {
        return "";
      }

      const record = resolveSchoolDrawerRecord(schoolKey);
      const latestRecordSubmissionId = String(record?.indicatorLatest?.id ?? "").trim();
      if (latestRecordSubmissionId) {
        return latestRecordSubmissionId;
      }

      const summary = schoolRequirementByKey.get(schoolKey) ?? null;
      const normalizedSchoolCode = String(summary?.schoolCode ?? record?.schoolCode ?? record?.schoolId ?? "")
        .trim()
        .toUpperCase();
      const normalizedSchoolName = String(summary?.schoolName ?? record?.schoolName ?? "")
        .trim()
        .toLowerCase();
      const matchingSubmissions = allSubmissions
        .filter((submission) => {
          const submissionSchoolCode = String(submission.school?.schoolCode ?? "").trim().toUpperCase();
          const submissionSchoolName = String(submission.school?.name ?? "").trim().toLowerCase();

          return (
            (Boolean(normalizedSchoolCode) && submissionSchoolCode === normalizedSchoolCode) ||
            (Boolean(normalizedSchoolName) && submissionSchoolName === normalizedSchoolName)
          );
        })
        .sort((left, right) => {
          const leftTime = new Date(left.updatedAt ?? left.submittedAt ?? left.createdAt ?? 0).getTime();
          const rightTime = new Date(right.updatedAt ?? right.submittedAt ?? right.createdAt ?? 0).getTime();
          return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        });

      return String(matchingSubmissions[0]?.id ?? "").trim();
    },
    [allSubmissions, resolveSchoolDrawerRecord, schoolRequirementByKey],
  );

  const {
    schoolDrawerKey,
    schoolDrawerRecordId,
    schoolDrawerSchoolCode,
    activeSchoolDrawerTab,
    selectedSchoolDrawerYear,
    availableSchoolDrawerYears,
    expandedDrawerIndicatorRows,
    highlightedDrawerIndicatorKey,
    schoolDrawerSubmissions,
    isSchoolDrawerSubmissionsLoading,
    schoolDrawerSubmissionsError,
    accurateSyncedCountsBySchoolKey,
    syncedCountsLoadingSchoolKey,
    syncedCountsError,
    openSchoolDrawer,
    closeSchoolDrawer,
    refreshSchoolDrawer,
    setActiveSchoolDrawerTab,
    setSelectedSchoolDrawerYear,
    setHighlightedDrawerIndicatorKey,
    toggleDrawerIndicatorLabel,
  } = useSchoolDrawer({
    authSessionKey,
    isAuthenticated,
    latestRealtimeBatch,
    resolveRecordId: resolveSchoolDrawerRecordId,
    resolveSchoolCode: resolveSchoolDrawerCode,
    resolveLatestIndicatorSubmissionId: resolveSchoolDrawerLatestIndicatorSubmissionId,
    fetchSubmission,
    listSubmissionsForSchool,
    queryStudents,
    listTeachers,
  });

  const schoolDrawerIndicatorSubmissions = useMemo(() => {
    const normalizedSchoolCode = schoolDrawerSchoolCode.trim().toUpperCase();
    if (!normalizedSchoolCode) {
      return schoolDrawerSubmissions;
    }

    const scopedDrawerSubmissions = schoolDrawerSubmissions.filter((submission) => {
      const rowSchoolCode = String(submission.school?.schoolCode ?? "")
        .trim()
        .toUpperCase();
      return rowSchoolCode === "" || rowSchoolCode === normalizedSchoolCode;
    });
    if (scopedDrawerSubmissions.length > 0) {
      return scopedDrawerSubmissions;
    }

    return allSubmissions.filter((submission) => (
      String(submission.school?.schoolCode ?? "")
        .trim()
        .toUpperCase() === normalizedSchoolCode
    ));
  }, [allSubmissions, schoolDrawerSchoolCode, schoolDrawerSubmissions]);
  const {
    schoolIndicatorMatrix,
    schoolIndicatorRowsByCategory,
    schoolIndicatorPackageRows,
    latestSchoolPackage,
    latestSchoolIndicatorYear,
    missingDrawerIndicatorKeys,
    returnedDrawerIndicatorKeys,
    missingDrawerIndicatorKeySet,
    returnedDrawerIndicatorKeySet,
    schoolDetail,
    schoolDrawerYearDetail,
    schoolDrawerHistorySummary,
    schoolDrawerCriticalAlerts,
  } = useMonitorDrawerViewModel({
    schoolDrawerKey,
    selectedSchoolDrawerYear,
    schoolDrawerSubmissions: schoolDrawerIndicatorSubmissions,
    schoolDrawerSubmissionsError,
    schoolRequirementByKey,
    recordBySchoolKey,
    studentStatsBySchoolKey,
    accurateSyncedCountsBySchoolKey,
  });
  const handleSchoolDrawerReviewDataChanged = useCallback(async (payload?: {
    reason: "scope-review" | "file-preview-stale";
    submission?: IndicatorSubmission;
    decision?: "verified" | "returned" | "unverified";
  }) => {
    if (payload?.reason === "scope-review") {
      const override = buildMonitorReviewStatusOverride(payload.submission, payload.decision);
      if (override) {
        setReviewStatusOverrides((current) => ({
          ...current,
          [override.schoolCode]: override,
        }));
      }
    }

    await refreshMonitorReviewData({
      refreshSchoolDrawer,
      refreshSubmissions,
      refreshRecords,
    });
  }, [refreshRecords, refreshSchoolDrawer, refreshSubmissions]);

  useEffect(() => {
    if (!latestRealtimeBatch) {
      return;
    }

    const hasMonitorVisibleIndicatorEvent = latestRealtimeBatch.updates.some((update) => (
      update.entity === "indicators" &&
      [
        "indicators.scopes_submitted",
        "indicators.scope_verified",
        "indicators.scope_unverified",
        "indicators.scope_returned",
      ].includes(update.eventType)
    ));
    if (!hasMonitorVisibleIndicatorEvent) {
      return;
    }

    void refreshMonitorReviewData({
      refreshSchoolDrawer,
      refreshSubmissions,
      refreshRecords,
    });
  }, [latestRealtimeBatch, refreshRecords, refreshSchoolDrawer, refreshSubmissions]);
  const quickJump = useMonitorQuickJump({
    quickJumpItems,
    focusedSectionId,
    showAdvancedFilters,
    showAdvancedAnalytics,
    setShowAdvancedFilters,
    setShowAdvancedAnalytics,
    focusAndScrollTo,
  });
  const {
    activeFilterChips,
    hiddenAdvancedFilterCount,
    clearAllFilters,
    resetQueueFilters,
    clearFilterChip,
  } = useMonitorFilterUi({
    filtersHydrated,
    activeTopNavigator,
    queueLane,
    selectedSchoolScopeKey,
    filterDateFrom,
    filterDateTo,
    requirementFilter,
    schoolQuickPreset,
    schoolSectorFilter,
    schoolLevelFilter,
    effectiveSearch,
    statusFilter,
    selectedSchoolScope,
    showAdvancedFilters,
    openScopeDropdownId,
    setShowMoreFilters,
    setShowAdvancedFilters,
    resetMonitorFilters,
    setSchoolScopeQuery,
    setOpenScopeDropdownId,
    setSearch,
    setStatusFilter,
    setRequirementFilter,
    setQueueLane,
    setSchoolQuickPreset,
    setSchoolSectorFilter,
    setSchoolLevelFilter,
    setFilterDateFrom,
    setFilterDateTo,
    setSelectedSchoolScopeKey,
  });
  useMonitorPageStateGuard({
    filterDateFrom,
    filterDateTo,
    requirementFilter,
    schoolQuickPreset,
    schoolSectorFilter,
    schoolLevelFilter,
    effectiveSearch,
    selectedSchoolScopeKey,
    statusFilter,
    requirementsPage,
    recordsPage,
    totalRequirementPages,
    totalRecordPages,
    visibleRequirementFilterIds,
    setRequirementsPage,
    setRecordsPage,
    setRequirementFilter,
  });
  const handleClearSchoolCategoryFilter = useCallback(() => {
    setSchoolSectorFilter("all");
    setSchoolLevelFilter("all");
    setActiveTopNavigator("schools");
    setRecordsPage(1);
    focusAndScrollTo("monitor-school-records");
  }, [
    focusAndScrollTo,
    setActiveTopNavigator,
    setRecordsPage,
    setSchoolLevelFilter,
    setSchoolSectorFilter,
  ]);
  const handleSelectSchoolCategoryFilter = useCallback(
    (sector: Exclude<SchoolSectorFilter, "all">, level: SchoolLevelFilter = "all") => {
      setSchoolSectorFilter(sector);
      setSchoolLevelFilter(level);
      setActiveTopNavigator("schools");
      setRecordsPage(1);
      focusAndScrollTo("monitor-school-records");
    },
    [
      focusAndScrollTo,
      setActiveTopNavigator,
      setRecordsPage,
      setSchoolLevelFilter,
      setSchoolSectorFilter,
    ],
  );
  const {
    remindingSchoolKey,
    sendReminderForSchool,
    handleReviewSchool,
    handleOpenSchool,
    handleSendReminder,
    handleReviewRecord,
    handleOpenSchoolRecord,
  } = useMonitorSchoolActionRouter({
    scopedRecordBySchoolKey,
    recordBySchoolKey,
    schoolRequirementByKey,
    setActiveTopNavigator,
    openSchoolDrawer,
    focusAndScrollTo,
    pushToast,
    sendReminder,
  });
  const {
    handleJumpToMissingIndicators,
    handleJumpToReturnedIndicators,
  } = useMonitorDrawerJumpActions({
    missingDrawerIndicatorKeys,
    returnedDrawerIndicatorKeys,
    schoolIndicatorMatrix,
    setActiveSchoolDrawerTab,
    setHighlightedDrawerIndicatorKey,
    pushToast,
  });
  const {
    activeScreenMeta,
    isPrimaryActionDisabled,
    focusGlobalSearch,
    cycleSchoolFocus,
    triggerKeyboardReview,
    handlePrimaryAction,
  } = useMonitorDashboardCommands({
    activeTopNavigator,
    compactSchoolRows,
    laneFilteredQueueRows,
    actionQueueRows,
    schoolRequirementByKey,
    selectedSchoolScopeKey,
    schoolDrawerKey,
    globalSearchInputRef,
    onToast: pushToast,
    setShowNavigatorManual,
    setActiveTopNavigator,
    openSchoolDrawer,
    onReviewSchool: handleReviewSchool,
    onOpenSchool: handleOpenSchool,
    focusAndScrollTo,
  });

  useMonitorDashboardHotkeys({
    topNavigatorIds: MONITOR_TOP_NAVIGATOR_IDS,
    quickJumpItems,
    shouldShowQuickJump: quickJump.shouldShowQuickJump,
    canResolveQuickJumpTarget: quickJump.canResolveQuickJumpTarget,
    onNavigateTop: handleMonitorTopNavigate,
    onQuickJump: quickJump.handleQuickJump,
    onFocusGlobalSearch: focusGlobalSearch,
    onCycleSchoolFocus: cycleSchoolFocus,
    onTriggerKeyboardReview: triggerKeyboardReview,
    onRefreshDashboard: () => {
      void handleRefreshDashboard();
    },
  });

  const {
    quickJumpBindings,
    quickFiltersProps,
    schoolDrawerProps,
  } = useMonitorDashboardBindings({
    quickJumpItems,
    getQuickJumpMeta: quickJump.getQuickJumpMeta,
    onQuickJump: quickJump.handleQuickJump,
    activeTopNavigator,
    showMoreFilters,
    setShowMoreFilters,
    hiddenAdvancedFilterCount,
    statusFilter,
    onStatusFilterChange: setStatusFilter,
    schoolStatusCounts,
    requirementFilter,
    onRequirementFilterChange: setRequirementFilter,
    visibleRequirementFilterOptions,
    queueLane,
    onQueueLaneChange: setQueueLane,
    queueLaneCounts,
    filterDateFrom,
    filterDateTo,
    onFilterDateFromChange: setFilterDateFrom,
    onFilterDateToChange: setFilterDateTo,
    isLoading,
    schoolScopeQuery,
    setSchoolScopeQuery,
    selectedSchoolScope,
    filteredSchoolScopeOptions,
    schoolScopeOptions,
    handleSelectAllSchools,
    handleSelectSchoolScope,
    openScopeDropdownId,
    toggleScopeDropdown,
    activeFilterChips,
    clearAllFilters,
    clearFilterChip,
    schoolDrawerBuildArgs: {
      isOpen: Boolean(schoolDrawerKey),
      showNavigatorManual,
      isMobileViewport,
      activeTopNavigator,
      activeSchoolDrawerTab,
      selectedSchoolDrawerYear,
      availableSchoolDrawerYears,
      highlightedDrawerIndicatorKey,
      expandedDrawerIndicatorRows,
      syncedCountsLoadingSchoolKey,
      syncedCountsError,
      isSchoolDrawerSubmissionsLoading,
      schoolDrawerSubmissionsError,
      schoolDetail,
      schoolDrawerYearDetail,
      schoolDrawerHistorySummary,
      schoolDrawerCriticalAlerts,
      schoolIndicatorPackageRows,
      latestSchoolPackage,
      schoolIndicatorMatrix,
      latestSchoolIndicatorYear,
      schoolDrawerIndicatorSubmissions,
      schoolIndicatorRowsByCategory,
      missingDrawerIndicatorKeys,
      returnedDrawerIndicatorKeys,
      missingDrawerIndicatorKeySet,
      returnedDrawerIndicatorKeySet,
      setActiveSchoolDrawerTab,
      setSelectedSchoolDrawerYear,
      closeSchoolDrawer,
      handleJumpToMissingIndicators,
      handleJumpToReturnedIndicators,
      toggleDrawerIndicatorLabel,
      onReviewDataChanged: handleSchoolDrawerReviewDataChanged,
      workflowTone,
      workflowLabel,
      formatDateTime,
    },
  });
  const handleDownloadSchoolCsvFormat = useCallback(() => {
    downloadCsvFile(
      `cspams-school-import-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "school_id",
        "school_name",
        "level",
        "type",
        "address",
        "district",
        "region",
        "status",
        "school_head_name",
        "school_head_email",
      ],
      records.map((record) => [
        record.schoolCode ?? record.schoolId ?? "",
        record.schoolName,
        record.level ?? "",
        record.type ?? "",
        record.address ?? "",
        record.district ?? "",
        record.region ?? "",
        record.status,
        record.schoolHeadAccount?.name ?? "",
        record.schoolHeadAccount?.email ?? "",
      ]),
    );
  }, [records]);

  const schoolsSectionApi = useMonitorSchoolsSection({
    isMobileViewport,
    isLoading,
    isSaving,
    records,
    recordsLength: records.length,
    totalSchoolsInScope,
    hasDashboardFilters,
    compactSchoolRows,
    paginatedCompactSchoolRows,
    recordBySchoolKey,
    safeRecordsPage,
    totalRecordPages,
    statusFilter,
    requirementFilter,
    schoolQuickPreset,
    setStatusFilter,
    setRequirementFilter,
    setSchoolQuickPreset,
    setRecordsPage,
    setActiveTopNavigator,
    addRecord,
    updateRecord,
    deleteRecord,
    previewDeleteRecord,
    listArchivedRecords,
    restoreRecord,
    permanentlyDeleteArchivedRecord,
    bulkImportRecords,
    updateSchoolHeadAccountStatus,
    activateSchoolHeadAccount,
    issueSchoolHeadAccountActionVerificationCode,
    issueSchoolHeadSetupLink,
    issueSchoolHeadPasswordResetLink,
    issueSchoolHeadTemporaryPassword,
    upsertSchoolHeadAccountProfile,
    removeSchoolHeadAccount,
    removeSchoolHeadAccountsBatch,
    onDownloadCsvFormat: handleDownloadSchoolCsvFormat,
    onOpenSchoolRecord: handleOpenSchoolRecord,
    onOpenSchool: handleOpenSchool,
    onReviewSchool: handleReviewSchool,
    onResetQueueFilters: resetQueueFilters,
    onClearAllFilters: clearAllFilters,
    pushToast,
    formatDateTime,
    statusTone,
    statusLabel,
    isUrgentRequirement,
    urgencyRowTone,
  });
  const handleToggleNavigatorChrome = useCallback(() => {
    if (isMobileViewport) {
      setIsNavigatorVisible((current) => !current);
      return;
    }

    setIsNavigatorCompact((current) => !current);
  }, [isMobileViewport, setIsNavigatorCompact, setIsNavigatorVisible]);
  const handleToggleNavigatorManual = useCallback(() => {
    setShowNavigatorManual((current) => !current);
    setFocusedSectionId(null);
    closeSchoolDrawer();
  }, [closeSchoolDrawer, setFocusedSectionId, setShowNavigatorManual]);

  return (
    <Shell
      title="Division Monitor Dashboard"
      subtitle=""
      actions={
        <MonitorDashboardShellActions
          isDashboardSyncing={isDashboardSyncing}
          dashboardLastSyncedAt={dashboardLastSyncedAt}
          syncStatus={syncStatus}
          syncScope={syncScope}
          onRefresh={() => void handleRefreshDashboard()}
          onOpenHelp={() => setShowHelpDialog(true)}
        />
      }
    >
      {dashboardError && (
        <section
          role="alert"
          className="mb-5 border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700"
        >
          <span className="font-semibold">{dashboardError.label} failed to refresh.</span>{" "}
          {dashboardError.message}
        </section>
      )}

      <DashboardHelpDialog open={showHelpDialog} variant="monitor" onClose={() => setShowHelpDialog(false)} />
      <MonitorMfaResetApprovalsDialog
        open={showMfaResetApprovalsDialog}
        isAuthenticated={isAuthenticated}
        onClose={() => setShowMfaResetApprovalsDialog(false)}
      />

      {!showNavigatorManual && isMobileViewport && (
        <MonitorMobileNavigator
          activeTopNavigator={activeTopNavigator}
          navigatorBadges={navigatorBadges}
          onNavigate={handleMonitorTopNavigate}
        />
      )}

      <div
        className={`dashboard-left-layout mb-5 min-w-0 lg:grid lg:items-stretch lg:gap-6 lg:transition-[grid-template-columns] lg:duration-[240ms] lg:ease-in-out ${
          isNavigatorCompact ? "lg:grid-cols-[5.25rem_minmax(0,1fr)]" : "lg:grid-cols-[17rem_minmax(0,1fr)]"
        }`}
      >
        <MonitorSideNavigator
          activeTopNavigator={activeTopNavigator}
          navigatorBadges={navigatorBadges}
          isNavigatorCompact={isNavigatorCompact}
          isNavigatorVisible={isNavigatorVisible}
          isMobileViewport={isMobileViewport}
          showNavigatorManual={showNavigatorManual}
          shouldRenderNavigatorItems={shouldRenderNavigatorItems}
          showNavigatorHeaderText={showNavigatorHeaderText}
          onToggleNavigator={handleToggleNavigatorChrome}
          onNavigate={handleMonitorTopNavigate}
          onToggleManual={handleToggleNavigatorManual}
        />
        <div className="dashboard-main-pane mt-4 min-w-0 lg:mt-0">
          {showNavigatorManual && <MonitorManualScreen onClose={() => setShowNavigatorManual(false)} />}

          {!showNavigatorManual && (
            <MonitorDashboardToolbar
              activeTopNavigator={activeTopNavigator}
              activeScreenMeta={activeScreenMeta}
              isPrimaryActionDisabled={isPrimaryActionDisabled}
              onPrimaryAction={handlePrimaryAction}
              showAdvancedFilters={showAdvancedFilters}
              activeFilterCount={activeFilterChips.length}
              onToggleFilters={() => setShowAdvancedFilters((current) => !current)}
              search={search}
              onSearchChange={setSearch}
              globalSearchInputRef={globalSearchInputRef}
            />
          )}

          <MonitorFiltersPanel
            isOpen={!showNavigatorManual && showSubmissionFilters}
            isMobileViewport={isMobileViewport}
            onClose={() => setShowAdvancedFilters(false)}
            quickFiltersProps={quickFiltersProps}
          />

          {!showNavigatorManual && activeTopNavigator === "reviews" && (
            <MonitorReviewsSection
              isMobileViewport={isMobileViewport}
              quickJumpBindings={quickJumpBindings}
              sectionFocusClass={sectionFocusClass}
              needsActionCount={needsActionCount}
              returnedCount={returnedCount}
              submittedCount={submittedCount}
              paginatedRequirementRows={paginatedRequirementRows}
              laneFilteredQueueRows={laneFilteredQueueRows}
              schoolDrawerKey={schoolDrawerKey}
              remindingSchoolKey={remindingSchoolKey}
              resetQueueFilters={resetQueueFilters}
              clearAllFilters={clearAllFilters}
              handleReviewSchool={handleReviewSchool}
              handleSendReminder={handleSendReminder}
              workflowTone={workflowTone}
              workflowLabel={workflowLabel}
              queuePriorityTone={queuePriorityTone}
              queuePriorityLabel={queuePriorityLabel}
              urgencyRowTone={urgencyRowTone}
              isUrgentRequirement={isUrgentRequirement}
              sanitizeAnchorToken={sanitizeAnchorToken}
              formatDateTime={formatDateTime}
              safeRequirementsPage={safeRequirementsPage}
              totalRequirementPages={totalRequirementPages}
              setRequirementsPage={setRequirementsPage}
            />
          )}

          {!showNavigatorManual && activeTopNavigator === "audit" && (
            <MonitorAuditTrail />
          )}

          {!showNavigatorManual && activeTopNavigator === "schools" && (
            <MonitorSchoolsSection
              sectionFocusClass={sectionFocusClass}
              isMobileViewport={isMobileViewport}
              quickJumpBindings={quickJumpBindings}
              totalSchoolsInScope={totalSchoolsInScope}
              monitorRadarTotals={monitorRadarTotals}
              schoolCategoryCounts={schoolCategoryCounts}
              schoolSectorFilter={schoolSectorFilter}
              schoolLevelFilter={schoolLevelFilter}
              onClearSchoolCategoryFilter={handleClearSchoolCategoryFilter}
              onSelectSchoolCategoryFilter={handleSelectSchoolCategoryFilter}
              paginatedCompactSchoolRowsCount={paginatedCompactSchoolRows.length}
              compactSchoolRowsCount={compactSchoolRows.length}
              activeSchoolPresetLabel={schoolsSectionApi.activeSchoolPresetLabel}
              schoolActionsMenuRef={schoolsSectionApi.schoolActionsMenuRef}
              bulkImportInputRef={schoolsSectionApi.bulkImportInputRef}
              onBulkImportFileChange={schoolsSectionApi.handleBulkImportFileChange}
              onOpenCreateRecordForm={schoolsSectionApi.openCreateRecordForm}
              onToggleAccountsPanel={schoolsSectionApi.toggleSchoolHeadAccountsPanel}
              showSchoolHeadAccountsPanel={schoolsSectionApi.showSchoolHeadAccountsPanel}
              onToggleActionsMenu={schoolsSectionApi.toggleActionsMenu}
              isSchoolActionsMenuOpen={schoolsSectionApi.isSchoolActionsMenuOpen}
              onDownloadCsvFormat={schoolsSectionApi.downloadCsvFormat}
              onOpenBulkImportPicker={schoolsSectionApi.openBulkImportPicker}
              isBulkImporting={schoolsSectionApi.isBulkImporting}
              onToggleArchivedRecords={() => {
                void schoolsSectionApi.toggleArchivedRecords();
              }}
              showArchivedRecords={schoolsSectionApi.showArchivedRecords}
              onShowMfaResetApprovals={() => {
                schoolsSectionApi.closeActionsMenu();
                setShowMfaResetApprovalsDialog(true);
              }}
              schoolHeadAccountsPanelProps={schoolsSectionApi.schoolHeadAccountsPanelProps}
              messages={schoolsSectionApi.schoolMessagesProps}
              schoolRecordFormProps={schoolsSectionApi.schoolRecordFormProps}
              schoolRecordsListProps={schoolsSectionApi.schoolRecordsListProps}
              archivedSchoolsProps={schoolsSectionApi.archivedSchoolsProps}
            />
          )}

          <MonitorSchoolDrawer {...schoolDrawerProps} />

          <MonitorToastStack toasts={toasts} onDismiss={dismissToast} />
        </div>
      </div>
    </Shell>
  );
}
