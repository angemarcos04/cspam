import { SUBMISSION_FILE_DEFINITION_BY_TYPE } from "@/constants/submissionFiles";
import type {
  IndicatorMatrixRow,
  MonitorDrawerChecklistItem,
  MonitorDrawerKpiReportRow,
  MonitorDrawerPackageRow,
  MonitorDrawerSchoolAchievementReportRow,
  MonitorDrawerYearDetail,
  MonitorDrawerYearOption,
  SchoolDetailSnapshot,
} from "@/pages/monitor/monitorDrawerTypes";
import {
  KEY_PERFORMANCE_CATEGORY_LABEL,
  SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL,
  deriveSchoolYearLabel,
  indicatorCategoryLabel,
  schoolYearStartValue,
} from "@/pages/monitor/monitorDrawerViewModelUtils";
import {
  buildSubmittedReportBlankStateLines,
  resolveIndicatorValue,
  resolveSubmittedReportIndicatorByMetricCode,
  submissionRows,
} from "@/pages/schoolAdminSubmittedReportView";
import { getSubmissionUploadedFileTypes, resolveSubmissionRequirementProfile } from "@/utils/submissionRequirements";
import type { IndicatorSubmission, IndicatorSubmissionFileType } from "@/types";

const BASE_SCHOOL_YEAR_START = 2025;
const SCHOOL_YEAR_WINDOW_SIZE = 5;
const SCHOOL_ACHIEVEMENTS_SCOPE_ID = "school_achievements_learning_outcomes";
const KEY_PERFORMANCE_SCOPE_ID = "key_performance_indicators";

function monitorSectionActionTarget(scopeId: string): MonitorDrawerPackageRow["actionTarget"] {
  const normalized = normalizeScopeId(scopeId);
  if (normalized === SCHOOL_ACHIEVEMENTS_SCOPE_ID) {
    return "school_achievements";
  }
  if (normalized === KEY_PERFORMANCE_SCOPE_ID) {
    return "key_performance";
  }
  return null;
}

function toSubmissionActivityTime(submission: IndicatorSubmission | null | undefined): number {
  return new Date(
    submission?.submittedAt
    ?? submission?.updatedAt
    ?? submission?.createdAt
    ?? 0,
  ).getTime();
}

function isMonitorRelevantPackageStatus(status: string | null | undefined): boolean {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  return normalizedStatus === "draft" || normalizedStatus === "submitted" || normalizedStatus === "validated" || normalizedStatus === "returned";
}

function isFullMonitorReportStatus(status: string | null | undefined): boolean {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  return normalizedStatus === "submitted" || normalizedStatus === "validated" || normalizedStatus === "returned";
}

function normalizeScopeId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function submittedScopeIdSet(submission: IndicatorSubmission | null | undefined): Set<string> {
  return new Set(
    (submission?.scopeProgress?.submittedScopeIds ?? [])
      .map((scopeId) => normalizeScopeId(scopeId))
      .filter(Boolean),
  );
}

function hasSentMonitorScopes(submission: IndicatorSubmission | null | undefined): boolean {
  return submittedScopeIdSet(submission).size > 0;
}

function isMonitorReportSourceSubmission(submission: IndicatorSubmission | null | undefined): boolean {
  if (!submission) {
    return false;
  }

  return isFullMonitorReportStatus(submission.status) || hasSentMonitorScopes(submission);
}

function isScopeVisibleToMonitor(
  submission: IndicatorSubmission | null | undefined,
  scopeId: string,
): boolean {
  if (!submission) {
    return false;
  }

  if (isFullMonitorReportStatus(submission.status)) {
    return true;
  }

  return submittedScopeIdSet(submission).has(normalizeScopeId(scopeId));
}

function normalizeWorkflowStatus(status: string | null | undefined): string | null {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  return normalizedStatus || null;
}

function hasDisplayValue(value: string): boolean {
  return value.trim().length > 0 && value.trim() !== "-";
}

function resolveChecklistTone(statusLabel: MonitorDrawerChecklistItem["statusLabel"]): MonitorDrawerChecklistItem["tone"] {
  if (statusLabel === "Missing" || statusLabel === "Returned") {
    return "warning";
  }
  if (statusLabel === "For Review") {
    return "info";
  }
  return "success";
}

function currentSchoolYearStart(now: Date = new Date()): number {
  const schoolYearLabel = deriveSchoolYearLabel(now.toISOString());
  return schoolYearStartValue(schoolYearLabel) ?? now.getFullYear();
}

function buildFallbackSchoolYears(now: Date = new Date()): string[] {
  const currentStart = currentSchoolYearStart(now);
  const initialWindowEnd = BASE_SCHOOL_YEAR_START + SCHOOL_YEAR_WINDOW_SIZE - 1;
  const windowStartYear = currentStart > initialWindowEnd
    ? currentStart - (SCHOOL_YEAR_WINDOW_SIZE - 1)
    : BASE_SCHOOL_YEAR_START;

  return Array.from({ length: SCHOOL_YEAR_WINDOW_SIZE }, (_, offset) => {
    const fromYear = windowStartYear + offset;
    return `${fromYear}-${fromYear + 1}`;
  });
}

export function deriveVisibleMonitorSchoolYearWindow(now: Date = new Date()): string[] {
  return buildFallbackSchoolYears(now);
}

function buildMonitorChecklistSectionItems(
  currentYearRows: IndicatorMatrixRow[],
  latestYearIndicators: ReturnType<typeof submissionRows>,
  selectedYearWorkflowStatus: string | null,
  selectedYearLabel: string | null,
  submittedScopeIds: Set<string>,
): MonitorDrawerChecklistItem[] {
  const sectionDefinitions = [
    { id: SCHOOL_ACHIEVEMENTS_SCOPE_ID, label: "School Achievements", category: SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL },
    { id: KEY_PERFORMANCE_SCOPE_ID, label: "Key Performance", category: KEY_PERFORMANCE_CATEGORY_LABEL },
  ] as const;

  return sectionDefinitions.map<MonitorDrawerChecklistItem>((section) => {
    const categoryRows = currentYearRows.filter((row) => row.category === section.category);
    const indicators = latestYearIndicators.filter(
      (indicator) => indicatorCategoryLabel(indicator.metric?.code ?? null) === section.category,
    );
    const isSchoolAchievements = section.category === SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL;
    const isComplete = categoryRows.length > 0 && categoryRows.every((row) => {
      const indicator = resolveSubmittedReportIndicatorByMetricCode(indicators, row.code);
      if (!indicator) {
        return false;
      }

      if (isSchoolAchievements) {
        return hasDisplayValue(resolveIndicatorValue(indicator, "actual", selectedYearLabel));
      }

      return hasDisplayValue(resolveIndicatorValue(indicator, "target", selectedYearLabel))
        && hasDisplayValue(resolveIndicatorValue(indicator, "actual", selectedYearLabel));
    });

    let statusLabel: MonitorDrawerChecklistItem["statusLabel"] = isComplete ? "Complete" : "Missing";
    const isScopeSent = submittedScopeIds.has(normalizeScopeId(section.id));
    if (isComplete && selectedYearWorkflowStatus === "returned") {
      statusLabel = "Returned";
    } else if (isComplete && (selectedYearWorkflowStatus === "submitted" || isScopeSent)) {
      statusLabel = "For Review";
    }

    return {
      id: section.id,
      label: section.label,
      statusLabel,
      tone: resolveChecklistTone(statusLabel),
      detail: isComplete
        ? section.category === SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL
          ? "Section values are available for this year."
          : "Targets and actual values are available for this year."
        : "Section data is still incomplete for this year.",
      kind: "section",
    };
  });
}

function buildMonitorChecklistFileItems(
  schoolTypeRaw: string | null,
  latestYearSubmission: IndicatorSubmission | null,
  selectedYearWorkflowStatus: string | null,
  submittedScopeIds: Set<string>,
): MonitorDrawerChecklistItem[] {
  const requirementProfile = resolveSubmissionRequirementProfile(schoolTypeRaw);
  const uploadedFileTypes = new Set(getSubmissionUploadedFileTypes(latestYearSubmission));

  return requirementProfile.requiredFileTypes.map<MonitorDrawerChecklistItem>((type) => {
    const definition = SUBMISSION_FILE_DEFINITION_BY_TYPE[type];
    let statusLabel: MonitorDrawerChecklistItem["statusLabel"] = uploadedFileTypes.has(type) ? "Uploaded" : "Missing";
    const isScopeSent = submittedScopeIds.has(normalizeScopeId(type));
    if (uploadedFileTypes.has(type) && selectedYearWorkflowStatus === "returned") {
      statusLabel = "Returned";
    } else if (uploadedFileTypes.has(type) && (selectedYearWorkflowStatus === "submitted" || isScopeSent)) {
      statusLabel = "For Review";
    }

    return {
      id: type,
      label: definition.shortLabel,
      statusLabel,
      tone: resolveChecklistTone(statusLabel),
      detail: uploadedFileTypes.has(type)
        ? "File is present for the selected year."
        : "File is still missing for the selected year.",
      kind: "file",
    };
  });
}

function buildMonitorCurrentIssue(
  selectedYearWorkflowStatus: string | null,
  checklistMissingCount: number,
  latestYearSubmission: IndicatorSubmission | null,
): Pick<MonitorDrawerYearDetail, "currentIssueLabel" | "currentIssueTone"> {
  if (selectedYearWorkflowStatus === "returned") {
    return {
      currentIssueLabel: "Returned items need correction.",
      currentIssueTone: "warning",
    };
  }

  if (selectedYearWorkflowStatus === "submitted") {
    return {
      currentIssueLabel: "Awaiting monitor review.",
      currentIssueTone: "info",
    };
  }

  if (selectedYearWorkflowStatus === "validated") {
    return {
      currentIssueLabel: "Submission validated.",
      currentIssueTone: "success",
    };
  }

  if (checklistMissingCount > 0) {
    return {
      currentIssueLabel: `${checklistMissingCount} checklist item${checklistMissingCount === 1 ? "" : "s"} still missing.`,
      currentIssueTone: "warning",
    };
  }

  if (latestYearSubmission) {
    return {
      currentIssueLabel: "Current year submission progress is available.",
      currentIssueTone: "success",
    };
  }

  return {
    currentIssueLabel: "No submission activity yet for this year.",
    currentIssueTone: "info",
  };
}

export function compareMonitorPackagePriority(left: IndicatorSubmission, right: IndicatorSubmission): number {
  const recencyDelta = toSubmissionActivityTime(right) - toSubmissionActivityTime(left);
  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  const versionDelta = Number(right.version ?? 0) - Number(left.version ?? 0);
  if (versionDelta !== 0) {
    return versionDelta;
  }

  return String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

function resolveSelectedYearMonitorReportSubmission(entries: IndicatorSubmission[]): IndicatorSubmission | null {
  const visibleEntries = entries
    .filter(isMonitorReportSourceSubmission)
    .slice()
    .sort(compareMonitorPackagePriority);

  return visibleEntries[0] ?? null;
}

function buildMonitorSubmittedReportSourceContext(
  submission: IndicatorSubmission | null | undefined,
  selectedReportYearLabel: string,
): string[] {
  const lines = [`Viewing monitor-visible report data for SY ${selectedReportYearLabel}.`];

  if (!submission?.id) {
    lines.push("Source package: None yet.");
    lines.push("Status: Reference only.");
    return lines;
  }

  const packageId = String(submission.id ?? "").trim();
  const statusLabel = String(submission.statusLabel ?? submission.status ?? "").trim() || "Submitted";
  lines.push(`Source package: #${packageId} (${statusLabel}).`);

  if (isFullMonitorReportStatus(submission.status)) {
    const submittedAtLabel = submission.submittedAt
      ? new Date(submission.submittedAt).toLocaleDateString()
      : null;
    if (submittedAtLabel) {
      lines.push(`Submitted: ${submittedAtLabel}.`);
    }
    return lines;
  }

  const sentScopes = submittedScopeIdSet(submission).size;
  lines.push(`Sent workspace items: ${sentScopes.toLocaleString()}.`);
  return lines;
}

export function resolveMonitorSubmissionSchoolYearLabel(submission: IndicatorSubmission | null | undefined): string {
  return (submission?.academicYear?.name ?? "").trim()
    || deriveSchoolYearLabel(submission?.submittedAt ?? submission?.updatedAt ?? submission?.createdAt);
}

export function deriveAvailableMonitorSchoolDetailYears(submissions: IndicatorSubmission[]): string[] {
  void submissions;
  return deriveVisibleMonitorSchoolYearWindow();
}

export interface MonitorSchoolDetailYearSelection {
  availableYears: string[];
  effectiveSelectedYear: string | null;
  selectedYearSubmissions: IndicatorSubmission[];
  sortedSelectedYearSubmissions: IndicatorSubmission[];
  latestYearSubmission: IndicatorSubmission | null;
}

export function resolveMonitorSchoolDetailYearSelection(
  submissions: IndicatorSubmission[],
  selectedSchoolDrawerYear: string | null,
): MonitorSchoolDetailYearSelection {
  const availableYears = deriveAvailableMonitorSchoolDetailYears(submissions);
  const currentYearLabel = deriveSchoolYearLabel(new Date().toISOString());
  const effectiveSelectedYear = selectedSchoolDrawerYear && availableYears.includes(selectedSchoolDrawerYear)
    ? selectedSchoolDrawerYear
    : availableYears.includes(currentYearLabel)
      ? currentYearLabel
    : availableYears[0] ?? null;
  const selectedYearSubmissions = effectiveSelectedYear
    ? submissions.filter((submission) => resolveMonitorSubmissionSchoolYearLabel(submission) === effectiveSelectedYear)
    : [];
  const sortedSelectedYearSubmissions = selectedYearSubmissions.slice().sort(compareMonitorPackagePriority);

  return {
    availableYears,
    effectiveSelectedYear,
    selectedYearSubmissions,
    sortedSelectedYearSubmissions,
    latestYearSubmission: sortedSelectedYearSubmissions[0] ?? null,
  };
}

function buildMonitorPackageRows(
  checklistItems: MonitorDrawerChecklistItem[],
  latestYearSubmission: IndicatorSubmission | null,
  monitorVisibleSubmission: IndicatorSubmission | null = latestYearSubmission,
): MonitorDrawerPackageRow[] {
  const sourceSubmission = monitorVisibleSubmission ?? latestYearSubmission;
  const hasSubmission = Boolean(sourceSubmission);
  const reviewByScope = new Map(
    (sourceSubmission?.scopeReviews ?? []).map((review) => [review.scopeId, review]),
  );
  const reviewableStatus = normalizeWorkflowStatus(sourceSubmission?.status);
  const canReviewFullSubmission = reviewableStatus === "submitted" || reviewableStatus === "returned";
  const sentScopeIds = submittedScopeIdSet(sourceSubmission);

  return checklistItems.map<MonitorDrawerPackageRow>((item) => {
    const submittedAt = sourceSubmission?.submittedAt ?? sourceSubmission?.updatedAt ?? sourceSubmission?.createdAt ?? null;
    const review = reviewByScope.get(item.id) ?? null;
    const reviewDecision = review?.decision === "verified" || review?.decision === "returned" ? review.decision : null;
    const overlayStatusLabel = reviewDecision === "verified"
      ? "Verified"
      : reviewDecision === "returned"
        ? "Returned"
        : null;
    const overlayTone = reviewDecision === "verified"
      ? "success"
      : reviewDecision === "returned"
        ? "warning"
        : null;

    if (item.kind === "file") {
      const fileEntry = sourceSubmission?.files?.[item.id as IndicatorSubmissionFileType] ?? null;
      const hasUploadedFile = Boolean(fileEntry?.uploaded);
      const statusLabel = overlayStatusLabel ?? (hasSubmission ? item.statusLabel : "Not Submitted");
      const fileViewUrl = hasUploadedFile ? (fileEntry?.viewUrl ?? null) : null;
      const fileDownloadUrl = hasUploadedFile ? (fileEntry?.downloadUrl ?? null) : null;

      return {
        id: item.id,
        submissionId: sourceSubmission?.id ?? null,
        label: item.label,
        kind: item.kind,
        statusLabel,
        tone: overlayTone ?? (statusLabel === "Not Submitted" ? "warning" : item.tone),
        submittedAt: hasUploadedFile ? (fileEntry?.uploadedAt ?? submittedAt) : null,
        detail: hasUploadedFile ? (fileEntry?.originalFilename ?? item.detail) : item.detail,
        viewUrl: fileViewUrl,
        downloadUrl: fileDownloadUrl,
        actionLabel: fileViewUrl ? `View ${item.label}` : null,
        actionTarget: null,
        canReview: hasUploadedFile && (canReviewFullSubmission || sentScopeIds.has(normalizeScopeId(item.id))),
        reviewDecision,
        reviewNotes: review?.notes ?? null,
        reviewedAt: review?.reviewedAt ?? null,
      };
    }

    const isComplete = item.statusLabel === "Complete" || item.statusLabel === "For Review" || item.statusLabel === "Returned";
    const statusLabel = overlayStatusLabel ?? (hasSubmission ? item.statusLabel : "Not Submitted");

    return {
      id: item.id,
      submissionId: sourceSubmission?.id ?? null,
      label: item.label,
      kind: item.kind,
      statusLabel,
      tone: overlayTone ?? (statusLabel === "Not Submitted" ? "warning" : item.tone),
      submittedAt: isComplete ? submittedAt : null,
      detail: hasSubmission ? item.detail : "No submitted package exists for the selected year.",
      viewUrl: null,
      downloadUrl: null,
      actionLabel: isComplete ? `View ${item.label}` : null,
      actionTarget: isComplete ? monitorSectionActionTarget(item.id) : null,
      canReview: isComplete && (canReviewFullSubmission || sentScopeIds.has(normalizeScopeId(item.id))),
      reviewDecision,
      reviewNotes: review?.notes ?? null,
      reviewedAt: review?.reviewedAt ?? null,
    };
  });
}

export function buildMonitorDrawerYearDetail(
  schoolDetail: SchoolDetailSnapshot | null,
  selectedSchoolDrawerYear: string | null,
  schoolDrawerSubmissions: IndicatorSubmission[],
  schoolIndicatorRows: IndicatorMatrixRow[],
): MonitorDrawerYearDetail | null {
  if (!schoolDetail) {
    return null;
  }

  const {
    availableYears,
    effectiveSelectedYear,
    sortedSelectedYearSubmissions,
    latestYearSubmission,
  } = resolveMonitorSchoolDetailYearSelection(schoolDrawerSubmissions, selectedSchoolDrawerYear);
  const selectedYearMonitorReportSubmission = resolveSelectedYearMonitorReportSubmission(sortedSelectedYearSubmissions);
  const monitorVisibleYearSubmission = selectedYearMonitorReportSubmission ?? latestYearSubmission;
  const selectedYearWorkflowStatus = normalizeWorkflowStatus(
    monitorVisibleYearSubmission?.status
    ?? sortedSelectedYearSubmissions.find((submission) => isMonitorRelevantPackageStatus(submission.status))?.status
    ?? latestYearSubmission?.status,
  );
  const latestYearSubmittedScopeIds = submittedScopeIdSet(monitorVisibleYearSubmission);
  const currentYearRows = schoolIndicatorRows.filter((row) =>
    Object.prototype.hasOwnProperty.call(row.valuesByYear, effectiveSelectedYear ?? ""),
  );
  const reportRows = currentYearRows.length > 0 ? currentYearRows : schoolIndicatorRows;
  const monitorReportSubmissionRows = submissionRows(selectedYearMonitorReportSubmission);
  const latestYearIndicatorRows = submissionRows(monitorVisibleYearSubmission);
  const canShowSchoolAchievements = isScopeVisibleToMonitor(selectedYearMonitorReportSubmission, SCHOOL_ACHIEVEMENTS_SCOPE_ID);
  const canShowKeyPerformance = isScopeVisibleToMonitor(selectedYearMonitorReportSubmission, KEY_PERFORMANCE_SCOPE_ID);

  const schoolAchievementRows = reportRows
    .filter((row) => row.category === SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL)
    .map<MonitorDrawerSchoolAchievementReportRow>((row) => ({
      key: row.key,
      label: row.label,
      value: canShowSchoolAchievements
        ? resolveIndicatorValue(resolveSubmittedReportIndicatorByMetricCode(monitorReportSubmissionRows, row.code), "actual", effectiveSelectedYear)
        : "-",
    }));

  const kpiRows = reportRows
    .filter((row) => row.category === KEY_PERFORMANCE_CATEGORY_LABEL)
    .map<MonitorDrawerKpiReportRow>((row) => {
      const indicator = canShowKeyPerformance
        ? resolveSubmittedReportIndicatorByMetricCode(monitorReportSubmissionRows, row.code)
        : null;
      return {
        key: row.key,
        label: row.label,
        target: indicator ? resolveIndicatorValue(indicator, "target", effectiveSelectedYear) : "-",
        actual: indicator ? resolveIndicatorValue(indicator, "actual", effectiveSelectedYear) : "-",
        status: String(indicator?.complianceStatus ?? "-").trim() || "-",
      };
    });

  const checklistItems = [
    ...buildMonitorChecklistSectionItems(currentYearRows, latestYearIndicatorRows, selectedYearWorkflowStatus, effectiveSelectedYear, latestYearSubmittedScopeIds),
    ...buildMonitorChecklistFileItems(schoolDetail.schoolTypeRaw, monitorVisibleYearSubmission, selectedYearWorkflowStatus, latestYearSubmittedScopeIds),
  ];
  const checklistCompleteCount = checklistItems.filter(
    (item) => item.statusLabel === "Complete" || item.statusLabel === "Uploaded",
  ).length;
  const checklistMissingCount = checklistItems.length - checklistCompleteCount;
  const packageRows = buildMonitorPackageRows(checklistItems, latestYearSubmission, monitorVisibleYearSubmission);
  const currentIssue = buildMonitorCurrentIssue(
    selectedYearWorkflowStatus,
    checklistMissingCount,
    latestYearSubmission,
  );

  return {
    selectedYearLabel: effectiveSelectedYear,
    availableYears: availableYears.map<MonitorDrawerYearOption>((year) => ({ id: year, label: year })),
    ...currentIssue,
    checklistItems,
    packageRows,
    checklistCompleteCount,
    checklistMissingCount,
    selectedYearLatestSubmissionId: latestYearSubmission?.id ?? null,
    selectedYearLatestStatus: selectedYearMonitorReportSubmission && !isFullMonitorReportStatus(selectedYearMonitorReportSubmission.status)
      ? "submitted"
      : latestYearSubmission?.status ?? null,
    finalizedReportSubmission: selectedYearMonitorReportSubmission,
    reportSourceContext: buildMonitorSubmittedReportSourceContext(
      selectedYearMonitorReportSubmission,
      effectiveSelectedYear ?? "N/A",
    ),
    reportBlankStateLines: buildSubmittedReportBlankStateLines(),
    schoolAchievementRows,
    kpiRows,
  };
}
