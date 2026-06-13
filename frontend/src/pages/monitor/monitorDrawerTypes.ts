import type { IndicatorSubmission } from "@/types";

export interface SchoolDetailSnapshot {
  schoolKey: string;
  schoolCode: string;
  schoolName: string;
  region: string;
  level: string;
  type: string;
  schoolTypeRaw: string | null;
  requirementModeLabel: string;
  activePackageLabel: string;
  address: string;
  hasComplianceRecord: boolean;
  indicatorStatus: string | null;
  hasActivePackageSubmission: boolean;
  missingCount: number;
  awaitingReviewCount: number;
  lastActivityAt: string | null;
  reportedStudents: number;
  reportedTeachers: number;
  synchronizedStudents: number;
  synchronizedTeachers: number;
}

export interface MonitorDrawerYearOption {
  id: string;
  label: string;
}

export interface MonitorDrawerChecklistItem {
  id: string;
  label: string;
  statusLabel: "Complete" | "Missing" | "Uploaded" | "Returned" | "For Review";
  tone: "success" | "warning" | "info";
  detail: string;
  kind: "section" | "file";
}

export interface MonitorDrawerPackageRow {
  id: string;
  submissionId?: string | null;
  label: string;
  kind: "section" | "file";
  statusLabel: MonitorDrawerChecklistItem["statusLabel"] | "Not Submitted" | "Verified";
  tone: "success" | "warning" | "info";
  submittedAt: string | null;
  detail: string;
  viewUrl: string | null;
  downloadUrl: string | null;
  actionLabel: string | null;
  actionTarget?: "school_achievements" | "key_performance" | null;
  canReview?: boolean;
  reviewDecision?: "verified" | "returned" | null;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
}

export interface MonitorDrawerSchoolAchievementReportRow {
  key: string;
  label: string;
  value: string;
}

export interface MonitorDrawerKpiReportRow {
  key: string;
  label: string;
  target: string;
  actual: string;
  status: string;
}

export interface MonitorDrawerYearDetail {
  selectedYearLabel: string | null;
  availableYears: MonitorDrawerYearOption[];
  currentIssueLabel: string;
  currentIssueTone: "warning" | "info" | "success";
  checklistItems: MonitorDrawerChecklistItem[];
  packageRows: MonitorDrawerPackageRow[];
  checklistCompleteCount: number;
  checklistMissingCount: number;
  selectedYearLatestSubmissionId: string | null;
  selectedYearLatestStatus: string | null;
  finalizedReportSubmission: IndicatorSubmission | null;
  reportSourceContext: string[];
  reportBlankStateLines: [string, string];
  schoolAchievementRows: MonitorDrawerSchoolAchievementReportRow[];
  kpiRows: MonitorDrawerKpiReportRow[];
}

export interface MonitorDrawerHistorySummary {
  historyPackageCount: number;
  historySchoolYearCount: number;
  latestHistoryPackageId: string | null;
  latestHistorySchoolYear: string | null;
  latestRenderableSubmissionId: string | null;
  latestRenderableSchoolYear: string | null;
  packagesWithRenderableRowsCount: number;
  packagesWithoutRenderableRowsCount: number;
  historyAvailabilityLabel: string;
  historyExplanation: string;
  historyFallbackReason: string | null;
}

export interface IndicatorMatrixRowCell {
  target: string;
  actual: string;
}

export interface IndicatorMatrixRow {
  key: string;
  code: string;
  label: string;
  category: string;
  sortOrder: number;
  valuesByYear: Record<string, IndicatorMatrixRowCell>;
}

export interface SchoolIndicatorPackageRow {
  id: string;
  schoolYear: string;
  reportingPeriod: string;
  status: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
  complianceRatePercent: number | null;
  reviewedBy: string;
}

export interface SchoolDrawerCriticalAlert {
  id: string;
  tone: "warning" | "info";
  title: string;
  detail: string;
}

export interface SchoolIndicatorMatrix {
  years: string[];
  rows: IndicatorMatrixRow[];
  latestSubmission: IndicatorSubmission | null;
}

export interface SchoolIndicatorRowGroup {
  category: string;
  rows: IndicatorMatrixRow[];
}
