import { useMemo } from "react";
import type { MonitorSchoolRecordsListRow, MonitorSchoolRequirementSummary, SubmissionProgressBadge } from "@/pages/monitor/MonitorSchoolRecordsList";
import type {
  MonitorTopNavigatorId,
  QueueLane,
  RequirementFilter,
  SchoolLevelFilter,
  SchoolQuickPreset,
  SchoolSectorFilter,
} from "@/pages/monitor/monitorFilters";
import { getSubmissionUploadedFileTypes, resolveSubmissionRequirementProfile } from "@/utils/submissionRequirements";
import type { IndicatorSubmission, SchoolRecord, SchoolStatus } from "@/types";
import {
  isAwaitingReview,
  isPassedToMonitor,
  matchesAllSearchTerms,
  matchesQueueLane,
  matchesRequirementFilter,
  matchesSchoolQuickPreset,
  normalizeSchoolKey,
  normalizeSearchTerms,
  parseDateBoundary,
  queuePriorityScore,
  resolveWorkflowStatus,
} from "@/pages/monitor/monitorRequirementRules";
import { resolveMonitorSchoolDisplayStatus } from "@/pages/monitor/monitorSchoolStatus";
import {
  hasSchoolCoverageToken,
  isLegacyHighSchoolCoverage,
  parseSchoolCoverage,
  type SchoolCoverageToken,
} from "@/pages/monitor/schoolLevelLabels";

type SchoolRequirementSummary = MonitorSchoolRequirementSummary;

const PUBLIC_SUBMISSION_UNIT_IDS = [
  "school_achievements_learning_outcomes",
  "key_performance_indicators",
  "bmef",
  "smea",
] as const;

function normalizeProgressUnitId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function submissionTimestamp(submission: Pick<IndicatorSubmission, "updatedAt" | "submittedAt" | "createdAt">): number {
  return Math.max(
    new Date(submission.updatedAt ?? 0).getTime() || 0,
    new Date(submission.submittedAt ?? 0).getTime() || 0,
    new Date(submission.createdAt ?? 0).getTime() || 0,
  );
}

function buildSubmissionProgressBadge(
  schoolType: string | null | undefined,
  submission: IndicatorSubmission | null | undefined,
  fallbackStatus: string | null | undefined,
): SubmissionProgressBadge {
  const profile = resolveSubmissionRequirementProfile(schoolType);
  const submittedScopeIds = new Set((submission?.scopeProgress?.submittedScopeIds ?? []).map(normalizeProgressUnitId));
  const requiredScopeIds = (submission?.scopeProgress?.requiredScopeIds ?? []).map(normalizeProgressUnitId).filter(Boolean);
  const requiredUnits = profile.schoolType === "public"
    ? [...PUBLIC_SUBMISSION_UNIT_IDS]
    : requiredScopeIds.length > 0
      ? requiredScopeIds
      : profile.requiredFileTypes;
  const total = Math.max(1, requiredUnits.length);
  const uploadedFileTypes = new Set(getSubmissionUploadedFileTypes(submission).map(normalizeProgressUnitId));

  let submitted = 0;
  let usedDetailedProgress = false;

  const hasUnitSubmissionSignals = uploadedFileTypes.size > 0 || submittedScopeIds.size > 0;

  if (hasUnitSubmissionSignals) {
    usedDetailedProgress = true;
    submitted = requiredUnits.reduce((count, unit) => {
      const normalizedUnit = normalizeProgressUnitId(unit);
      return count + (submittedScopeIds.has(normalizedUnit) || uploadedFileTypes.has(normalizedUnit) ? 1 : 0);
    }, 0);
  } else if (
    typeof submission?.scopeProgress?.submittedRequiredScopeCount === "number" &&
    typeof submission.scopeProgress.totalRequiredScopeCount === "number" &&
    submission.scopeProgress.totalRequiredScopeCount > 0
  ) {
    usedDetailedProgress = true;
    submitted = Math.min(total, Math.max(0, submission.scopeProgress.submittedRequiredScopeCount));
  } else if (requiredScopeIds.length > 0) {
    usedDetailedProgress = true;
  } else if (isPassedToMonitor(normalizeMonitorPackageStatus(fallbackStatus))) {
    // TODO: Remove this conservative fallback once school rows always receive per-unit scope/file progress.
    submitted = Math.min(1, total);
  }

  const safeSubmitted = Math.min(total, Math.max(0, submitted));
  const tone = safeSubmitted === 0
    ? "border border-slate-300 bg-slate-100 text-slate-700"
    : safeSubmitted >= total
      ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border border-amber-200 bg-amber-50 text-amber-700";
  const label = `Submitted ${safeSubmitted}/${total}`;
  const title = usedDetailedProgress
    ? `${safeSubmitted} out of ${total} requirements have been submitted.`
    : `${safeSubmitted} out of ${total} requirements have been submitted. Detailed per-unit progress is unavailable for this row.`;

  return {
    submitted: safeSubmitted,
    total,
    label,
    title,
    tone,
  };
}

export interface SchoolCategoryCounts {
  total: number;
  public: number;
  private: number;
  publicElementary: number;
  publicJuniorHigh: number;
  publicSeniorHigh: number;
  publicLegacyHighSchool: number;
  privateElementary: number;
  privateJuniorHigh: number;
  privateSeniorHigh: number;
  privateLegacyHighSchool: number;
}

const EMPTY_SCHOOL_CATEGORY_COUNTS: SchoolCategoryCounts = {
  total: 0,
  public: 0,
  private: 0,
  publicElementary: 0,
  publicJuniorHigh: 0,
  publicSeniorHigh: 0,
  publicLegacyHighSchool: 0,
  privateElementary: 0,
  privateJuniorHigh: 0,
  privateSeniorHigh: 0,
  privateLegacyHighSchool: 0,
};

export function normalizeSchoolSector(value: string | null | undefined): Exclude<SchoolSectorFilter, "all"> | null {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "public") {
    return "public";
  }

  if (normalized === "private") {
    return "private";
  }

  return null;
}

export function normalizeSchoolLevel(value: string | null | undefined): Exclude<SchoolLevelFilter, "all"> | null {
  const parsed = parseSchoolCoverage(value);

  if (parsed.tokens.length === 1) {
    return parsed.tokens[0];
  }

  if (parsed.legacyHighSchool && parsed.tokens.length === 0) {
    return "high_school";
  }

  return null;
}

export function matchesSchoolCategoryFilter(
  record: Pick<SchoolRecord, "type" | "level"> | null | undefined,
  schoolSectorFilter: SchoolSectorFilter,
  schoolLevelFilter: SchoolLevelFilter,
): boolean {
  if (schoolSectorFilter === "all" && schoolLevelFilter === "all") {
    return true;
  }

  const sector = normalizeSchoolSector(record?.type);
  const levelValue = record?.level;

  if (schoolSectorFilter !== "all" && sector !== schoolSectorFilter) {
    return false;
  }

  if (
    schoolLevelFilter !== "all" &&
    !(
      (schoolLevelFilter === "legacy_high_school" || schoolLevelFilter === "high_school")
        ? isLegacyHighSchoolCoverage(levelValue)
        : hasSchoolCoverageToken(levelValue, schoolLevelFilter as SchoolCoverageToken)
    )
  ) {
    return false;
  }

  return true;
}

export function buildSchoolCategoryCounts(records: Iterable<Pick<SchoolRecord, "type" | "level">>): SchoolCategoryCounts {
  const counts: SchoolCategoryCounts = { ...EMPTY_SCHOOL_CATEGORY_COUNTS };

  for (const record of records) {
    counts.total += 1;

    const sector = normalizeSchoolSector(record.type);
    const parsed = parseSchoolCoverage(record.level);

    if (sector === "public") {
      counts.public += 1;
      if (parsed.tokens.includes("elementary")) counts.publicElementary += 1;
      if (parsed.tokens.includes("junior_high")) counts.publicJuniorHigh += 1;
      if (parsed.tokens.includes("senior_high")) counts.publicSeniorHigh += 1;
      if (parsed.legacyHighSchool && parsed.tokens.length === 0) counts.publicLegacyHighSchool += 1;
    }

    if (sector === "private") {
      counts.private += 1;
      if (parsed.tokens.includes("elementary")) counts.privateElementary += 1;
      if (parsed.tokens.includes("junior_high")) counts.privateJuniorHigh += 1;
      if (parsed.tokens.includes("senior_high")) counts.privateSeniorHigh += 1;
      if (parsed.legacyHighSchool && parsed.tokens.length === 0) counts.privateLegacyHighSchool += 1;
    }
  }

  return counts;
}

export interface MonitorRequirementSummaryState {
  packageSchoolType: "public" | "private";
  requirementModeLabel: string;
  activePackageLabel: string;
  indicatorStatus: string | null;
  hasActivePackageSubmission: boolean;
  hasAnySubmitted: boolean;
  isComplete: boolean;
  awaitingReviewCount: number;
  missingCount: number;
}

function normalizeMonitorPackageStatus(status: string | null | undefined): string | null {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  if (!normalizedStatus) {
    return null;
  }

  if (normalizedStatus === "draft") {
    return "draft";
  }
  if (normalizedStatus === "submitted") {
    return "submitted";
  }
  if (normalizedStatus === "validated") {
    return "validated";
  }
  if (normalizedStatus === "returned") {
    return "returned";
  }

  return null;
}

export function buildMonitorRequirementSummaryState(
  record: Pick<SchoolRecord, "type" | "indicatorLatest">,
  hasComplianceRecord: boolean,
): MonitorRequirementSummaryState {
  const requirementProfile = resolveSubmissionRequirementProfile(record.type);
  const normalizedIndicatorStatus = normalizeMonitorPackageStatus(record.indicatorLatest?.status ?? null);
  const hasActivePackageSubmission = isPassedToMonitor(normalizedIndicatorStatus);
  const awaitingReviewCount = isAwaitingReview(normalizedIndicatorStatus) ? 1 : 0;
  const missingCount = (hasComplianceRecord ? 0 : 1) + (hasActivePackageSubmission ? 0 : 1);

  return {
    packageSchoolType: requirementProfile.schoolType,
    requirementModeLabel:
      requirementProfile.schoolType === "private"
        ? "Active package requirements: FM-QAD uploads only."
        : "Active package requirements: BMEF and SMEA.",
    activePackageLabel:
      requirementProfile.schoolType === "private"
        ? "FM-QAD uploads only"
        : "BMEF and SMEA",
    indicatorStatus: normalizedIndicatorStatus,
    hasActivePackageSubmission,
    hasAnySubmitted: hasComplianceRecord || hasActivePackageSubmission,
    isComplete: missingCount === 0,
    awaitingReviewCount,
    missingCount,
  };
}

interface UseMonitorRequirementDataArgs {
  records: SchoolRecord[];
  scopedRecords: SchoolRecord[];
  allSubmissions?: IndicatorSubmission[];
  scopedSchoolKeys: Set<string> | null;
  selectedSchoolScopeKey: string;
  hasSelectedSchoolScope: boolean;
  filterDateFrom: string;
  filterDateTo: string;
  requirementFilter: RequirementFilter;
  statusFilter: SchoolStatus | "all";
  schoolQuickPreset: SchoolQuickPreset;
  schoolSectorFilter: SchoolSectorFilter;
  schoolLevelFilter: SchoolLevelFilter;
  queueLane: QueueLane;
  effectiveSearch: string;
  activeTopNavigator: MonitorTopNavigatorId;
  requirementsPage: number;
  recordsPage: number;
  requirementPageSize: number;
  recordPageSize: number;
  allSchoolScopeKey: string;
  requirementFilterOptions: Array<{ id: RequirementFilter; label: string }>;
}

export interface UseMonitorRequirementDataResult {
  schoolRequirementRows: SchoolRequirementSummary[];
  scopedRequirementRows: SchoolRequirementSummary[];
  schoolRequirementByKey: Map<string, SchoolRequirementSummary>;
  recordBySchoolKey: Map<string, SchoolRecord>;
  scopedRecordBySchoolKey: Map<string, SchoolRecord>;
  workflowStatusCounts: Record<RequirementFilter, number>;
  schoolStatusCounts: Record<SchoolStatus | "all", number>;
  visibleRequirementFilterIds: RequirementFilter[];
  visibleRequirementFilterOptions: Array<{ id: RequirementFilter; label: string }>;
  filteredRequirementRows: SchoolRequirementSummary[];
  filteredSchoolKeys: Set<string> | null;
  hasDashboardFilters: boolean;
  requirementCounts: {
    total: number;
    submittedAny: number;
    complete: number;
    awaitingReview: number;
    missing: number;
    returned: number;
  };
  needsActionCount: number;
  actionQueueRows: SchoolRequirementSummary[];
  queueLaneCounts: Record<QueueLane, number>;
  laneFilteredQueueRows: SchoolRequirementSummary[];
  schoolPresetCounts: Record<SchoolQuickPreset, number>;
  schoolCategoryCounts: SchoolCategoryCounts;
  filteredSchoolsByPreset: SchoolRequirementSummary[];
  stickySummaryStats: {
    totalSchools: number;
    pending: number;
    missing: number;
    returned: number;
  };
  compactSchoolRows: MonitorSchoolRecordsListRow[];
  totalRequirementPages: number;
  safeRequirementsPage: number;
  paginatedRequirementRows: SchoolRequirementSummary[];
  totalRecordPages: number;
  safeRecordsPage: number;
  paginatedCompactSchoolRows: MonitorSchoolRecordsListRow[];
}

function buildRecordBySchoolKey(records: SchoolRecord[]): Map<string, SchoolRecord> {
  const map = new Map<string, SchoolRecord>();

  for (const record of records) {
    const key = normalizeSchoolKey(record.schoolId ?? record.schoolCode ?? null, record.schoolName);
    if (key === "unknown") continue;

    const existing = map.get(key);
    const existingUpdatedAt = new Date(existing?.lastUpdated ?? 0).getTime();
    const candidateUpdatedAt = new Date(record.lastUpdated ?? 0).getTime();

    if (!existing || candidateUpdatedAt >= existingUpdatedAt) {
      map.set(key, record);
    }
  }

  return map;
}

export function useMonitorRequirementData({
  records,
  scopedRecords,
  allSubmissions = [],
  scopedSchoolKeys,
  selectedSchoolScopeKey,
  hasSelectedSchoolScope,
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
  requirementPageSize,
  recordPageSize,
  allSchoolScopeKey,
  requirementFilterOptions,
}: UseMonitorRequirementDataArgs): UseMonitorRequirementDataResult {
  const latestSubmissionBySchoolKey = useMemo(() => {
    const map = new Map<string, IndicatorSubmission>();

    for (const submission of allSubmissions) {
      const key = normalizeSchoolKey(submission.school?.schoolCode ?? submission.schoolId ?? null, submission.school?.name ?? null);
      if (key === "unknown") continue;

      const existing = map.get(key);
      if (!existing || submissionTimestamp(submission) >= submissionTimestamp(existing)) {
        map.set(key, submission);
      }
    }

    return map;
  }, [allSubmissions]);

  const schoolRequirementRows = useMemo<SchoolRequirementSummary[]>(() => {
    const rows = new Map<string, SchoolRequirementSummary>();

    const ensureRow = (
      schoolCode: string | null | undefined,
      schoolName: string | null | undefined,
      region: string | null | undefined,
      schoolStatus: SchoolStatus | null = null,
    ) => {
      const key = normalizeSchoolKey(schoolCode, schoolName);
      if (key === "unknown") return null;

      const normalizedCode = schoolCode?.trim() || "N/A";
      const normalizedName = schoolName?.trim() || normalizedCode || "Unknown School";
      const normalizedRegion = region?.trim() || "N/A";

      let row = rows.get(key);
      if (!row) {
        row = {
          schoolKey: key,
          schoolCode: normalizedCode,
          schoolName: normalizedName,
          region: normalizedRegion,
          schoolLevel: null,
          schoolType: null,
          schoolStatus,
          packageSchoolType: "public",
          requirementModeLabel: "Active package requirements: BMEF and SMEA.",
          activePackageLabel: "BMEF and SMEA",
          hasComplianceRecord: false,
          indicatorStatus: null,
          hasActivePackageSubmission: false,
          hasAnySubmitted: false,
          isComplete: false,
          awaitingReviewCount: 0,
          missingCount: 2,
          submissionProgress: buildSubmissionProgressBadge("public", null, null),
          lastActivityAt: null,
          lastActivityTime: 0,
          hasReminderRecipient: false,
          reminderRecipientStatus: "missing",
          latestReminder: null,
        };
        rows.set(key, row);
      } else {
        if (row.schoolCode === "N/A" && normalizedCode !== "N/A") {
          row.schoolCode = normalizedCode;
        }
        if ((row.schoolName === "Unknown School" || row.schoolName === "N/A") && normalizedName !== "Unknown School") {
          row.schoolName = normalizedName;
        }
        if (row.region === "N/A" && normalizedRegion !== "N/A") {
          row.region = normalizedRegion;
        }
        if (!row.schoolStatus && schoolStatus) {
          row.schoolStatus = schoolStatus;
        }
      }

      return row;
    };

    const setLastActivity = (row: SchoolRequirementSummary, ...dates: Array<string | null | undefined>) => {
      const activityTimes = dates
        .map((value) => new Date(value ?? 0).getTime())
        .filter((value) => Number.isFinite(value) && value > 0);
      const activityTime = activityTimes.length > 0 ? Math.max(...activityTimes) : 0;

      if (activityTime > row.lastActivityTime) {
        row.lastActivityTime = activityTime;
        row.lastActivityAt = new Date(activityTime).toISOString();
      }
    };

    for (const record of records) {
      const displayStatus = resolveMonitorSchoolDisplayStatus(record);
      const row = ensureRow(record.schoolId ?? record.schoolCode ?? null, record.schoolName, record.region, displayStatus);
      if (!row) continue;

      row.hasComplianceRecord = true;
      row.schoolStatus = displayStatus;
      row.schoolLevel = record.level ?? null;
      row.schoolType = record.type ?? null;
      row.hasReminderRecipient = record.hasReminderRecipient ?? true;
      row.reminderRecipientStatus = record.reminderRecipientStatus ?? (row.hasReminderRecipient ? "available" : "missing");
      row.latestReminder = record.latestReminder ?? null;
      setLastActivity(row, record.lastUpdated);

      const indicatorLatest = record.indicatorLatest ?? null;
      const latestSubmission = latestSubmissionBySchoolKey.get(row.schoolKey) ?? null;
      const summaryState = buildMonitorRequirementSummaryState(record, true);
      row.packageSchoolType = summaryState.packageSchoolType;
      row.requirementModeLabel = summaryState.requirementModeLabel;
      row.activePackageLabel = summaryState.activePackageLabel;
      row.indicatorStatus = summaryState.indicatorStatus;
      row.hasActivePackageSubmission = summaryState.hasActivePackageSubmission;
      row.awaitingReviewCount = summaryState.awaitingReviewCount;
      row.missingCount = summaryState.missingCount;
      row.hasAnySubmitted = summaryState.hasAnySubmitted;
      row.isComplete = summaryState.isComplete;
      row.submissionProgress = buildSubmissionProgressBadge(record.type, latestSubmission, indicatorLatest?.status ?? null);
      if (indicatorLatest) {
        setLastActivity(row, indicatorLatest.updatedAt, indicatorLatest.submittedAt, indicatorLatest.createdAt);
      }
      if (latestSubmission) {
        setLastActivity(row, latestSubmission.updatedAt, latestSubmission.submittedAt, latestSubmission.createdAt);
      }
    }

    return [...rows.values()]
      .map((row) => {
        const summaryState = {
          packageSchoolType: row.packageSchoolType,
          requirementModeLabel: row.requirementModeLabel,
          activePackageLabel: row.activePackageLabel,
          indicatorStatus: row.indicatorStatus,
          hasActivePackageSubmission: row.hasActivePackageSubmission,
          hasAnySubmitted: row.hasAnySubmitted,
          isComplete: row.isComplete,
          awaitingReviewCount: row.awaitingReviewCount,
          missingCount: row.missingCount,
          submissionProgress: row.submissionProgress,
        };

        return {
          ...row,
          ...summaryState,
        };
      })
      .sort((a, b) => a.schoolName.localeCompare(b.schoolName));
  }, [latestSubmissionBySchoolKey, records]);

  const scopedRequirementRows = useMemo(() => {
    if (!scopedSchoolKeys) {
      return schoolRequirementRows;
    }

    return schoolRequirementRows.filter((row) => scopedSchoolKeys.has(row.schoolKey));
  }, [schoolRequirementRows, scopedSchoolKeys]);

  const schoolRequirementByKey = useMemo(
    () => new Map(scopedRequirementRows.map((row) => [row.schoolKey, row])),
    [scopedRequirementRows],
  );

  const recordBySchoolKey = useMemo(() => buildRecordBySchoolKey(records), [records]);
  const scopedRecordBySchoolKey = useMemo(() => buildRecordBySchoolKey(scopedRecords), [scopedRecords]);

  const schoolCategoryCounts = useMemo(
    () => buildSchoolCategoryCounts(scopedRecordBySchoolKey.values()),
    [scopedRecordBySchoolKey],
  );

  const workflowStatusCounts = useMemo<Record<RequirementFilter, number>>(() => {
    const counts: Record<RequirementFilter, number> = {
      all: scopedRequirementRows.length,
      missing: 0,
      waiting: 0,
      returned: 0,
      submitted: 0,
      validated: 0,
    };

    for (const row of scopedRequirementRows) {
      counts[resolveWorkflowStatus(row)] += 1;
    }

    return counts;
  }, [resolveWorkflowStatus, scopedRequirementRows]);

  const schoolStatusCounts = useMemo<Record<SchoolStatus | "all", number>>(() => {
    const counts: Record<SchoolStatus | "all", number> = {
      all: scopedRequirementRows.length,
      active: 0,
      inactive: 0,
      pending: 0,
    };

    for (const row of scopedRequirementRows) {
      if (row.schoolStatus === "active") {
        counts.active += 1;
      } else if (row.schoolStatus === "inactive") {
        counts.inactive += 1;
      } else if (row.schoolStatus === "pending") {
        counts.pending += 1;
      }
    }

    return counts;
  }, [scopedRequirementRows]);

  const visibleRequirementFilterIds = useMemo<RequirementFilter[]>(() => {
    if (activeTopNavigator === "reviews") {
      return ["all", "missing", "waiting", "returned"];
    }

    return ["all", "missing", "waiting", "returned", "submitted", "validated"];
  }, [activeTopNavigator]);

  const visibleRequirementFilterOptions = useMemo(
    () =>
      requirementFilterOptions
        .filter((option) => visibleRequirementFilterIds.includes(option.id))
        .map((option) => ({
          id: option.id,
          label: `${option.label} (${workflowStatusCounts[option.id]})`,
        })),
    [requirementFilterOptions, visibleRequirementFilterIds, workflowStatusCounts],
  );

  const searchTerms = useMemo(() => normalizeSearchTerms(effectiveSearch), [effectiveSearch]);
  const shouldBuildRequirementSearchIndex = searchTerms.length > 0;

  const requirementSearchTextByKey = useMemo(() => {
    if (!shouldBuildRequirementSearchIndex) {
      return null;
    }

    const index = new Map<string, string>();

    for (const row of scopedRequirementRows) {
      const record = scopedRecordBySchoolKey.get(row.schoolKey);
      const searchableText = [
        row.schoolName,
        row.schoolCode,
        row.region,
        record?.level ?? "",
        record?.type ?? "",
        record?.address ?? record?.district ?? "",
        record?.submittedBy ?? "",
        record?.schoolHeadAccount?.name ?? "",
        record?.schoolHeadAccount?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();

      index.set(row.schoolKey, searchableText);
    }

    return index;
  }, [scopedRecordBySchoolKey, scopedRequirementRows, shouldBuildRequirementSearchIndex]);

  const filteredRequirementRows = useMemo(() => {
    const fromTime = parseDateBoundary(filterDateFrom, "start");
    const toTime = parseDateBoundary(filterDateTo, "end");
    const hasSearchTerms = searchTerms.length > 0;
    const results: SchoolRequirementSummary[] = [];

    for (const row of scopedRequirementRows) {
      if (statusFilter !== "all" && row.schoolStatus !== statusFilter) {
        continue;
      }

      if (!matchesRequirementFilter(row, requirementFilter)) {
        continue;
      }

      const record = scopedRecordBySchoolKey.get(row.schoolKey) ?? recordBySchoolKey.get(row.schoolKey) ?? null;
      if (!matchesSchoolCategoryFilter(record, schoolSectorFilter, schoolLevelFilter)) {
        continue;
      }

      if (fromTime !== null && (row.lastActivityTime <= 0 || row.lastActivityTime < fromTime)) {
        continue;
      }

      if (toTime !== null && (row.lastActivityTime <= 0 || row.lastActivityTime > toTime)) {
        continue;
      }

      if (hasSearchTerms) {
        const searchableText = requirementSearchTextByKey?.get(row.schoolKey) ?? "";
        if (!matchesAllSearchTerms(searchableText, searchTerms)) {
          continue;
        }
      }

      results.push(row);
    }

    return results;
  }, [
    filterDateFrom,
    filterDateTo,
    requirementFilter,
    requirementSearchTextByKey,
    recordBySchoolKey,
    schoolLevelFilter,
    schoolSectorFilter,
    scopedRecordBySchoolKey,
    scopedRequirementRows,
    searchTerms,
    statusFilter,
  ]);

  const hasDashboardFilters =
    searchTerms.length > 0 ||
    statusFilter !== "all" ||
    requirementFilter !== "all" ||
    schoolQuickPreset !== "all" ||
    schoolSectorFilter !== "all" ||
    schoolLevelFilter !== "all" ||
    hasSelectedSchoolScope ||
    filterDateFrom.length > 0 ||
    filterDateTo.length > 0;

  const filteredSchoolKeys = useMemo(() => {
    if (!hasDashboardFilters && !scopedSchoolKeys) {
      return null;
    }

    const scopeRows =
      schoolQuickPreset === "all"
        ? filteredRequirementRows
        : filteredRequirementRows.filter((row) => matchesSchoolQuickPreset(row, schoolQuickPreset));

    return new Set(scopeRows.map((row) => row.schoolKey));
  }, [filteredRequirementRows, hasDashboardFilters, schoolQuickPreset, scopedSchoolKeys]);

  const requirementCounts = useMemo(() => {
    const counts = {
      total: scopedRequirementRows.length,
      submittedAny: 0,
      complete: 0,
      awaitingReview: 0,
      missing: 0,
      returned: 0,
    };

    for (const row of scopedRequirementRows) {
      if (row.hasAnySubmitted) counts.submittedAny += 1;
      if (row.isComplete) counts.complete += 1;
      if (row.awaitingReviewCount > 0) counts.awaitingReview += 1;
      if (row.missingCount > 0) counts.missing += 1;
      if (row.indicatorStatus === "returned") counts.returned += 1;
    }

    return counts;
  }, [scopedRequirementRows]);

  const needsActionCount = useMemo(
    () =>
      scopedRequirementRows.filter(
        (row) => row.missingCount > 0 || row.awaitingReviewCount > 0 || row.indicatorStatus === "returned",
      ).length,
    [scopedRequirementRows],
  );

  const actionQueueRows = useMemo(
    () =>
      filteredRequirementRows
        .filter((row) => row.missingCount > 0 || row.awaitingReviewCount > 0 || row.indicatorStatus === "returned")
        .sort((a, b) => {
          const priorityDiff = queuePriorityScore(a) - queuePriorityScore(b);
          if (priorityDiff !== 0) return priorityDiff;

          const missingDiff = b.missingCount - a.missingCount;
          if (missingDiff !== 0) return missingDiff;

          const waitingDiff = b.awaitingReviewCount - a.awaitingReviewCount;
          if (waitingDiff !== 0) return waitingDiff;

          const activityDiff = b.lastActivityTime - a.lastActivityTime;
          if (activityDiff !== 0) return activityDiff;

          return a.schoolName.localeCompare(b.schoolName);
        }),
    [filteredRequirementRows],
  );

  const queueLaneCounts = useMemo(() => {
    const counts: Record<QueueLane, number> = {
      all: actionQueueRows.length,
      urgent: 0,
      returned: 0,
      for_review: 0,
      waiting_data: 0,
    };

    for (const row of actionQueueRows) {
      if (matchesQueueLane(row, "urgent")) counts.urgent += 1;
      if (matchesQueueLane(row, "returned")) counts.returned += 1;
      if (matchesQueueLane(row, "for_review")) counts.for_review += 1;
      if (matchesQueueLane(row, "waiting_data")) counts.waiting_data += 1;
    }

    return counts;
  }, [actionQueueRows]);

  const laneFilteredQueueRows = useMemo(
    () => actionQueueRows.filter((row) => matchesQueueLane(row, queueLane)),
    [actionQueueRows, queueLane],
  );

  const schoolPresetCounts = useMemo<Record<SchoolQuickPreset, number>>(() => {
    const counts: Record<SchoolQuickPreset, number> = {
      all: filteredRequirementRows.length,
      pending: 0,
      missing: 0,
      returned: 0,
      no_submission: 0,
    };

    for (const row of filteredRequirementRows) {
      if (matchesSchoolQuickPreset(row, "pending")) counts.pending += 1;
      if (matchesSchoolQuickPreset(row, "missing")) counts.missing += 1;
      if (matchesSchoolQuickPreset(row, "returned")) counts.returned += 1;
      if (matchesSchoolQuickPreset(row, "no_submission")) counts.no_submission += 1;
    }

    return counts;
  }, [filteredRequirementRows]);

  const filteredSchoolsByPreset = useMemo(
    () => filteredRequirementRows.filter((row) => matchesSchoolQuickPreset(row, schoolQuickPreset)),
    [filteredRequirementRows, schoolQuickPreset],
  );

  const stickySummaryStats = useMemo(
    () => ({
      totalSchools: schoolPresetCounts.all,
      pending: schoolPresetCounts.pending,
      missing: schoolPresetCounts.missing,
      returned: schoolPresetCounts.returned,
    }),
    [
      schoolPresetCounts.all,
      schoolPresetCounts.missing,
      schoolPresetCounts.pending,
      schoolPresetCounts.returned,
    ],
  );

  const compactSchoolRows = useMemo(
    () =>
      filteredSchoolsByPreset
        .map((summary) => {
          const record = scopedRecordBySchoolKey.get(summary.schoolKey) ?? recordBySchoolKey.get(summary.schoolKey) ?? null;
          return { summary, record };
        })
        .sort((a, b) => {
          const priorityDiff = queuePriorityScore(a.summary) - queuePriorityScore(b.summary);
          if (priorityDiff !== 0) return priorityDiff;

          const missingDiff = b.summary.missingCount - a.summary.missingCount;
          if (missingDiff !== 0) return missingDiff;

          const waitingDiff = b.summary.awaitingReviewCount - a.summary.awaitingReviewCount;
          if (waitingDiff !== 0) return waitingDiff;

          const activityDiff = b.summary.lastActivityTime - a.summary.lastActivityTime;
          if (activityDiff !== 0) return activityDiff;

          return a.summary.schoolName.localeCompare(b.summary.schoolName);
        }),
    [filteredSchoolsByPreset, recordBySchoolKey, scopedRecordBySchoolKey],
  );

  const totalRequirementPages = Math.max(1, Math.ceil(laneFilteredQueueRows.length / requirementPageSize));
  const safeRequirementsPage = Math.min(requirementsPage, totalRequirementPages);

  const paginatedRequirementRows = useMemo(() => {
    const start = (safeRequirementsPage - 1) * requirementPageSize;
    return laneFilteredQueueRows.slice(start, start + requirementPageSize);
  }, [laneFilteredQueueRows, requirementPageSize, safeRequirementsPage]);

  const totalRecordPages = Math.max(1, Math.ceil(compactSchoolRows.length / recordPageSize));
  const safeRecordsPage = Math.min(recordsPage, totalRecordPages);

  const paginatedCompactSchoolRows = useMemo(() => {
    const start = (safeRecordsPage - 1) * recordPageSize;
    return compactSchoolRows.slice(start, start + recordPageSize);
  }, [compactSchoolRows, recordPageSize, safeRecordsPage]);

  return {
    schoolRequirementRows,
    scopedRequirementRows,
    schoolRequirementByKey,
    recordBySchoolKey,
    scopedRecordBySchoolKey,
    workflowStatusCounts,
    schoolStatusCounts,
    visibleRequirementFilterIds,
    visibleRequirementFilterOptions,
    filteredRequirementRows,
    filteredSchoolKeys,
    hasDashboardFilters,
    requirementCounts,
    needsActionCount,
    actionQueueRows,
    queueLaneCounts,
    laneFilteredQueueRows,
    schoolPresetCounts,
    schoolCategoryCounts,
    filteredSchoolsByPreset,
    stickySummaryStats,
    compactSchoolRows,
    totalRequirementPages,
    safeRequirementsPage,
    paginatedRequirementRows,
    totalRecordPages,
    safeRecordsPage,
    paginatedCompactSchoolRows,
  };
}
