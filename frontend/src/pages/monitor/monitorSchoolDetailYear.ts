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
  buildSubmittedReportSourceContext,
  resolveIndicatorValue,
  resolveSelectedYearReportSubmission,
  resolveSubmittedReportIndicatorByMetricCode,
  submissionRows,
} from "@/pages/schoolAdminSubmittedReportView";
import { getSubmissionUploadedFileTypes, resolveSubmissionRequirementProfile } from "@/utils/submissionRequirements";
import type { IndicatorSubmission, IndicatorSubmissionFileType } from "@/types";

const BASE_SCHOOL_YEAR_START = 2025;
const SCHOOL_YEAR_WINDOW_SIZE = 5;

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
  return normalizedStatus === "submitted" || normalizedStatus === "validated" || normalizedStatus === "returned";
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
): MonitorDrawerChecklistItem[] {
  const sectionDefinitions = [
    { id: "school_achievements_learning_outcomes", label: "School Achievements", category: SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL },
    { id: "key_performance_indicators", label: "Key Performance", category: KEY_PERFORMANCE_CATEGORY_LABEL },
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
    if (isComplete && selectedYearWorkflowStatus === "returned") {
      statusLabel = "Returned";
    } else if (isComplete && selectedYearWorkflowStatus === "submitted") {
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
): MonitorDrawerChecklistItem[] {
  const requirementProfile = resolveSubmissionRequirementProfile(schoolTypeRaw);
  const uploadedFileTypes = new Set(getSubmissionUploadedFileTypes(latestYearSubmission));

  return requirementProfile.requiredFileTypes.map<MonitorDrawerChecklistItem>((type) => {
    const definition = SUBMISSION_FILE_DEFINITION_BY_TYPE[type];
    let statusLabel: MonitorDrawerChecklistItem["statusLabel"] = uploadedFileTypes.has(type) ? "Uploaded" : "Missing";
    if (uploadedFileTypes.has(type) && selectedYearWorkflowStatus === "returned") {
      statusLabel = "Returned";
    } else if (uploadedFileTypes.has(type) && selectedYearWorkflowStatus === "submitted") {
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
): MonitorDrawerPackageRow[] {
  const hasSubmission = Boolean(latestYearSubmission);
  const reviewByScope = new Map(
    (latestYearSubmission?.scopeReviews ?? []).map((review) => [review.scopeId, review]),
  );
  const reviewableStatus = normalizeWorkflowStatus(latestYearSubmission?.status);
  const canReviewSubmission = reviewableStatus === "submitted" || reviewableStatus === "returned";

  return checklistItems.map<MonitorDrawerPackageRow>((item) => {
    const submittedAt = latestYearSubmission?.submittedAt ?? latestYearSubmission?.updatedAt ?? latestYearSubmission?.createdAt ?? null;
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
      const fileEntry = latestYearSubmission?.files?.[item.id as IndicatorSubmissionFileType] ?? null;
      const hasUploadedFile = Boolean(fileEntry?.uploaded);
      const statusLabel = overlayStatusLabel ?? (hasSubmission ? item.statusLabel : "Not Submitted");
      const fileViewUrl = hasUploadedFile ? (fileEntry?.viewUrl ?? null) : null;
      const fileDownloadUrl = hasUploadedFile ? (fileEntry?.downloadUrl ?? null) : null;

      return {
        id: item.id,
        submissionId: latestYearSubmission?.id ?? null,
        label: item.label,
        kind: item.kind,
        statusLabel,
        tone: overlayTone ?? (statusLabel === "Not Submitted" ? "warning" : item.tone),
        submittedAt: hasUploadedFile ? (fileEntry?.uploadedAt ?? submittedAt) : null,
        detail: hasUploadedFile ? (fileEntry?.originalFilename ?? item.detail) : item.detail,
        viewUrl: fileViewUrl,
        downloadUrl: fileDownloadUrl,
        actionLabel: fileViewUrl ? `View ${item.label}` : null,
        canReview: canReviewSubmission && hasUploadedFile,
        reviewDecision,
        reviewNotes: review?.notes ?? null,
        reviewedAt: review?.reviewedAt ?? null,
      };
    }

    const isComplete = item.statusLabel === "Complete" || item.statusLabel === "For Review" || item.statusLabel === "Returned";
    const statusLabel = overlayStatusLabel ?? (hasSubmission ? item.statusLabel : "Not Submitted");

    return {
      id: item.id,
      submissionId: latestYearSubmission?.id ?? null,
      label: item.label,
      kind: item.kind,
      statusLabel,
      tone: overlayTone ?? (statusLabel === "Not Submitted" ? "warning" : item.tone),
      submittedAt: isComplete ? submittedAt : null,
      detail: hasSubmission ? item.detail : "No submitted package exists for the selected year.",
      viewUrl: null,
      downloadUrl: null,
      actionLabel: null,
      canReview: canReviewSubmission && isComplete,
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
  const selectedYearFinalizedSubmission = resolveSelectedYearReportSubmission(sortedSelectedYearSubmissions);
  const selectedYearWorkflowStatus = normalizeWorkflowStatus(
    sortedSelectedYearSubmissions.find((submission) => isMonitorRelevantPackageStatus(submission.status))?.status
    ?? latestYearSubmission?.status,
  );
  const currentYearRows = schoolIndicatorRows.filter((row) =>
    Object.prototype.hasOwnProperty.call(row.valuesByYear, effectiveSelectedYear ?? ""),
  );
  const reportRows = currentYearRows.length > 0 ? currentYearRows : schoolIndicatorRows;
  const finalizedSubmissionRows = submissionRows(selectedYearFinalizedSubmission);
  const latestYearIndicatorRows = submissionRows(latestYearSubmission);

  const schoolAchievementRows = reportRows
    .filter((row) => row.category === SCHOOL_ACHIEVEMENTS_CATEGORY_LABEL)
    .map<MonitorDrawerSchoolAchievementReportRow>((row) => ({
      key: row.key,
      label: row.label,
      value: selectedYearFinalizedSubmission
        ? resolveIndicatorValue(resolveSubmittedReportIndicatorByMetricCode(finalizedSubmissionRows, row.code), "actual", effectiveSelectedYear)
        : "-",
    }));

  const kpiRows = reportRows
    .filter((row) => row.category === KEY_PERFORMANCE_CATEGORY_LABEL)
    .map<MonitorDrawerKpiReportRow>((row) => {
      const indicator = resolveSubmittedReportIndicatorByMetricCode(finalizedSubmissionRows, row.code);
      return {
        key: row.key,
        label: row.label,
        target: indicator ? resolveIndicatorValue(indicator, "target", effectiveSelectedYear) : "-",
        actual: indicator ? resolveIndicatorValue(indicator, "actual", effectiveSelectedYear) : "-",
        status: String(indicator?.complianceStatus ?? "-").trim() || "-",
      };
    });

  const checklistItems = [
    ...buildMonitorChecklistSectionItems(currentYearRows, latestYearIndicatorRows, selectedYearWorkflowStatus, effectiveSelectedYear),
    ...buildMonitorChecklistFileItems(schoolDetail.schoolTypeRaw, latestYearSubmission, selectedYearWorkflowStatus),
  ];
  const checklistCompleteCount = checklistItems.filter(
    (item) => item.statusLabel === "Complete" || item.statusLabel === "Uploaded",
  ).length;
  const checklistMissingCount = checklistItems.length - checklistCompleteCount;
  const packageRows = buildMonitorPackageRows(checklistItems, latestYearSubmission);
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
    selectedYearLatestStatus: latestYearSubmission?.status ?? null,
    finalizedReportSubmission: selectedYearFinalizedSubmission,
    reportSourceContext: buildSubmittedReportSourceContext(
      selectedYearFinalizedSubmission,
      effectiveSelectedYear ?? "N/A",
    ),
    reportBlankStateLines: buildSubmittedReportBlankStateLines(),
    schoolAchievementRows,
    kpiRows,
  };
}
