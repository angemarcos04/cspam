import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CircleHelp,
  ClipboardList,
  Database,
  Download,
  Eye,
  LayoutDashboard,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SUBMISSION_FILE_DEFINITION_BY_TYPE, type SubmissionFileTabDefinition } from "@/constants/submissionFiles";
import { DashboardHelpDialog } from "@/components/DashboardHelpDialog";
import { Shell } from "@/components/Shell";
import { SchoolIndicatorPanel } from "@/components/indicators/SchoolIndicatorPanel";
import { useAuth } from "@/context/Auth";
import { useData } from "@/context/Data";
import { useIndicatorData } from "@/context/IndicatorData";
import { COOKIE_SESSION_TOKEN, getApiBaseUrl } from "@/lib/api";
import { isEditableKeyboardTarget, isRefreshShortcut } from "@/lib/keyboardShortcuts";
import { runRefreshBatches } from "@/lib/runRefreshBatches";
import { AuditTrailPanel } from "@/pages/monitor/MonitorAuditTrail";
import {
  buildSchoolHeadCurrentReportBlankStateLines,
  buildSchoolHeadCurrentReportSourceContext,
  buildTargetsMetReportViewRowsForSubmission,
  compareSelectedYearSchoolHeadCurrentReportSubmissions,
  compareSelectedYearFinalizedReportSubmissions,
  isFinalizedSubmissionStatus,
  resolveIndicatorSelectedYearRawValue,
  resolvePreferredSchoolHeadCurrentReportAcademicYearId,
  resolveSelectedYearReportSubmission,
  resolveSelectedYearSchoolHeadCurrentReportSubmission,
  resolveSchoolHeadReportSourceMode,
  schoolHeadCurrentReportRecencyScore,
  resolveStableSchoolHeadCurrentReportViewSubmission,
  resolveSchoolHeadCurrentReportSubmissionForView,
  submissionFilesHaveRenderableReportDetails,
  submissionHasRenderableIndicatorDetails,
  submissionHasRenderableReportDetails,
  submissionRows,
} from "@/pages/schoolAdminSubmittedReportView";
import {
  getActiveReportVisibleFiles,
  getActiveReportFileTypes,
  getSecondaryHistoricalVisibleFiles,
  getSecondaryHistoricalFileTypes,
  resolveSecondarySubmittedReportFileDefinitions,
  resolveSubmissionSchoolId,
  resolveSubmissionPresentationSchoolType,
  resolveSubmittedReportVisibleFileDefinitions,
} from "@/utils/submissionRequirements";
import type {
  IndicatorSubmission,
  IndicatorSubmissionFileEntry,
  IndicatorSubmissionFileType,
  IndicatorSubmissionItem,
  SchoolRecord,
  SessionUser,
} from "@/types";

export const DASHBOARD_VIEW_YEAR_STORAGE_KEY_PREFIX = "cspams:school-admin-dashboard:view-year";
const DASHBOARD_VIEW_YEAR_MANUAL_STORAGE_KEY_SUFFIX = ":manual";

export function buildSchoolAdminRefreshBatches(
  refreshRecords: () => Promise<unknown>,
  refreshSubmissions: () => Promise<unknown>,
  refreshAllSubmissions: () => Promise<unknown>,
) {
  return [[refreshRecords, refreshSubmissions], [refreshAllSubmissions]];
}

/* ── Quick-jump targets ── */
/* ── Helpers ── */
function latestSubmission<T extends { updatedAt: string | null; createdAt: string | null }>(entries: T[]): T | null {
  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => {
    const aDate = new Date((a as { submittedAt?: string | null }).submittedAt ?? a.updatedAt ?? a.createdAt ?? 0).getTime();
    const bDate = new Date((b as { submittedAt?: string | null }).submittedAt ?? b.updatedAt ?? b.createdAt ?? 0).getTime();
    return bDate - aDate;
  });
  return sorted[0] ?? null;
}

export function buildDashboardViewYearStorageKey(
  userId: number | string | null | undefined,
  schoolId: string,
): string {
  const normalizedUserId = String(userId ?? "").trim();
  const normalizedSchoolId = String(schoolId ?? "").trim();
  if (!normalizedUserId || !normalizedSchoolId) {
    return "";
  }

  return `${DASHBOARD_VIEW_YEAR_STORAGE_KEY_PREFIX}:${normalizedUserId}:${normalizedSchoolId}`;
}

export function buildDashboardViewYearManualStorageKey(
  userId: number | string | null | undefined,
  schoolId: string,
): string {
  const baseKey = buildDashboardViewYearStorageKey(userId, schoolId);
  return baseKey ? `${baseKey}${DASHBOARD_VIEW_YEAR_MANUAL_STORAGE_KEY_SUFFIX}` : "";
}

export function resolveInitialSubmittedReportAcademicYearId(
  years: Array<{ id: string; isCurrent?: boolean }>,
  storedAcademicYearId: string | null | undefined,
): string {
  const normalizedStoredAcademicYearId = String(storedAcademicYearId ?? "").trim();
  if (normalizedStoredAcademicYearId && years.some((year) => year.id === normalizedStoredAcademicYearId)) {
    return normalizedStoredAcademicYearId;
  }

  return years.find((year) => year.isCurrent)?.id ?? years[0]?.id ?? "";
}

export function resolveInitialSchoolHeadReportAcademicYearId(
  years: Array<{ id: string; isCurrent?: boolean }>,
  storedAcademicYearId: string | null | undefined,
  preferredSavedAcademicYearId: string | null | undefined,
  _hasManualStoredSelection: boolean,
): string {
  const normalizedStoredAcademicYearId = String(storedAcademicYearId ?? "").trim();
  const normalizedPreferredSavedAcademicYearId = String(preferredSavedAcademicYearId ?? "").trim();
  if (
    normalizedPreferredSavedAcademicYearId
    && years.some((year) => year.id === normalizedPreferredSavedAcademicYearId)
  ) {
    return normalizedPreferredSavedAcademicYearId;
  }

  if (normalizedStoredAcademicYearId && years.some((year) => year.id === normalizedStoredAcademicYearId)) {
    return normalizedStoredAcademicYearId;
  }

  return resolveInitialSubmittedReportAcademicYearId(years, "");
}

export function resolveSchoolAdminHeaderContext(
  assignedRecord: Pick<SchoolRecord, "schoolName" | "schoolCode" | "address"> | null,
  user: Pick<SessionUser, "schoolName" | "schoolCode" | "schoolAddress"> | null,
): {
  schoolName: string;
  schoolCode: string;
  schoolAddress: string;
} {
  return {
    schoolName: assignedRecord?.schoolName || user?.schoolName || "Unassigned School",
    schoolCode: assignedRecord?.schoolCode || user?.schoolCode || "N/A",
    schoolAddress: assignedRecord?.address || user?.schoolAddress || "N/A",
  };
}

function normalizeFileExtension(filename: string | null | undefined): string {
  const value = String(filename ?? "").trim().toLowerCase();
  if (!value.includes(".")) return "";
  return value.slice(value.lastIndexOf(".") + 1);
}

function normalizeMetricLookupKey(label: string | null | undefined): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterFinalizedDashboardSubmissions(entries: IndicatorSubmission[]): IndicatorSubmission[] {
  return entries.filter((entry) => isFinalizedSubmissionStatus(entry.status));
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : "-";
  }

  return String(value);
}

export function formatComplianceStatusLabel(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "met") return "Met";
    if (normalized === "below_target") return "Not met";
    if (normalized === "recorded") return "Recorded";
  }

  return formatDisplayValue(value);
}

function selectedYearValueIsPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  return typeof value === "string" ? value.trim().length > 0 : true;
}

function selectedYearComparableNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[%,$]/g, "").trim();
  if (normalized.length === 0) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatKpiComplianceStatusForSelectedYear(
  indicator: IndicatorSubmissionItem | null | undefined,
  selectedYear: string | null | undefined,
): string {
  if (!indicator) {
    return "-";
  }

  const target = resolveIndicatorSelectedYearRawValue(indicator, "target", selectedYear);
  const actual = resolveIndicatorSelectedYearRawValue(indicator, "actual", selectedYear);
  if (!selectedYearValueIsPresent(target) || !selectedYearValueIsPresent(actual)) {
    return "-";
  }

  const comparison = String(indicator.metric?.inputSchema?.comparison ?? "greater_or_equal").trim().toLowerCase();
  const targetNumber = selectedYearComparableNumber(target);
  const actualNumber = selectedYearComparableNumber(actual);

  if (comparison === "equal") {
    const isMet = targetNumber !== null && actualNumber !== null
      ? actualNumber === targetNumber
      : String(actual).trim().toLowerCase() === String(target).trim().toLowerCase();
    return isMet ? "Met" : "Not met";
  }

  if (targetNumber === null || actualNumber === null) {
    return "Not met";
  }

  const isMet = comparison === "less_or_equal"
    ? actualNumber <= targetNumber
    : actualNumber >= targetNumber;

  return isMet ? "Met" : "Not met";
}

function isCountableComplianceStatus(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "met" || normalized === "below_target" || normalized === "recorded";
}

function buildSubmissionRefreshFingerprint(submission: IndicatorSubmission | null | undefined): string {
  if (!submission?.id) {
    return "";
  }

  return [
    submission.id,
    submission.status ?? "",
    submission.version ?? "",
    submission.updatedAt ?? "",
    submission.submittedAt ?? "",
  ].join(":");
}

function selectedYearLabel(
  yearId: string,
  years: Array<{ id: string; name: string }>,
  fallback: string,
): string {
  if (!yearId || yearId === "all") {
    return fallback;
  }

  return years.find((year) => year.id === yearId)?.name ?? fallback;
}

function academicYearStartValue(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (!match) {
    return null;
  }

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end !== start + 1) {
    return null;
  }

  return start;
}

function compareAcademicYearsAscending(a: { name: string }, b: { name: string }): number {
  const aStart = academicYearStartValue(a.name);
  const bStart = academicYearStartValue(b.name);

  if (aStart !== null && bStart !== null) {
    return aStart - bStart;
  }
  if (aStart !== null) {
    return -1;
  }
  if (bStart !== null) {
    return 1;
  }

  return String(a.name).localeCompare(String(b.name));
}

function buildSelectedYearLoadKey(schoolId: string, academicYearId: string, syncMarker: string | null | undefined = ""): string {
  return `${schoolId}:${academicYearId}:${String(syncMarker ?? "").trim()}`;
}

function mergeCurrentReportCandidateDetails(
  preferred: IndicatorSubmission,
  alternate: IndicatorSubmission,
): IndicatorSubmission {
  if (String(preferred.id ?? "").trim() !== String(alternate.id ?? "").trim()) {
    return preferred;
  }

  const preferredHasRows = submissionHasRenderableIndicatorDetails(preferred);
  const alternateHasRows = submissionHasRenderableIndicatorDetails(alternate);
  const preferredHasFiles = submissionFilesHaveRenderableReportDetails(preferred.files);
  const alternateHasFiles = submissionFilesHaveRenderableReportDetails(alternate.files);
  const preferredScore = schoolHeadCurrentReportRecencyScore(preferred);
  const alternateScore = schoolHeadCurrentReportRecencyScore(alternate);

  const rowsSource = preferredHasRows || !alternateHasRows ? preferred : alternate;
  const filesSource = preferredHasFiles || !alternateHasFiles ? preferred : alternate;

  return {
    ...preferred,
    indicators: rowsSource.indicators,
    items: Array.isArray(rowsSource.items) && rowsSource.items.length > 0
      ? rowsSource.items
      : rowsSource.indicators,
    files: filesSource.files ?? preferred.files,
    completion: filesSource.completion ?? preferred.completion,
    presentation: filesSource.presentation ?? preferred.presentation,
  };
}

function preferFresherCurrentReportCandidate(
  existing: IndicatorSubmission,
  incoming: IndicatorSubmission,
): IndicatorSubmission {
  const isSameSubmissionId = String(existing.id ?? "").trim() === String(incoming.id ?? "").trim();
  const existingScore = schoolHeadCurrentReportRecencyScore(existing);
  const incomingScore = schoolHeadCurrentReportRecencyScore(incoming);

  if (incomingScore > existingScore) {
    return mergeCurrentReportCandidateDetails(incoming, existing);
  }

  if (existingScore > incomingScore) {
    return mergeCurrentReportCandidateDetails(existing, incoming);
  }

  const existingHasDetails = submissionHasRenderableReportDetails(existing);
  const incomingHasDetails = submissionHasRenderableReportDetails(incoming);

  if (incomingHasDetails && !existingHasDetails) {
    return incoming;
  }

  if (existingHasDetails && !incomingHasDetails) {
    return existing;
  }

  if (isSameSubmissionId) {
    return incoming;
  }

  return compareSelectedYearSchoolHeadCurrentReportSubmissions(existing, incoming) <= 0
    ? existing
    : incoming;
}

function isSameSubmission(
  left: IndicatorSubmission | null | undefined,
  right: IndicatorSubmission | null | undefined,
): boolean {
  const leftId = String(left?.id ?? "").trim();
  const rightId = String(right?.id ?? "").trim();
  return leftId !== "" && leftId === rightId;
}

function buildDashboardReportSourceContextKey(
  userId: number | string | null | undefined,
  schoolId: string | null | undefined,
  academicYearId: string | null | undefined,
  submissionId: string | number | null | undefined,
): string {
  return [
    String(userId ?? "").trim(),
    String(schoolId ?? "").trim(),
    String(academicYearId ?? "").trim(),
    String(submissionId ?? "").trim(),
  ].join(":");
}

function buildDashboardReportSource(
  submission: IndicatorSubmission,
  quality: DashboardReportSourceQuality,
  options: {
    userId: number | string | null | undefined;
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): DashboardReportSource {
  const submissionAcademicYearId = String(submission.academicYear?.id ?? options.selectedAcademicYearId ?? "").trim();
  return {
    contextKey: buildDashboardReportSourceContextKey(
      options.userId,
      options.selectedSchoolId,
      submissionAcademicYearId,
      submission.id,
    ),
    quality,
    submission,
  };
}

function resolveDashboardReportSourceForView(
  source: DashboardReportSource | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): DashboardReportSource | null {
  if (!source) {
    return null;
  }

  const submission = resolveSchoolHeadCurrentReportSubmissionForView(source.submission, options);
  return submission ? { ...source, submission } : null;
}

function mergeSubmissionIntoDashboardViewRows(
  current: IndicatorSubmission[],
  submission: IndicatorSubmission,
  source: DashboardReportSourceQuality,
): IndicatorSubmission[] {
  const submissionId = String(submission.id ?? "").trim();
  const existing = current.find((entry) => String(entry.id ?? "").trim() === submissionId);
  const nextSubmission = existing
    ? (
      source === "hydrated"
        ? mergeCurrentReportCandidateDetails(submission, existing)
        : preferFresherCurrentReportCandidate(existing, submission)
    )
    : submission;

  return [
    ...current.filter((entry) => String(entry.id ?? "").trim() !== submissionId),
    nextSubmission,
  ].sort(compareSelectedYearSchoolHeadCurrentReportSubmissions);
}

function isHydratedReportSourceFreshForSelectedSource(
  selectedSubmission: IndicatorSubmission | null | undefined,
  hydratedSubmission: IndicatorSubmission | null | undefined,
): boolean {
  if (!selectedSubmission || !hydratedSubmission || !isSameSubmission(selectedSubmission, hydratedSubmission)) {
    return false;
  }

  return schoolHeadCurrentReportRecencyScore(hydratedSubmission) >= schoolHeadCurrentReportRecencyScore(selectedSubmission);
}

export function resolveHydratedCurrentReportSubmissionCandidate(
  currentHydratedSubmission: IndicatorSubmission | null | undefined,
  incomingSubmission: IndicatorSubmission | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): IndicatorSubmission | null {
  const eligibleCurrentSubmission = resolveSchoolHeadCurrentReportSubmissionForView(currentHydratedSubmission, options);
  const eligibleIncomingSubmission = resolveSchoolHeadCurrentReportSubmissionForView(incomingSubmission, options);

  if (!eligibleIncomingSubmission) {
    return eligibleCurrentSubmission;
  }

  if (!eligibleCurrentSubmission) {
    return eligibleIncomingSubmission;
  }

  return preferFresherCurrentReportCandidate(eligibleCurrentSubmission, eligibleIncomingSubmission);
}

function resolveTrustedHydratedReportSource(
  selectedSubmission: IndicatorSubmission | null | undefined,
  hydratedSubmission: IndicatorSubmission | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): IndicatorSubmission | null {
  const eligibleSelectedSubmission = resolveSchoolHeadCurrentReportSubmissionForView(selectedSubmission, options);
  const eligibleHydratedSubmission = resolveSchoolHeadCurrentReportSubmissionForView(hydratedSubmission, options);

  if (!eligibleHydratedSubmission) {
    return null;
  }

  if (!eligibleSelectedSubmission) {
    return eligibleHydratedSubmission;
  }

  return isHydratedReportSourceFreshForSelectedSource(eligibleSelectedSubmission, eligibleHydratedSubmission)
    ? eligibleHydratedSubmission
    : null;
}

export function resolveSelectedYearCurrentReportContextSubmissions(
  dashboardViewSubmissions: IndicatorSubmission[],
  schoolScopedSubmissions: IndicatorSubmission[],
  academicYearId: string,
): IndicatorSubmission[] {
  if (!academicYearId) {
    return [];
  }

  if (academicYearId === "all") {
    return schoolScopedSubmissions;
  }

  const sameYearScopedSubmissions = schoolScopedSubmissions.filter(
    (submission) => String(submission.academicYear?.id ?? "").trim() === academicYearId,
  );

  if (sameYearScopedSubmissions.length === 0) {
    return dashboardViewSubmissions;
  }

  const mergedById = new Map<string, IndicatorSubmission>();

  for (const submission of [...dashboardViewSubmissions, ...sameYearScopedSubmissions]) {
    const submissionId = String(submission.id ?? "").trim();
    if (!submissionId) {
      continue;
    }

    const existing = mergedById.get(submissionId);
    mergedById.set(
      submissionId,
      existing ? preferFresherCurrentReportCandidate(existing, submission) : submission,
    );
  }

  return Array.from(mergedById.values()).sort(compareSelectedYearSchoolHeadCurrentReportSubmissions);
}

const MOBILE_BREAKPOINT = 768;
const REPORT_DETAIL_HYDRATION_MAX_ATTEMPTS = 3;
const REPORT_DETAIL_HYDRATION_RETRY_DELAY_MS = 50;

type ReportHydrationStatus = "idle" | "loading" | "retrying" | "ready" | "failed";
type DashboardReportSourceQuality = "optimistic" | "hydrated";

type DashboardReportSource = {
  contextKey: string;
  quality: DashboardReportSourceQuality;
  submission: IndicatorSubmission;
};

const SCHOOL_ACHIEVEMENT_ROWS = [
  { key: "school_head_name", label: "NAME OF SCHOOL HEAD" },
  { key: "total_enrolment", label: "TOTAL NUMBER OF ENROLMENT" },
  { key: "sbm_level_of_practice", label: "SBM LEVEL OF PRACTICE" },
  { key: "classroom_ratio_kindergarten", label: "Pupil/Student Classroom Ratio (Kindergarten)" },
  { key: "classroom_ratio_grades_1_3", label: "Pupil/Student Classroom Ratio (Grades 1 to 3)" },
  { key: "classroom_ratio_grades_4_6", label: "Pupil/Student Classroom Ratio (Grades 4 to 6)" },
  { key: "classroom_ratio_grades_7_10", label: "Pupil/Student Classroom Ratio (Grades 7 to 10)" },
  { key: "classroom_ratio_grades_11_12", label: "Pupil/Student Classroom Ratio (Grades 11 to 12)" },
  { key: "water_sanitation_ratio", label: "Water and Sanitation facility to pupil ratio" },
  { key: "comfort_rooms", label: "Number of Comfort rooms" },
  { key: "comfort_rooms_toilet_bowl", label: "a. Toilet bowl" },
  { key: "comfort_rooms_urinal", label: "b. Urinal" },
  { key: "handwashing_facilities", label: "Handwashing Facilities" },
  { key: "learning_material_ratio", label: "Ideal learning materials to learner ratio" },
  { key: "seat_ratio_overall", label: "Pupil/student seat ratio (Overall)" },
  { key: "seat_ratio_kindergarten", label: "a. Kindergarten" },
  { key: "seat_ratio_grades_1_6", label: "b. Grades 1 - 6" },
  { key: "seat_ratio_grades_7_10", label: "c. Grades 7 - 10" },
  { key: "seat_ratio_grades_11_12", label: "d. Grades 11 - 12" },
  { key: "ict_package_ratio", label: "ICT Package/E-classroom package to sections ratio" },
  { key: "ict_laboratory", label: "a. ICT Laboratory" },
  { key: "science_laboratory", label: "Science Laboratory" },
  { key: "internet_access", label: "Do you have internet access? (Y/N)" },
  { key: "electricity_access", label: "Do you have electricity (Y/N)" },
  { key: "complete_fence_gate", label: "Do you have a complete fence/gate? (Evident/Partially/Not Evident)" },
  { key: "teachers_total", label: "No. of Teachers" },
  { key: "teachers_male", label: "a. Male" },
  { key: "teachers_female", label: "b. Female" },
  { key: "teachers_with_disability", label: "Teachers with Physical Disability" },
  { key: "teachers_with_disability_male", label: "a. Male" },
  { key: "teachers_with_disability_female", label: "b. Female" },
  { key: "functional_sgc", label: "Functional SGC" },
  { key: "feeding_program_beneficiaries", label: "School-Based Feeding Program Beneficiaries" },
  { key: "canteen_income", label: "School-Managed Canteen (Annual income)" },
  { key: "teachers_coop_canteen_income", label: "Teachers Cooperative Managed Canteen - if there is (Annual income)" },
  { key: "security_safety_plan", label: "Security and Safety (Contingency Plan)" },
  { key: "security_safety_earthquake", label: "a. Earthquake" },
  { key: "security_safety_typhoon", label: "b. Typhoon" },
  { key: "security_safety_covid", label: "c. COVID-19" },
  { key: "security_safety_power_interruption", label: "d. Power interruption" },
  { key: "security_safety_in_person", label: "e. In-person classes" },
  { key: "teachers_trained_pfa", label: "No. of Teachers trained on Psychological First Aid (PFA)" },
  { key: "teachers_trained_occ_first_aid", label: "No. of Teachers trained on Occupational First Aid" },
] as const;

const KPI_ROWS = [
  { key: "net_enrollment_rate", label: "Net Enrollment Rate (NER)" },
  { key: "retention_rate", label: "Retention Rate (RR)" },
  { key: "dropout_rate", label: "Drop-out Rate (DR)" },
  { key: "transition_rate", label: "Transition Rate (TR)" },
  { key: "net_intake_rate", label: "Net Intake Rate (NIR)" },
  { key: "participation_rate", label: "Participation Rate (PR)" },
  { key: "als_completion_rate", label: "ALS Completion Rate" },
  { key: "gender_parity_index", label: "Gender Parity Index (GPI)" },
  { key: "interquartile_ratio", label: "Interquartile Ratio (IQR)" },
  { key: "completion_rate", label: "Completion Rate (CR)" },
  { key: "cohort_survival_rate", label: "Cohort Survival Rate (CSR)" },
  { key: "learning_mastery_nearly_proficient", label: "Learning Mastery: Nearly Proficient" },
  { key: "learning_mastery_proficient", label: "Learning Mastery: Proficient" },
  { key: "learning_mastery_highly_proficient", label: "Learning Mastery: Highly Proficient" },
  { key: "ae_test_pass_rate", label: "A&E Test Pass Rate" },
  { key: "learners_reporting_school_violence", label: "Learners Reporting School Violence" },
  { key: "learner_satisfaction", label: "Learner Satisfaction" },
  { key: "learners_aware_of_education_rights", label: "Learners Aware of Education Rights" },
  { key: "schools_manifesting_rbe_indicators", label: "Schools/LCs Manifesting RBE Indicators" },
] as const;

const GROUP_A_METRIC_KEYS = {
  schoolAchievement: {
    school_head_name: ["name of school head"],
    total_enrolment: ["total number of enrolment", "total number of enrollment"],
    sbm_level_of_practice: ["sbm level of practice", "sbm level"],
    classroom_ratio_kindergarten: ["pupil student classroom ratio kindergarten"],
    classroom_ratio_grades_1_3: ["pupil student classroom ratio grades 1 to 3"],
    classroom_ratio_grades_4_6: ["pupil student classroom ratio grades 4 to 6"],
    classroom_ratio_grades_7_10: ["pupil student classroom ratio grades 7 to 10"],
    classroom_ratio_grades_11_12: ["pupil student classroom ratio grades 11 to 12"],
    water_sanitation_ratio: ["water and sanitation facility to pupil ratio"],
    comfort_rooms: ["number of comfort rooms"],
    comfort_rooms_toilet_bowl: ["a toilet bowl", "number of comfort rooms toilet bowl", "comfort rooms toilet bowl"],
    comfort_rooms_urinal: ["b urinal", "number of comfort rooms urinal", "comfort rooms urinal"],
    handwashing_facilities: ["handwashing facilities"],
    learning_material_ratio: ["ideal learning materials to learner ratio"],
    seat_ratio_overall: ["pupil student seat ratio overall"],
    seat_ratio_kindergarten: ["a kindergarten", "pupil student seat ratio kindergarten", "seat ratio kindergarten"],
    seat_ratio_grades_1_6: ["b grades 1 6", "pupil student seat ratio grades 1 6", "seat ratio grades 1 6"],
    seat_ratio_grades_7_10: ["c grades 7 10", "pupil student seat ratio grades 7 10", "seat ratio grades 7 10"],
    seat_ratio_grades_11_12: ["d grades 11 12", "pupil student seat ratio grades 11 12", "seat ratio grades 11 12"],
    ict_package_ratio: ["ict package e classroom package to sections ratio", "ict package classroom package to sections ratio"],
    ict_laboratory: ["a ict laboratory", "ict package e classroom package ict laboratory", "ict laboratory"],
    science_laboratory: ["science laboratory"],
    internet_access: ["do you have internet access y n", "do you have internet access"],
    electricity_access: ["do you have electricity y n", "do you have electricity"],
    complete_fence_gate: ["do you have a complete fence gate evident partially not evident", "complete fence gate"],
    teachers_total: ["no of teachers", "number of teachers"],
    teachers_male: ["no of teachers male", "number of teachers male", "teachers male", "a male"],
    teachers_female: ["no of teachers female", "number of teachers female", "teachers female", "b female"],
    teachers_with_disability: ["teachers with physical disability"],
    teachers_with_disability_male: ["teachers with physical disability male", "teachers pwd male", "physical disability male", "a male"],
    teachers_with_disability_female: ["teachers with physical disability female", "teachers pwd female", "physical disability female", "b female"],
    functional_sgc: ["functional sgc"],
    feeding_program_beneficiaries: ["school based feeding program beneficiaries"],
    canteen_income: ["school managed canteen annual income", "school managed canteen"],
    teachers_coop_canteen_income: ["teachers cooperative managed canteen if there is annual income", "teachers cooperative managed canteen annual income"],
    security_safety_plan: ["security and safety contingency plan"],
    security_safety_earthquake: ["security and safety contingency plan earthquake", "a earthquake", "earthquake"],
    security_safety_typhoon: ["security and safety contingency plan typhoon", "b typhoon", "typhoon"],
    security_safety_covid: ["security and safety contingency plan covid 19", "c covid 19", "covid 19"],
    security_safety_power_interruption: ["security and safety contingency plan power interruption", "d power interruption", "power interruption"],
    security_safety_in_person: ["security and safety contingency plan in person classes", "e in person classes", "in person classes"],
    teachers_trained_pfa: ["no of teachers trained on psychological first aid pfa", "teachers trained on psychological first aid pfa"],
    teachers_trained_occ_first_aid: ["no of teachers trained on occupational first aid", "teachers trained on occupational first aid"],
  },
  kpi: {
    net_enrollment_rate: ["net enrollment rate ner", "net enrollment rate"],
    retention_rate: ["retention rate rr", "retention rate"],
    dropout_rate: ["drop out rate dr", "dropout rate dr", "drop out rate", "dropout rate"],
    transition_rate: ["transition rate tr", "transition rate"],
    net_intake_rate: ["net intake rate nir", "net intake rate"],
    participation_rate: ["participation rate pr", "participation rate"],
    als_completion_rate: ["als completion rate"],
    gender_parity_index: ["gender parity index gpi", "gender parity index"],
    interquartile_ratio: ["interquartile ratio iqr", "interquartile ratio"],
    completion_rate: ["completion rate cr", "completion rate"],
    cohort_survival_rate: ["cohort survival rate csr", "cohort survival rate"],
    learning_mastery_nearly_proficient: ["learning mastery nearly proficient"],
    learning_mastery_proficient: ["learning mastery proficient"],
    learning_mastery_highly_proficient: ["learning mastery highly proficient"],
    ae_test_pass_rate: ["a e test pass rate", "ae test pass rate"],
    learners_reporting_school_violence: ["learners reporting school violence"],
    learner_satisfaction: ["learner satisfaction"],
    learners_aware_of_education_rights: ["learners aware of education rights"],
    schools_manifesting_rbe_indicators: ["schools lcs manifesting rbe indicators", "schools manifesting rbe indicators"],
  },
} as const;

const GROUP_A_METRIC_CODES = {
  schoolAchievement: {
    school_head_name: "IMETA_HEAD_NAME",
    total_enrolment: "IMETA_ENROLL_TOTAL",
    sbm_level_of_practice: "IMETA_SBM_LEVEL",
    classroom_ratio_kindergarten: "PCR_K",
    classroom_ratio_grades_1_3: "PCR_G1_3",
    classroom_ratio_grades_4_6: "PCR_G4_6",
    classroom_ratio_grades_7_10: "PCR_G7_10",
    classroom_ratio_grades_11_12: "PCR_G11_12",
    water_sanitation_ratio: "WASH_RATIO",
    comfort_rooms: "COMFORT_ROOMS",
    comfort_rooms_toilet_bowl: "TOILET_BOWLS",
    comfort_rooms_urinal: "URINALS",
    handwashing_facilities: "HANDWASH_FAC",
    learning_material_ratio: "LEARNING_MAT_RATIO",
    seat_ratio_overall: "PSR_OVERALL",
    seat_ratio_kindergarten: "PSR_K",
    seat_ratio_grades_1_6: "PSR_G1_6",
    seat_ratio_grades_7_10: "PSR_G7_10",
    seat_ratio_grades_11_12: "PSR_G11_12",
    ict_package_ratio: "ICT_RATIO",
    ict_laboratory: "ICT_LAB",
    science_laboratory: "SCIENCE_LAB",
    internet_access: "INTERNET_ACCESS",
    electricity_access: "ELECTRICITY",
    complete_fence_gate: "FENCE_STATUS",
    teachers_total: "TEACHERS_TOTAL",
    teachers_male: "TEACHERS_MALE",
    teachers_female: "TEACHERS_FEMALE",
    teachers_with_disability: "TEACHERS_PWD_TOTAL",
    teachers_with_disability_male: "TEACHERS_PWD_MALE",
    teachers_with_disability_female: "TEACHERS_PWD_FEMALE",
    functional_sgc: "FUNCTIONAL_SGC",
    feeding_program_beneficiaries: "FEEDING_BENEFICIARIES",
    canteen_income: "CANTEEN_INCOME",
    teachers_coop_canteen_income: "TEACHER_COOP_INCOME",
    security_safety_plan: "SAFETY_PLAN",
    security_safety_earthquake: "SAFETY_EARTHQUAKE",
    security_safety_typhoon: "SAFETY_TYPHOON",
    security_safety_covid: "SAFETY_COVID",
    security_safety_power_interruption: "SAFETY_POWER",
    security_safety_in_person: "SAFETY_IN_PERSON",
    teachers_trained_pfa: "TEACHERS_PFA",
    teachers_trained_occ_first_aid: "TEACHERS_OCC_FIRST_AID",
  },
  kpi: {
    net_enrollment_rate: "NER",
    retention_rate: "RR",
    dropout_rate: "DR",
    transition_rate: "TR",
    net_intake_rate: "NIR",
    participation_rate: "PR",
    als_completion_rate: "ALS_COMPLETER_PCT",
    gender_parity_index: "GPI",
    interquartile_ratio: "IQR",
    completion_rate: "CR",
    cohort_survival_rate: "CSR",
    learning_mastery_nearly_proficient: "PLM_NEARLY_PROF",
    learning_mastery_proficient: "PLM_PROF",
    learning_mastery_highly_proficient: "PLM_HIGH_PROF",
    ae_test_pass_rate: "AE_PASS_RATE",
    learners_reporting_school_violence: "VIOLENCE_REPORT_RATE",
    learner_satisfaction: "LEARNER_SATISFACTION",
    learners_aware_of_education_rights: "RIGHTS_AWARENESS",
    schools_manifesting_rbe_indicators: "RBE_MANIFEST",
  },
} as const;

const GROUP_A_METRIC_CODE_ALIASES = {
  schoolAchievement: {
    school_head_name: ["SALO"],
  },
  kpi: {},
} as const;

const GROUP_A_NORMALIZED_METRIC_CODES = {
  schoolAchievement: Object.fromEntries(
    Object.entries(GROUP_A_METRIC_CODES.schoolAchievement).map(([key, code]) => [
      key,
      normalizeMetricLookupKey(code),
    ]),
  ) as Record<keyof typeof GROUP_A_METRIC_CODES.schoolAchievement, string>,
  kpi: Object.fromEntries(
    Object.entries(GROUP_A_METRIC_CODES.kpi).map(([key, code]) => [
      key,
      normalizeMetricLookupKey(code),
    ]),
  ) as Record<keyof typeof GROUP_A_METRIC_CODES.kpi, string>,
};

function hasIndicatorDisplayValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => hasIndicatorDisplayValue(entry));
  }

  return false;
}

function currentReportIndicatorCompletenessScore(indicator: IndicatorSubmissionItem): number {
  let score = 0;

  if (hasIndicatorDisplayValue(indicator.actualTypedValue)) {
    score += 8;
  }
  if (hasIndicatorDisplayValue(indicator.actualDisplay)) {
    score += 4;
  }
  if (hasIndicatorDisplayValue(indicator.actualValue)) {
    score += 2;
  }
  if (hasIndicatorDisplayValue(indicator.targetTypedValue)) {
    score += 4;
  }
  if (hasIndicatorDisplayValue(indicator.targetDisplay)) {
    score += 2;
  }
  if (hasIndicatorDisplayValue(indicator.targetValue)) {
    score += 1;
  }

  return score;
}

function preferMoreCompleteCurrentReportIndicator(
  indicators: IndicatorSubmissionItem[],
): IndicatorSubmissionItem | null {
  if (indicators.length === 0) {
    return null;
  }

  return indicators
    .slice()
    .sort((left, right) => {
      const scoreDelta = currentReportIndicatorCompletenessScore(right) - currentReportIndicatorCompletenessScore(left);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return String(left.id ?? "").localeCompare(String(right.id ?? ""));
    })[0] ?? null;
}

export function resolveCurrentReportIndicatorByGroupAKey(
  indicators: IndicatorSubmissionItem[],
  group: keyof typeof GROUP_A_METRIC_KEYS,
  key: string,
): IndicatorSubmissionItem | null {
  const groupCodeMappings: Record<string, string> =
    group === "schoolAchievement"
      ? GROUP_A_NORMALIZED_METRIC_CODES.schoolAchievement
      : GROUP_A_NORMALIZED_METRIC_CODES.kpi;
  const expectedMetricCode = groupCodeMappings[key];

  const groupAliasMappings: Record<string, readonly string[] | undefined> =
    group === "schoolAchievement"
      ? GROUP_A_METRIC_CODE_ALIASES.schoolAchievement
      : GROUP_A_METRIC_CODE_ALIASES.kpi;
  const expectedMetricCodes = new Set<string>();
  if (expectedMetricCode) {
    expectedMetricCodes.add(expectedMetricCode);
  }
  for (const alias of groupAliasMappings[key] ?? []) {
    const normalizedAlias = normalizeMetricLookupKey(alias);
    if (normalizedAlias) {
      expectedMetricCodes.add(normalizedAlias);
    }
  }

  if (expectedMetricCodes.size > 0) {
    const exactCodeMatches = indicators.filter((indicator) => (
      expectedMetricCodes.has(normalizeMetricLookupKey(indicator.metric?.code))
    ));

    if (exactCodeMatches.length === 1) {
      return exactCodeMatches[0] ?? null;
    }

    if (exactCodeMatches.length > 1) {
      return preferMoreCompleteCurrentReportIndicator(exactCodeMatches);
    }
  }

  const nameAliases = (GROUP_A_METRIC_KEYS[group] as Record<string, readonly string[]>)[key] ?? [];
  if (nameAliases.length === 0) {
    return null;
  }

  const normalizedAliases = new Set(nameAliases.map((alias) => normalizeMetricLookupKey(alias)).filter(Boolean));
  const nameMatches = indicators.filter((indicator) => normalizedAliases.has(normalizeMetricLookupKey(indicator.metric?.name)));

  if (nameMatches.length === 1) {
    return nameMatches[0] ?? null;
  }

  if (nameMatches.length > 1) {
    return preferMoreCompleteCurrentReportIndicator(nameMatches);
  }

  return null;
}

function isSubItemMetric(label: string): boolean {
  return /^[a-e]\.\s/i.test(label);
}

function buildAuthenticatedReportPreviewEndpoint(relativeUrl: string): string {
  const apiBaseUrl = getApiBaseUrl();

  if (/^https?:\/\//i.test(apiBaseUrl)) {
    return new URL(relativeUrl, apiBaseUrl).toString();
  }

  return relativeUrl;
}

/* ── Component ── */
export function SchoolAdminDashboard() {
  const { user, apiToken } = useAuth();
  const { records, error, lastSyncedAt, syncScope, syncStatus, refreshRecords } = useData();
  const {
    submissions: submissionSnapshot,
    allSubmissions,
    academicYears,
    downloadSubmissionFile,
    fetchSubmission,
    lastSyncedAt: indicatorLastSyncedAt,
    loadSubmissionsForYear,
    refreshAllSubmissions,
    refreshSubmissions,
  } = useIndicatorData();

  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [dashboardViewAcademicYearId, setDashboardViewAcademicYearId] = useState("");
  const [dashboardViewSubmissions, setDashboardViewSubmissions] = useState<IndicatorSubmission[]>([]);
  const [isDashboardYearSwitching, setIsDashboardYearSwitching] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [activeReportModalType, setActiveReportModalType] = useState<IndicatorSubmissionFileType | null>(null);
  const [activeReportPreviewUrl, setActiveReportPreviewUrl] = useState<string | null>(null);
  const [activeReportPreviewError, setActiveReportPreviewError] = useState("");
  const [reportZoomLevel, setReportZoomLevel] = useState(1);
  const [optimisticReportSource, setOptimisticReportSource] = useState<DashboardReportSource | null>(null);
  const [hydratedReportSource, setHydratedReportSource] = useState<DashboardReportSource | null>(null);
  const [isHydratingReportSubmission, setIsHydratingReportSubmission] = useState(false);
  const [reportHydrationStatus, setReportHydrationStatus] = useState<ReportHydrationStatus>("idle");
  const [reportHydrationError, setReportHydrationError] = useState("");
  const [reportHydrationRetryTick, setReportHydrationRetryTick] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT,
  );
  const initialLoadStartedRef = useRef(false);
  const hasManualDashboardYearSelectionRef = useRef(false);
  const finalizedSubmissionRefreshRef = useRef("");
  const lastLoadedYearKeyRef = useRef("");
  const previousDashboardContextKeyRef = useRef("");
  const activeReportPreviewUrlRef = useRef<string | null>(null);
  const reportHydrationAttemptsRef = useRef<{ fingerprint: string; attempts: number }>({ fingerprint: "", attempts: 0 });
  const reportHydrationInFlightRef = useRef("");
  const reportHydrationRetryScheduledRef = useRef("");
  const reportHydrationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActiveReportPreview = useCallback(() => {
    if (activeReportPreviewUrlRef.current) {
      URL.revokeObjectURL(activeReportPreviewUrlRef.current);
      activeReportPreviewUrlRef.current = null;
    }

    setActiveReportPreviewUrl(null);
    setActiveReportPreviewError("");
  }, []);

  const setActiveReportPreviewObjectUrl = useCallback((url: string) => {
    if (activeReportPreviewUrlRef.current) {
      URL.revokeObjectURL(activeReportPreviewUrlRef.current);
    }

    activeReportPreviewUrlRef.current = url;
    setActiveReportPreviewUrl(url);
  }, []);

  const clearReportHydrationRetryTimer = useCallback(() => {
    if (reportHydrationRetryTimerRef.current) {
      clearTimeout(reportHydrationRetryTimerRef.current);
      reportHydrationRetryTimerRef.current = null;
    }
    reportHydrationRetryScheduledRef.current = "";
  }, []);

  const retryReportDetailHydration = useCallback(() => {
    clearReportHydrationRetryTimer();
    reportHydrationAttemptsRef.current = { fingerprint: "", attempts: 0 };
    reportHydrationInFlightRef.current = "";
    finalizedSubmissionRefreshRef.current = "";
    setReportHydrationError("");
    setReportHydrationStatus("loading");
    setIsHydratingReportSubmission(true);
    setReportHydrationRetryTick((current) => current + 1);
  }, [clearReportHydrationRetryTimer]);

  useEffect(() => () => {
    clearActiveReportPreview();
    clearReportHydrationRetryTimer();
  }, [clearActiveReportPreview, clearReportHydrationRetryTimer]);

  /* ── Derived data ── */
  const orderedAcademicYears = useMemo(
    () => [...academicYears].sort(compareAcademicYearsAscending),
    [academicYears],
  );

  const selectedSchoolId = String(user?.schoolId ?? "").trim();
  const dashboardContextKey = `${String(user?.id ?? "").trim()}:${selectedSchoolId}`;
  const assignedRecord = useMemo(
    () => records.find((record) => String(record.schoolId ?? record.id ?? "").trim() === selectedSchoolId) ?? null,
    [records, selectedSchoolId],
  );
  const { schoolName, schoolCode, schoolAddress } = useMemo(
    () => resolveSchoolAdminHeaderContext(assignedRecord, user),
    [assignedRecord, user],
  );
  const dashboardYearSelectionStorageKey = useMemo(
    () => buildDashboardViewYearStorageKey(user?.id, selectedSchoolId),
    [selectedSchoolId, user?.id],
  );
  const dashboardYearManualStorageKey = useMemo(
    () => buildDashboardViewYearManualStorageKey(user?.id, selectedSchoolId),
    [selectedSchoolId, user?.id],
  );

  const currentAcademicYearOption = useMemo(
    () => orderedAcademicYears.find((y) => y.isCurrent) ?? orderedAcademicYears[0] ?? null,
    [orderedAcademicYears],
  );
  const effectiveAcademicYearId = dashboardViewAcademicYearId;
  const indicatorSubmissions = useMemo(
    () => (allSubmissions.length > 0 || submissionSnapshot.length === 0 ? allSubmissions : submissionSnapshot),
    [allSubmissions, submissionSnapshot],
  );
  const schoolScopedSubmissions = useMemo(
    () => (
      selectedSchoolId
        ? indicatorSubmissions.filter((submission) => resolveSubmissionSchoolId(submission) === selectedSchoolId)
        : []
    ),
    [indicatorSubmissions, selectedSchoolId],
  );
  const hydratedSubmittedReportSubmission = hydratedReportSource?.submission ?? null;
  const optimisticSubmittedReportSubmission = optimisticReportSource?.submission ?? null;
  const preferredSavedAcademicYearId = useMemo(() => {
    const trustedReportSourceSubmissions = [
      hydratedSubmittedReportSubmission,
      optimisticSubmittedReportSubmission,
    ].filter((submission): submission is IndicatorSubmission => (
      Boolean(submission)
      && resolveSubmissionSchoolId(submission) === selectedSchoolId
    ));
    const preferredCandidates = (
      selectedSchoolId && trustedReportSourceSubmissions.length > 0
        ? [...schoolScopedSubmissions, ...trustedReportSourceSubmissions]
        : schoolScopedSubmissions
    );

    return resolvePreferredSchoolHeadCurrentReportAcademicYearId(preferredCandidates, selectedSchoolId);
  }, [hydratedSubmittedReportSubmission, optimisticSubmittedReportSubmission, schoolScopedSubmissions, selectedSchoolId]);
  const submissionsForSelectedContext = useMemo(() => {
    if (!effectiveAcademicYearId) {
      return [];
    }

    return resolveSelectedYearCurrentReportContextSubmissions(
      dashboardViewSubmissions,
      schoolScopedSubmissions,
      effectiveAcademicYearId,
    );
  }, [dashboardViewSubmissions, effectiveAcademicYearId, schoolScopedSubmissions]);
  const groupAReportSourceSubmission = useMemo(
    () => resolveSelectedYearSchoolHeadCurrentReportSubmission(submissionsForSelectedContext),
    [submissionsForSelectedContext],
  );
  const trustedHydratedReportSubmission = useMemo(
    () => resolveTrustedHydratedReportSource(
      groupAReportSourceSubmission,
      hydratedSubmittedReportSubmission,
      {
        selectedSchoolId,
        selectedAcademicYearId: effectiveAcademicYearId,
      },
    ),
    [effectiveAcademicYearId, groupAReportSourceSubmission, hydratedSubmittedReportSubmission, selectedSchoolId],
  );
  const trustedOptimisticReportSubmission = useMemo(
    () => trustedHydratedReportSubmission
      ? null
      : resolveTrustedHydratedReportSource(
        groupAReportSourceSubmission,
        optimisticSubmittedReportSubmission,
        {
          selectedSchoolId,
          selectedAcademicYearId: effectiveAcademicYearId,
        },
      ),
    [
      effectiveAcademicYearId,
      groupAReportSourceSubmission,
      optimisticSubmittedReportSubmission,
      selectedSchoolId,
      trustedHydratedReportSubmission,
    ],
  );
  const effectiveReportDetailSubmission = trustedHydratedReportSubmission ?? trustedOptimisticReportSubmission;
  const reportSourceQuality: DashboardReportSourceQuality | "lightweight" | "empty" = trustedHydratedReportSubmission
    ? "hydrated"
    : trustedOptimisticReportSubmission
      ? "optimistic"
      : groupAReportSourceSubmission
        ? "lightweight"
        : "empty";
  const isYearScopedLoading = isDashboardYearSwitching;

  useEffect(() => {
    if (previousDashboardContextKeyRef.current === dashboardContextKey) {
      return;
    }

    previousDashboardContextKeyRef.current = dashboardContextKey;
    initialLoadStartedRef.current = false;
    hasManualDashboardYearSelectionRef.current = false;
    finalizedSubmissionRefreshRef.current = "";
    lastLoadedYearKeyRef.current = "";
    setDashboardViewAcademicYearId("");
    setDashboardViewSubmissions([]);
    setOptimisticReportSource(null);
    setHydratedReportSource(null);
    setIsHydratingReportSubmission(false);
    setReportHydrationStatus("idle");
    setReportHydrationError("");
    reportHydrationAttemptsRef.current = { fingerprint: "", attempts: 0 };
    reportHydrationInFlightRef.current = "";
    clearReportHydrationRetryTimer();
    setIsDashboardYearSwitching(false);
    clearActiveReportPreview();
    setActiveReportModalType(null);
    if (typeof window !== "undefined") {
      if (dashboardYearSelectionStorageKey) {
        window.sessionStorage.removeItem(dashboardYearSelectionStorageKey);
      }
      if (dashboardYearManualStorageKey) {
        window.sessionStorage.removeItem(dashboardYearManualStorageKey);
      }
    }
  }, [clearActiveReportPreview, clearReportHydrationRetryTimer, dashboardContextKey, dashboardYearManualStorageKey, dashboardYearSelectionStorageKey]);

  useEffect(() => {
    if (!groupAReportSourceSubmission?.id) {
      finalizedSubmissionRefreshRef.current = "";
      reportHydrationAttemptsRef.current = { fingerprint: "", attempts: 0 };
      reportHydrationInFlightRef.current = "";
      clearReportHydrationRetryTimer();
      setHydratedReportSource((current) => (
        resolveDashboardReportSourceForView(current, {
          selectedSchoolId,
          selectedAcademicYearId: effectiveAcademicYearId,
        })
      ));
      setOptimisticReportSource((current) => (
        resolveDashboardReportSourceForView(current, {
          selectedSchoolId,
          selectedAcademicYearId: effectiveAcademicYearId,
        })
      ));
      setIsHydratingReportSubmission(false);
      setReportHydrationStatus("idle");
      setReportHydrationError("");
      return;
    }

    const refreshFingerprint = buildSubmissionRefreshFingerprint(groupAReportSourceSubmission);
    let cancelled = false;
    const submissionId = groupAReportSourceSubmission.id;
    const hydrationContextKey = buildDashboardReportSourceContextKey(
      user?.id,
      selectedSchoolId,
      effectiveAcademicYearId,
      submissionId,
    );
    const hasTrustedHydratedDetail = Boolean(
      trustedHydratedReportSubmission
      && isSameSubmission(groupAReportSourceSubmission, trustedHydratedReportSubmission),
    );

    if (hasTrustedHydratedDetail) {
      finalizedSubmissionRefreshRef.current = refreshFingerprint;
      reportHydrationAttemptsRef.current = { fingerprint: refreshFingerprint, attempts: 0 };
      reportHydrationInFlightRef.current = "";
      clearReportHydrationRetryTimer();
      setIsHydratingReportSubmission(false);
      setReportHydrationStatus("ready");
      setReportHydrationError("");
      return () => {
        cancelled = true;
      };
    }

    if (reportHydrationInFlightRef.current === refreshFingerprint || reportHydrationRetryScheduledRef.current === refreshFingerprint) {
      return () => {
        cancelled = true;
      };
    }

    const attemptState = reportHydrationAttemptsRef.current.fingerprint === refreshFingerprint
      ? reportHydrationAttemptsRef.current
      : { fingerprint: refreshFingerprint, attempts: 0 };

    if (attemptState.attempts >= REPORT_DETAIL_HYDRATION_MAX_ATTEMPTS) {
      finalizedSubmissionRefreshRef.current = refreshFingerprint;
      setIsHydratingReportSubmission(false);
      setReportHydrationStatus("failed");
      setReportHydrationError("Unable to load saved report details.");
      return () => {
        cancelled = true;
      };
    }

    const nextAttemptCount = attemptState.attempts + 1;
    reportHydrationAttemptsRef.current = { fingerprint: refreshFingerprint, attempts: nextAttemptCount };
    reportHydrationInFlightRef.current = refreshFingerprint;
    finalizedSubmissionRefreshRef.current = refreshFingerprint;
    setIsHydratingReportSubmission(true);
    setReportHydrationStatus(nextAttemptCount > 1 ? "retrying" : "loading");
    setReportHydrationError(nextAttemptCount > 1 ? "Retrying saved report details..." : "");
    void fetchSubmission(submissionId)
      .then((submission) => {
        if (!cancelled && submission.id === submissionId) {
          const submissionSchoolId = resolveSubmissionSchoolId(submission);
          const submissionAcademicYearId = String(submission.academicYear?.id ?? "").trim();
          if (submissionSchoolId !== selectedSchoolId || submissionAcademicYearId !== effectiveAcademicYearId) {
            return;
          }

          const matchingOptimisticSubmission = (
            optimisticSubmittedReportSubmission
            && isSameSubmission(submission, optimisticSubmittedReportSubmission)
          )
            ? optimisticSubmittedReportSubmission
            : null;
          if (
            matchingOptimisticSubmission
            && schoolHeadCurrentReportRecencyScore(submission) < schoolHeadCurrentReportRecencyScore(matchingOptimisticSubmission)
          ) {
            setReportHydrationStatus("ready");
            setReportHydrationError("");
            return;
          }

          setHydratedReportSource((current) => {
            const currentSubmission = current?.submission ?? null;
            const nextSubmission = resolveHydratedCurrentReportSubmissionCandidate(
              currentSubmission,
              submission,
              {
                selectedSchoolId,
                selectedAcademicYearId: effectiveAcademicYearId,
              },
            );
            return nextSubmission
              ? buildDashboardReportSource(nextSubmission, "hydrated", {
                userId: user?.id,
                selectedSchoolId,
                selectedAcademicYearId: effectiveAcademicYearId,
              })
              : null;
          });
          setOptimisticReportSource((current) => (
            current?.contextKey === hydrationContextKey ? null : current
          ));
          setDashboardViewSubmissions((current) => mergeSubmissionIntoDashboardViewRows(current, submission, "hydrated"));
          setReportHydrationStatus("ready");
          setReportHydrationError("");
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        if (nextAttemptCount < REPORT_DETAIL_HYDRATION_MAX_ATTEMPTS) {
          setReportHydrationStatus("retrying");
          setReportHydrationError("Retrying saved report details...");
          clearReportHydrationRetryTimer();
          reportHydrationRetryScheduledRef.current = refreshFingerprint;
          reportHydrationRetryTimerRef.current = setTimeout(() => {
            reportHydrationRetryTimerRef.current = null;
            reportHydrationRetryScheduledRef.current = "";
            setReportHydrationRetryTick((current) => current + 1);
          }, REPORT_DETAIL_HYDRATION_RETRY_DELAY_MS);
          return;
        }

        setReportHydrationStatus("failed");
        setReportHydrationError("Unable to load saved report details.");
      })
      .finally(() => {
        if (reportHydrationInFlightRef.current === refreshFingerprint) {
          reportHydrationInFlightRef.current = "";
        }

        if (!cancelled && reportHydrationRetryScheduledRef.current !== refreshFingerprint) {
          setIsHydratingReportSubmission(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    clearReportHydrationRetryTimer,
    effectiveAcademicYearId,
    fetchSubmission,
    groupAReportSourceSubmission,
    optimisticSubmittedReportSubmission,
    reportHydrationRetryTick,
    selectedSchoolId,
    trustedHydratedReportSubmission,
    user?.id,
  ]);
  const groupAReportView = useMemo(() => {
    const reportYearLabel = selectedYearLabel(
      effectiveAcademicYearId,
      academicYears,
      currentAcademicYearOption?.name ?? "N/A",
    );
    const selectedSubmission = resolveSchoolHeadCurrentReportSubmissionForView(groupAReportSourceSubmission, {
      selectedSchoolId,
      selectedAcademicYearId: effectiveAcademicYearId,
    });
    const submission = resolveStableSchoolHeadCurrentReportViewSubmission(
      selectedSubmission,
      effectiveReportDetailSubmission,
      {
        selectedSchoolId,
        selectedAcademicYearId: effectiveAcademicYearId,
      },
    );
    const indicators = submissionRows(submission);
    const duplicateMetricCodes = new Set<string>();
    const indicatorCodeCounts = new Map<string, number>();

    for (const item of indicators) {
      const normalizedMetricCode = normalizeMetricLookupKey(item.metric?.code);
      if (normalizedMetricCode) {
        const nextCount = (indicatorCodeCounts.get(normalizedMetricCode) ?? 0) + 1;
        indicatorCodeCounts.set(normalizedMetricCode, nextCount);
        if (nextCount > 1) {
          duplicateMetricCodes.add(normalizedMetricCode);
        }
      }
    }

    const availableMetricCodes = Array.from(indicatorCodeCounts.keys()).sort();
    const targetsMetRows = buildTargetsMetReportViewRowsForSubmission(submission, reportYearLabel);

    if (
      import.meta.env.DEV &&
      duplicateMetricCodes.size > 0
    ) {
      console.warn("Group A mapping diagnostics", {
        submissionId: submission?.id ?? null,
        academicYearId: submission?.academicYear?.id ?? null,
        duplicateMetricCodes: Array.from(duplicateMetricCodes).sort(),
        availableMetricCodes,
      });
    }

    return {
      submission,
      sourceMode: resolveSchoolHeadReportSourceMode(submission),
      getIndicatorByGroupAKey: targetsMetRows.getIndicatorByGroupAKey,
      completedIndicators: indicators.length > 0
        ? indicators.filter((indicator) => isCountableComplianceStatus(indicator.complianceStatus)).length
        : (
          (submission?.summary?.metIndicators ?? 0)
          + (submission?.summary?.belowTargetIndicators ?? 0)
          + (submission?.summary?.recordedIndicators ?? 0)
        ),
      sourceQuality: reportSourceQuality,
      totalIndicators: submission?.summary?.totalIndicators ?? 0,
      indicators,
      schoolAchievementRows: targetsMetRows.schoolAchievementRows,
      kpiRows: targetsMetRows.kpiRows,
    };
  }, [
    academicYears,
    currentAcademicYearOption?.name,
    effectiveAcademicYearId,
    effectiveReportDetailSubmission,
    groupAReportSourceSubmission,
    reportSourceQuality,
    selectedSchoolId,
  ]);
  const effectiveReportSourceSubmission = groupAReportView.submission;
  const isCurrentReportHydratingDetails = Boolean(
    effectiveReportSourceSubmission
    && isHydratingReportSubmission
    && !submissionHasRenderableReportDetails(effectiveReportSourceSubmission),
  );
  const reportHasRenderableDetails = submissionHasRenderableReportDetails(effectiveReportSourceSubmission);
  const reportHasSource = Boolean(effectiveReportSourceSubmission);
  const reportNeedsTrustedHydratedSource = Boolean(
    groupAReportSourceSubmission
    && !trustedHydratedReportSubmission
    && !trustedOptimisticReportSubmission,
  );
  const reportViewRenderState: "loading" | "empty" | "ready" | "failed" = (
    reportHydrationStatus === "failed"
    && reportNeedsTrustedHydratedSource
    && !reportHasRenderableDetails
  )
    ? "failed"
    : (
      (isYearScopedLoading && !reportHasRenderableDetails)
      || reportNeedsTrustedHydratedSource
      || (reportHasSource && !reportHasRenderableDetails)
      || isCurrentReportHydratingDetails
    )
      ? "loading"
      : reportHasSource
        ? "ready"
        : "empty";
  const isReportViewReady = reportViewRenderState === "ready";
  const canShowReportSourceContext = reportViewRenderState !== "empty" && reportHasSource;
  const reportViewTitle = groupAReportView.sourceMode === "submitted"
    ? "Submitted Report Package"
    : "TARGETS-MET";
  const visibleSubmittedReportFiles = useMemo<SubmissionFileTabDefinition[]>(
    () => resolveSubmittedReportVisibleFileDefinitions({
      schoolType: resolveSubmissionPresentationSchoolType(groupAReportView.submission, user?.schoolType ?? null),
      requiredFileTypes: getActiveReportFileTypes(groupAReportView.submission, user?.schoolType ?? null),
    }),
    [
      groupAReportView.submission,
      user?.schoolType,
    ],
  );
  const secondarySubmittedReportFiles = useMemo<SubmissionFileTabDefinition[]>(
    () => resolveSecondarySubmittedReportFileDefinitions({
      schoolType: resolveSubmissionPresentationSchoolType(groupAReportView.submission, user?.schoolType ?? null),
      requiredFileTypes: getActiveReportFileTypes(groupAReportView.submission, user?.schoolType ?? null),
      uploadedFileTypes: getSecondaryHistoricalFileTypes(groupAReportView.submission, user?.schoolType ?? null),
    }),
    [
      groupAReportView.submission,
      user?.schoolType,
    ],
  );
  const visibleSubmittedReportFileEntries = useMemo(
    () => getActiveReportVisibleFiles(groupAReportView.submission, user?.schoolType ?? null),
    [groupAReportView.submission, user?.schoolType],
  );
  const secondarySubmittedReportFileEntries = useMemo(
    () => getSecondaryHistoricalVisibleFiles(groupAReportView.submission, user?.schoolType ?? null),
    [groupAReportView.submission, user?.schoolType],
  );
  const activeReportDefinition = activeReportModalType
    ? SUBMISSION_FILE_DEFINITION_BY_TYPE[activeReportModalType] ?? null
    : null;
  const activeReportFileEntry: IndicatorSubmissionFileEntry | null = useMemo(() => {
    if (!activeReportModalType) return null;
    return visibleSubmittedReportFileEntries[activeReportModalType]
      ?? secondarySubmittedReportFileEntries[activeReportModalType]
      ?? null;
  }, [activeReportModalType, secondarySubmittedReportFileEntries, visibleSubmittedReportFileEntries]);
  const activeReportFileName = activeReportFileEntry?.originalFilename ?? null;
  const activeReportExtension = normalizeFileExtension(activeReportFileName);
  const activeSchoolYearLabel = selectedYearLabel(
    effectiveAcademicYearId,
    orderedAcademicYears.map((year) => ({ id: year.id, name: year.name })),
    currentAcademicYearOption?.name ?? "N/A",
  );
  const selectedReportYearLabel = selectedYearLabel(
    effectiveAcademicYearId,
    orderedAcademicYears.map((year) => ({ id: year.id, name: year.name })),
    currentAcademicYearOption?.name ?? "N/A",
  );
  const submittedReportSourceContext = useMemo(
    () => buildSchoolHeadCurrentReportSourceContext(groupAReportView.submission, selectedReportYearLabel),
    [groupAReportView.submission, selectedReportYearLabel],
  );
  /* ── Refresh ── */
  const runDashboardRefresh = useCallback(
    async () => runRefreshBatches(
      buildSchoolAdminRefreshBatches(refreshRecords, refreshSubmissions, refreshAllSubmissions),
    ),
    [refreshAllSubmissions, refreshRecords, refreshSubmissions],
  );

  const handleRefreshAll = useCallback(async () => {
    if (isRefreshingAll) return;
    setIsRefreshingAll(true);
    try {
      await runDashboardRefresh();
    } finally {
      setIsRefreshingAll(false);
    }
  }, [isRefreshingAll, runDashboardRefresh]);

  useEffect(() => {
    if (!dashboardContextKey) return;
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    let active = true;
    setIsRefreshingAll(true);
    void runDashboardRefresh().finally(() => {
      if (active) setIsRefreshingAll(false);
    });
    return () => {
      active = false;
    };
  }, [dashboardContextKey, runDashboardRefresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setIsMobileViewport(window.innerWidth < MOBILE_BREAKPOINT);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    if (orderedAcademicYears.length === 0) return;
    const storedAcademicYearId = (
      typeof window !== "undefined" && dashboardYearSelectionStorageKey
        ? window.sessionStorage.getItem(dashboardYearSelectionStorageKey) ?? ""
        : ""
    );
    const hasManualStoredSelection = (
      typeof window !== "undefined"
      && dashboardYearManualStorageKey
      && window.sessionStorage.getItem(dashboardYearManualStorageKey) === "true"
    );

    if (!dashboardViewAcademicYearId) {
      hasManualDashboardYearSelectionRef.current = Boolean(hasManualStoredSelection);
    }

    const initialAcademicYearId = resolveInitialSchoolHeadReportAcademicYearId(
      orderedAcademicYears,
      storedAcademicYearId,
      preferredSavedAcademicYearId,
      hasManualDashboardYearSelectionRef.current,
    );
    if (!initialAcademicYearId) return;
    if (dashboardViewAcademicYearId) {
      return;
    }

    setDashboardViewAcademicYearId(initialAcademicYearId);
  }, [
    dashboardViewAcademicYearId,
    dashboardYearManualStorageKey,
    dashboardYearSelectionStorageKey,
    orderedAcademicYears,
    preferredSavedAcademicYearId,
  ]);

  useEffect(() => {
    if (!preferredSavedAcademicYearId || !dashboardViewAcademicYearId) {
      return;
    }
    if (dashboardViewAcademicYearId === preferredSavedAcademicYearId) {
      return;
    }
    if (hasManualDashboardYearSelectionRef.current) {
      return;
    }
    if (!orderedAcademicYears.some((year) => year.id === preferredSavedAcademicYearId)) {
      return;
    }

    setDashboardViewAcademicYearId(preferredSavedAcademicYearId);
    lastLoadedYearKeyRef.current = "";
    setDashboardViewSubmissions([]);
    setHydratedReportSource((current) => (
      resolveDashboardReportSourceForView(current, {
        selectedSchoolId,
        selectedAcademicYearId: preferredSavedAcademicYearId,
      })
    ));
    setOptimisticReportSource((current) => (
      resolveDashboardReportSourceForView(current, {
        selectedSchoolId,
        selectedAcademicYearId: preferredSavedAcademicYearId,
      })
    ));
    setIsDashboardYearSwitching(false);
  }, [dashboardViewAcademicYearId, orderedAcademicYears, preferredSavedAcademicYearId, selectedSchoolId]);

  useEffect(() => {
    if (typeof window === "undefined" || !dashboardYearSelectionStorageKey || !dashboardViewAcademicYearId) {
      return;
    }

    window.sessionStorage.setItem(dashboardYearSelectionStorageKey, dashboardViewAcademicYearId);
  }, [dashboardViewAcademicYearId, dashboardYearSelectionStorageKey]);

  const handleDashboardViewAcademicYearChange = useCallback(async (nextYearId: string) => {
    if (nextYearId === dashboardViewAcademicYearId) {
      return;
    }

    hasManualDashboardYearSelectionRef.current = true;
    if (typeof window !== "undefined" && dashboardYearManualStorageKey) {
      window.sessionStorage.setItem(dashboardYearManualStorageKey, "true");
    }
    setDashboardViewAcademicYearId(nextYearId);
    clearReportHydrationRetryTimer();
    reportHydrationAttemptsRef.current = { fingerprint: "", attempts: 0 };
    reportHydrationInFlightRef.current = "";
    setHydratedReportSource((current) => (
      resolveDashboardReportSourceForView(current, {
        selectedSchoolId,
        selectedAcademicYearId: nextYearId,
      })
    ));
    setOptimisticReportSource((current) => (
      resolveDashboardReportSourceForView(current, {
        selectedSchoolId,
        selectedAcademicYearId: nextYearId,
      })
    ));

    if (!selectedSchoolId || !nextYearId || nextYearId === "all") {
      lastLoadedYearKeyRef.current = "";
      setDashboardViewSubmissions([]);
      setIsDashboardYearSwitching(false);
    }
  }, [clearReportHydrationRetryTimer, dashboardViewAcademicYearId, dashboardYearManualStorageKey, selectedSchoolId]);

  useEffect(() => {
    if (!selectedSchoolId || !dashboardViewAcademicYearId || dashboardViewAcademicYearId === "all") {
      if (dashboardViewAcademicYearId === "all") {
        setDashboardViewSubmissions([]);
      }
      return;
    }

    const key = buildSelectedYearLoadKey(selectedSchoolId, dashboardViewAcademicYearId, indicatorLastSyncedAt);
    if (lastLoadedYearKeyRef.current === key) {
      return;
    }

    lastLoadedYearKeyRef.current = key;
    setIsDashboardYearSwitching(true);

    void loadSubmissionsForYear(selectedSchoolId, dashboardViewAcademicYearId)
      .then((rows) => {
        if (lastLoadedYearKeyRef.current === key) {
          setDashboardViewSubmissions(rows);
        }
      })
      .catch(() => {
        if (lastLoadedYearKeyRef.current === key) {
          setDashboardViewSubmissions([]);
        }
      })
      .finally(() => {
        if (lastLoadedYearKeyRef.current === key) {
          setIsDashboardYearSwitching(false);
        }
      });
  }, [dashboardViewAcademicYearId, indicatorLastSyncedAt, loadSubmissionsForYear, selectedSchoolId]);

  const handleWorkspaceSubmissionHydrated = useCallback((
    submission: IndicatorSubmission,
    meta?: { source?: "optimistic" | "hydrated" },
  ) => {
    const submissionSchoolId = resolveSubmissionSchoolId(submission);
    const submissionAcademicYearId = String(submission.academicYear?.id ?? "").trim();
    const source = meta?.source ?? "hydrated";

    if (!selectedSchoolId || submissionSchoolId !== selectedSchoolId || !submissionAcademicYearId) {
      return;
    }

    if (effectiveAcademicYearId && submissionAcademicYearId !== effectiveAcademicYearId) {
      if (hasManualDashboardYearSelectionRef.current) {
        return;
      }
      setDashboardViewAcademicYearId(submissionAcademicYearId);
      lastLoadedYearKeyRef.current = "";
    }

    if (!effectiveAcademicYearId) {
      setDashboardViewAcademicYearId(submissionAcademicYearId);
      lastLoadedYearKeyRef.current = "";
    }

    const sourceContextKey = buildDashboardReportSourceContextKey(
      user?.id,
      selectedSchoolId,
      submissionAcademicYearId,
      submission.id,
    );
    const buildSource = (nextSubmission: IndicatorSubmission, quality: DashboardReportSourceQuality): DashboardReportSource => ({
      contextKey: sourceContextKey,
      quality,
      submission: nextSubmission,
    });

    if (source === "hydrated") {
      setHydratedReportSource((current) => {
        const candidateOptions = {
          selectedSchoolId,
          selectedAcademicYearId: submissionAcademicYearId,
        };
        const existingSubmissionId = String(current?.submission?.id ?? "").trim();
        const incomingSubmissionId = String(submission.id ?? "").trim();
        const currentSubmission = current?.submission ?? null;
        const nextSubmission = (
          currentSubmission && existingSubmissionId && existingSubmissionId === incomingSubmissionId
            ? resolveSchoolHeadCurrentReportSubmissionForView(
              mergeCurrentReportCandidateDetails(submission, currentSubmission),
              candidateOptions,
            )
            : resolveHydratedCurrentReportSubmissionCandidate(
              currentSubmission,
              submission,
              candidateOptions,
            )
        );

        return nextSubmission ? buildSource(nextSubmission, "hydrated") : null;
      });
      setOptimisticReportSource((current) => (
        current?.contextKey === sourceContextKey ? null : current
      ));
    } else {
      setOptimisticReportSource((current) => {
        const candidateOptions = {
          selectedSchoolId,
          selectedAcademicYearId: submissionAcademicYearId,
        };
        const nextSubmission = resolveHydratedCurrentReportSubmissionCandidate(
          current?.submission ?? null,
          submission,
          candidateOptions,
        );

        return nextSubmission ? buildSource(nextSubmission, "optimistic") : null;
      });
    }

    setDashboardViewSubmissions((current) => mergeSubmissionIntoDashboardViewRows(current, submission, source));
  }, [effectiveAcademicYearId, selectedSchoolId, user?.id]);

  useEffect(() => {
    clearActiveReportPreview();
    setActiveReportModalType(null);
  }, [clearActiveReportPreview, effectiveAcademicYearId, effectiveReportSourceSubmission?.id]);


  /* ── Quick-jump scroll ── */
  const scrollToSection = (sectionId: string) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(sectionId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setFocusedSectionId(sectionId);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setFocusedSectionId((cur) => (cur === sectionId ? null : cur));
      }, 3000);
    }
  };

  const focusCls = (id: string) => (focusedSectionId === id ? "dashboard-focus-glow" : "");

  const openReportModal = useCallback(
    async (type: IndicatorSubmissionFileType) => {
      const submission = groupAReportView.submission;
      const fileEntry = submission?.files?.[type] ?? null;
      if (!submission || !fileEntry?.uploaded) return;

      clearActiveReportPreview();
      setActiveReportModalType(type);
      setReportZoomLevel(1);

      try {
        const relativeUrl = fileEntry.viewUrl ?? fileEntry.downloadUrl;
        if (!relativeUrl) {
          throw new Error("Preview URL is unavailable for this report.");
        }

        const endpoint = buildAuthenticatedReportPreviewEndpoint(relativeUrl);
        const headers = new Headers({ Accept: "*/*" });
        if (apiToken !== COOKIE_SESSION_TOKEN) {
          headers.set("Authorization", `Bearer ${apiToken}`);
        }

        const response = await fetch(endpoint, {
          method: "GET",
          credentials: apiToken === COOKIE_SESSION_TOKEN ? "include" : "omit",
          headers,
        });

        if (!response.ok) {
          throw new Error(`Unable to open report preview (status ${response.status}).`);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        setActiveReportPreviewObjectUrl(objectUrl);
      } catch {
        setActiveReportPreviewError("Preview could not be loaded. Use Download to open the uploaded file.");
      }
    },
    [apiToken, clearActiveReportPreview, groupAReportView, setActiveReportPreviewObjectUrl],
  );

  const closeReportModal = useCallback(() => {
    clearActiveReportPreview();
    setActiveReportModalType(null);
    setReportZoomLevel(1);
  }, [clearActiveReportPreview]);

  const handleDownloadActiveReport = useCallback(async () => {
    if (!activeReportModalType || !groupAReportView.submission) return;

    await downloadSubmissionFile(groupAReportView.submission.id, activeReportModalType);
  }, [activeReportModalType, downloadSubmissionFile, groupAReportView]);

  useEffect(() => {
    if (!activeReportModalType || typeof window === "undefined") return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeReportModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeReportModalType, closeReportModal]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleRefreshShortcut = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target) || !isRefreshShortcut(event)) {
        return;
      }

      event.preventDefault();
      void handleRefreshAll();
    };

    window.addEventListener("keydown", handleRefreshShortcut);
    return () => window.removeEventListener("keydown", handleRefreshShortcut);
  }, [handleRefreshAll]);

  /* ── Render ── */
  return (
    <Shell
      title="School Head Dashboard"
      subtitle=""
      actions={
        <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm border border-white/20 bg-white/10 p-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => void handleRefreshAll()}
            disabled={isRefreshingAll}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-white text-primary-700 shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
            aria-label="Refresh dashboard data"
            title="Refresh all data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingAll ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setShowHelpDialog(true)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-white text-primary-700 shadow-sm transition hover:bg-white/90"
            aria-label="Open quick guide"
            title="Help"
          >
            <CircleHelp className="h-3.5 w-3.5" />
          </button>
          <span className="hidden max-w-[17rem] items-center truncate text-[11px] font-medium text-primary-100 sm:inline-flex lg:max-w-[21rem]">
            {syncStatus === "up_to_date" ? "Up to date" : "Updated"}
            {" | "}
            {lastSyncedAt
              ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "Not synced"}
            {syncScope ? ` | ${syncScope}` : ""}
          </span>
        </div>
      }
    >
      <div className="school-head-dashboard mx-auto w-full max-w-[1180px] text-[14px]">
      {error && (
        <section className="mb-5 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </section>
      )}

      <DashboardHelpDialog open={showHelpDialog} variant="school_head" onClose={() => setShowHelpDialog(false)} />


      {/* ── School Info ── */}
      <section id="school-info" className={`mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4 ${focusCls("school-info")}`}>
        <article className="rounded-sm border border-slate-200 bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-500">Assigned School</p>
          <p className="mt-2 text-base font-semibold leading-snug text-slate-900">{schoolName}</p>
        </article>
        <article className="rounded-sm border border-slate-200 bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-500">School Code</p>
          <p className="mt-2 text-base font-semibold leading-snug text-slate-900">{schoolCode}</p>
        </article>
        <article className="rounded-sm border border-slate-200 bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-500">Address</p>
          <p className="mt-2 text-base font-semibold leading-snug text-slate-900">{schoolAddress}</p>
        </article>
        <article className="rounded-sm border border-slate-200 bg-white px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.5px] text-slate-500">Academic Year</p>
          <div className="relative mt-2">
            <select
              value={effectiveAcademicYearId}
              onChange={(event) => {
                void handleDashboardViewAcademicYearChange(event.target.value);
              }}
              className="w-full appearance-none rounded-sm border border-slate-300 bg-white px-3 py-2.5 pr-8 text-sm font-semibold text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-100"
              aria-label="Academic year filter"
            >
              {orderedAcademicYears.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-500">v</span>
          </div>
        </article>
      </section>

      {/* ── File Reports ── */}
      <section id="file-reports" className={`mb-8 ${focusCls("file-reports")}`}>
        <div className="rounded-sm border-2 border-primary-200 bg-primary-50/20 p-3 md:p-4">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-primary-200 pb-2">
            <div>
              <h2 className="text-[18px] font-semibold text-slate-900">Report View</h2>
              <p className="mt-1 text-xs text-slate-500">
                Saved workspace values appear here immediately. Final submitted packages are visible to the monitor.
              </p>
              {canShowReportSourceContext && (
                <div className="mt-2 space-y-1">
                  {submittedReportSourceContext.map((line) => (
                    <p key={line} className="text-xs text-slate-500">
                      {line}
                    </p>
                  ))}
                  {groupAReportView.sourceMode === "workspace_preview" && (
                    <p className="text-xs font-medium text-amber-700">
                      Saved locally for this school account. Not sent to the monitor until final submit.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {reportViewRenderState === "loading" && (
            <p className="mb-3 text-xs font-medium text-slate-500">
              {reportHydrationStatus === "retrying" ? reportHydrationError || "Retrying saved report details..." : "Loading saved report details..."}
            </p>
          )}
          {reportViewRenderState === "failed" && (
            <div className="mb-3 flex flex-col gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
              <span>{reportHydrationError || "Unable to load saved report details."}</span>
              <button
                type="button"
                onClick={retryReportDetailHydration}
                className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry loading saved report
              </button>
            </div>
          )}
          {reportViewRenderState === "empty" && (
            <div className="mb-3 space-y-1">
              <p className="text-xs font-medium text-slate-500">
                {buildSchoolHeadCurrentReportBlankStateLines()[0]}
              </p>
              <p className="text-xs text-slate-500">
                {buildSchoolHeadCurrentReportBlankStateLines()[1]}
              </p>
            </div>
          )}

          {isReportViewReady && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleSubmittedReportFiles.map((definition) => {
                  const reportFile = visibleSubmittedReportFileEntries[definition.type] ?? null;
                  const hasFile = Boolean(reportFile?.uploaded && reportFile?.originalFilename);
                  const buttonLabel = `View ${definition.shortLabel} Report`;

                  return (
                    <article key={definition.type} className="rounded-sm border border-slate-200 bg-white px-6 py-5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">{definition.shortLabel} Report</h3>
                      </div>

                      <dl className="mt-4 space-y-2">
                        <div className="flex items-start gap-2">
                          <dt className="w-24 shrink-0 text-xs font-medium text-slate-500">File</dt>
                          <dd className="truncate text-sm font-normal text-slate-900">{reportFile?.originalFilename ?? "- (none)"}</dd>
                        </div>
                        <div className="flex items-start gap-2">
                          <dt className="w-24 shrink-0 text-xs font-medium text-slate-500">Date</dt>
                          <dd className="text-sm font-normal text-slate-900">
                            {reportFile?.uploadedAt ? new Date(reportFile.uploadedAt).toLocaleDateString() : "-"}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={hasFile ? () => openReportModal(definition.type) : undefined}
                          disabled={!hasFile}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-primary-300 bg-primary-50 px-3 py-2.5 text-[13px] font-semibold text-primary-700 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary-50"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          {buttonLabel}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {secondarySubmittedReportFiles.length > 0 && (
                <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50/60 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-amber-900">Historical Extra Files</h3>
                    <p className="mt-1 text-xs text-amber-800">
                      These uploaded files are preserved for history, but they are not part of the active submitted report package for this school type.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {secondarySubmittedReportFiles.map((definition) => {
                      const reportFile = secondarySubmittedReportFileEntries[definition.type] ?? null;
                      const hasFile = Boolean(reportFile?.uploaded && reportFile?.originalFilename);
                      const buttonLabel = `View ${definition.shortLabel} Report`;

                      return (
                        <article key={`secondary-${definition.type}`} className="rounded-sm border border-amber-200 bg-white px-6 py-5">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">{definition.shortLabel} Report</h3>
                          </div>

                          <dl className="mt-4 space-y-2">
                            <div className="flex items-start gap-2">
                              <dt className="w-24 shrink-0 text-xs font-medium text-slate-500">File</dt>
                              <dd className="truncate text-sm font-normal text-slate-900">{reportFile?.originalFilename ?? "- (none)"}</dd>
                            </div>
                            <div className="flex items-start gap-2">
                              <dt className="w-24 shrink-0 text-xs font-medium text-slate-500">Date</dt>
                              <dd className="text-sm font-normal text-slate-900">
                                {reportFile?.uploadedAt ? new Date(reportFile.uploadedAt).toLocaleDateString() : "-"}
                              </dd>
                            </div>
                          </dl>

                          <div className="mt-4">
                            <button
                              type="button"
                              onClick={hasFile ? () => openReportModal(definition.type) : undefined}
                              disabled={!hasFile}
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-amber-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              {buttonLabel}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-6 overflow-hidden rounded-sm border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-base font-semibold text-slate-900">
              <div className="flex flex-col gap-1">
                <span className="inline-block border-l-[3px] border-primary-600 pl-3">
                  {reportViewTitle}
                </span>
                {isReportViewReady && groupAReportView.totalIndicators > 0 && (
                  <span className="pl-3 text-xs font-medium text-slate-500">
                    {groupAReportView.sourceMode === "workspace_preview" ? "Saved workspace" : "Submitted package"} completion: {groupAReportView.completedIndicators}/{groupAReportView.totalIndicators} complete
                  </span>
                )}
                {reportViewRenderState === "loading" && (
                  <span className="pl-3 text-xs font-medium text-slate-500">
                    {reportHydrationStatus === "retrying" ? "Retrying saved report details before showing values." : "Loading saved report details before showing values."}
                  </span>
                )}
                {reportViewRenderState === "failed" && (
                  <span className="pl-3 text-xs font-medium text-amber-700">
                    Unable to load saved report details.
                  </span>
                )}
                {reportViewRenderState === "empty" && (
                  <span className="pl-3 text-xs font-medium text-slate-500">
                    Reference table structure only. Saved values appear here after save or final submit.
                  </span>
                )}
              </div>
            </h2>
            {reportViewRenderState === "loading" && (
              <p className="p-4 text-xs font-medium text-slate-500">
                {reportHydrationStatus === "retrying"
                  ? "Retrying saved report details before showing TARGETS-MET values."
                  : "Loading saved report details before showing TARGETS-MET values."}
              </p>
            )}
            {reportViewRenderState === "failed" && (
              <div className="flex flex-col gap-3 p-4 text-xs font-medium text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                <span>{reportHydrationError || "Unable to load saved report details."}</span>
                <button
                  type="button"
                  onClick={retryReportDetailHydration}
                  className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 font-semibold text-amber-900 transition hover:bg-amber-100"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry loading saved report
                </button>
              </div>
            )}
            {reportViewRenderState === "empty" && (
              <p className="p-4 text-xs font-medium text-slate-500">
                Saved TARGETS-MET values will appear here after a successful workspace save.
              </p>
            )}
            {isReportViewReady && (
              <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
                {/* School's Achievement Table */}
                <div className="border border-slate-200 rounded-sm bg-white overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800">School&apos;s Achievement (SY {selectedReportYearLabel})</h3>
                  </div>
                  <table className="w-full text-[13px] text-slate-900">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Metric</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {groupAReportView.schoolAchievementRows.map((row) => (
                        <tr key={row.key}>
                          <td className={`px-4 py-2.5 text-slate-900 ${isSubItemMetric(row.label) ? "pl-9 text-[12px] italic font-medium text-slate-600" : ""}`}>
                            {row.label}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-900">
                            <span className="font-semibold text-slate-900">
                              {row.value}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Key Performance Indicators Table */}
                <div className="border border-slate-200 rounded-sm bg-white overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h3 className="text-sm font-semibold text-slate-800">Key Performance Indicators (SY {selectedReportYearLabel})</h3>
                  </div>
                  <table className="w-full text-[13px] text-slate-900">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                        <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Indicator</th>
                        <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Target</th>
                        <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Actual</th>
                        <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {groupAReportView.kpiRows.map((row) => (
                        <tr key={row.key}>
                          <td className="px-4 py-2.5 text-slate-900">{row.label}</td>
                          <td className="px-4 py-2.5 text-center text-slate-900">
                            <span className="font-semibold text-slate-900">
                              {row.target}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center text-slate-900">
                            <span className="font-semibold text-slate-900">
                              {row.actual}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center text-slate-900">
                            {row.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="border-t border-slate-200 p-4">
              <AuditTrailPanel
                id="school-head-recent-activity"
                compact
                title="Recent Activity"
                description="Private audit trail for this school and selected academic year."
                schoolId={selectedSchoolId || null}
                schoolCode={selectedSchoolId ? null : schoolCode}
                academicYearLabel={selectedReportYearLabel}
              />
            </div>
            <div className="border-t border-slate-200 p-4">
              <AuditTrailPanel
                id="school-head-security-activity"
                compact
                title="Security Activity"
                description="Private sign-in and account security activity for your account."
                eventPrefix="auth."
                ownEventsOnly
              />
            </div>
          </div>
        </div>
      </section>

      {activeReportModalType && activeReportFileEntry && (
        <>
          <button
            type="button"
            onClick={closeReportModal}
            className="fixed inset-0 z-[80] bg-slate-950/70 backdrop-blur-sm"
            aria-label="Close report preview"
          />
          <section className="fixed inset-3 z-[81] flex flex-col overflow-hidden rounded-sm border border-slate-300 bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                {(activeReportDefinition?.shortLabel ?? activeReportModalType.toUpperCase())} Report - SY {activeSchoolYearLabel}
              </h3>
              <div className="flex items-center gap-2">
                {activeReportExtension === "png" || activeReportExtension === "jpg" || activeReportExtension === "jpeg" || activeReportExtension === "webp" || activeReportExtension === "gif" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setReportZoomLevel((prev) => Math.max(0.5, Number((prev - 0.1).toFixed(2))))}
                      className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100"
                      aria-label="Zoom out"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportZoomLevel((prev) => Math.min(3, Number((prev + 0.1).toFixed(2))))}
                      className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100"
                      aria-label="Zoom in"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleDownloadActiveReport()}
                  className="inline-flex items-center gap-1 rounded-sm border border-primary-300 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={closeReportModal}
                  className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100"
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
              {activeReportPreviewError ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-600">
                  {activeReportPreviewError}
                </div>
              ) : !activeReportPreviewUrl ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-600">
                  Loading report preview...
                </div>
              ) : activeReportExtension === "pdf" ? (
                <iframe
                  title={`${activeReportDefinition?.shortLabel ?? activeReportModalType.toUpperCase()} PDF preview`}
                  src={activeReportPreviewUrl}
                  className="h-full w-full rounded-sm border border-slate-300 bg-white"
                />
              ) : activeReportExtension === "png" || activeReportExtension === "jpg" || activeReportExtension === "jpeg" || activeReportExtension === "webp" || activeReportExtension === "gif" ? (
                <div className="h-full overflow-auto rounded-sm border border-slate-300 bg-white p-4">
                  <img
                    src={activeReportPreviewUrl}
                    alt={`${activeReportDefinition?.shortLabel ?? activeReportModalType.toUpperCase()} report`}
                    className="max-w-none origin-top-left"
                    style={{ transform: `scale(${reportZoomLevel})` }}
                  />
                </div>
              ) : activeReportExtension === "xlsx" || activeReportExtension === "xls" || activeReportExtension === "csv" ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-600">
                  Spreadsheet preview is not available in the browser. Use Download to open the uploaded file.
                </div>
              ) : (
                <iframe
                  title={`${activeReportDefinition?.shortLabel ?? activeReportModalType.toUpperCase()} report preview`}
                  src={activeReportPreviewUrl}
                  className="h-full w-full rounded-sm border border-slate-300 bg-white"
                />
              )}
            </div>
          </section>
        </>
      )}
      <section id="imeta-compliance" className={focusCls("imeta-compliance")}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
              Submission Workspace
            </h2>
          </div>
        </div>
        <SchoolIndicatorPanel
          initialAcademicYearId={currentAcademicYearOption?.id ?? ""}
          selectedAcademicYearId={effectiveAcademicYearId}
          onAcademicYearChange={handleDashboardViewAcademicYearChange}
          onWorkspaceSubmissionHydrated={handleWorkspaceSubmissionHydrated}
        />
      </section>
      </div>
    </Shell>
  );
}





