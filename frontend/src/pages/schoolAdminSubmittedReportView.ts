import {
  resolveSubmissionItemDisplayValue,
  resolveSubmissionItemSelectedYearRawValue,
} from "@/pages/monitor/monitorDrawerViewModelUtils";
import {
  resolveExactSubmissionItemByMetricCode,
  resolveSubmissionSchoolId,
} from "@/utils/submissionRequirements";
import type {
  IndicatorSubmission,
  IndicatorSubmissionFiles,
  IndicatorSubmissionItem,
} from "@/types";

export function safeSubmissionTimestamp(value: string | null | undefined): number {
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function isFinalizedSubmissionStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "submitted" || normalized === "validated";
}

export function isSchoolHeadCurrentReportStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "draft" || normalized === "returned" || isFinalizedSubmissionStatus(normalized);
}

export function isSchoolHeadWorkspacePreviewStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "draft" || normalized === "returned";
}

export type SchoolHeadReportSourceMode = "workspace_preview" | "submitted";

export function resolveSchoolHeadReportSourceMode(
  submission: IndicatorSubmission | null | undefined,
): SchoolHeadReportSourceMode | null {
  if (!submission || !isSchoolHeadCurrentReportStatus(submission.status)) {
    return null;
  }

  return isSchoolHeadWorkspacePreviewStatus(submission.status) ? "workspace_preview" : "submitted";
}

export function submittedReportLineageTimestamp(submission: IndicatorSubmission): number {
  return safeSubmissionTimestamp(submission.submittedAt)
    || safeSubmissionTimestamp(submission.reviewedAt)
    || safeSubmissionTimestamp(submission.updatedAt)
    || safeSubmissionTimestamp(submission.createdAt);
}

export function submittedReportRecencyScore(submission: IndicatorSubmission): number {
  const timestamp = submittedReportLineageTimestamp(submission);
  const version = Number(submission.version ?? 0);
  return (Number.isFinite(timestamp) ? timestamp : 0) * 1_000 + (Number.isFinite(version) ? version : 0);
}

export function compareSelectedYearFinalizedReportSubmissions(
  left: IndicatorSubmission,
  right: IndicatorSubmission,
): number {
  const recencyDelta = submittedReportRecencyScore(right) - submittedReportRecencyScore(left);
  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  const updatedDelta = safeSubmissionTimestamp(right.updatedAt) - safeSubmissionTimestamp(left.updatedAt);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

export function resolvePreferredSubmittedReportAcademicYearId(
  entries: IndicatorSubmission[],
  selectedSchoolId: string,
): string | null {
  const finalizedEntries = entries
    .filter((entry) => isFinalizedSubmissionStatus(entry.status))
    .filter((entry) => (
      selectedSchoolId.length === 0
      || resolveSubmissionSchoolId(entry) === selectedSchoolId
    ))
    .slice()
    .sort(compareSelectedYearFinalizedReportSubmissions);

  return finalizedEntries[0]?.academicYear?.id ?? null;
}

export function resolvePreferredSchoolHeadCurrentReportAcademicYearId(
  entries: IndicatorSubmission[],
  selectedSchoolId: string,
): string | null {
  const eligibleEntries = entries
    .filter((entry) => isSchoolHeadCurrentReportStatus(entry.status))
    .filter((entry) => (
      selectedSchoolId.length === 0
      || resolveSubmissionSchoolId(entry) === selectedSchoolId
    ))
    .filter((entry) => String(entry.academicYear?.id ?? "").trim() !== "")
    .slice()
    .sort(compareSelectedYearSchoolHeadCurrentReportSubmissions);

  return eligibleEntries[0]?.academicYear?.id ?? null;
}

export function resolveSelectedYearReportSubmission(entries: IndicatorSubmission[]): IndicatorSubmission | null {
  const finalizedEntries = entries.filter((entry) => isFinalizedSubmissionStatus(entry.status));
  if (finalizedEntries.length === 0) {
    return null;
  }

  const ranked = finalizedEntries.slice().sort(compareSelectedYearFinalizedReportSubmissions);

  return ranked[0] ?? null;
}

export function schoolHeadCurrentReportRecencyScore(submission: IndicatorSubmission): number {
  const timestamp = isSchoolHeadWorkspacePreviewStatus(submission.status)
    ? (
      safeSubmissionTimestamp(submission.updatedAt)
      || safeSubmissionTimestamp(submission.createdAt)
      || safeSubmissionTimestamp(submission.submittedAt)
      || safeSubmissionTimestamp(submission.reviewedAt)
    )
    : submittedReportLineageTimestamp(submission);
  const version = Number(submission.version ?? 0);
  return (Number.isFinite(timestamp) ? timestamp : 0) * 1_000 + (Number.isFinite(version) ? version : 0);
}

export function compareSelectedYearSchoolHeadCurrentReportSubmissions(
  left: IndicatorSubmission,
  right: IndicatorSubmission,
): number {
  const recencyDelta = schoolHeadCurrentReportRecencyScore(right) - schoolHeadCurrentReportRecencyScore(left);
  if (recencyDelta !== 0) {
    return recencyDelta;
  }

  return String(right.id ?? "").localeCompare(String(left.id ?? ""));
}

export function resolveSelectedYearSchoolHeadCurrentReportSubmission(entries: IndicatorSubmission[]): IndicatorSubmission | null {
  const eligibleEntries = entries.filter((entry) => isSchoolHeadCurrentReportStatus(entry.status));
  if (eligibleEntries.length === 0) {
    return null;
  }

  const ranked = eligibleEntries.slice().sort(compareSelectedYearSchoolHeadCurrentReportSubmissions);
  return ranked[0] ?? null;
}

export function resolveSubmittedReportSubmissionForView(
  submission: IndicatorSubmission | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): IndicatorSubmission | null {
  if (!submission || !isFinalizedSubmissionStatus(submission.status)) {
    return null;
  }

  const selectedSchoolId = String(options.selectedSchoolId ?? "").trim();
  if (selectedSchoolId && resolveSubmissionSchoolId(submission) !== selectedSchoolId) {
    return null;
  }

  const selectedAcademicYearId = String(options.selectedAcademicYearId ?? "").trim();
  if (
    selectedAcademicYearId
    && selectedAcademicYearId !== "all"
    && String(submission.academicYear?.id ?? "").trim() !== selectedAcademicYearId
  ) {
    return null;
  }

  return submission;
}

export function resolveSchoolHeadCurrentReportSubmissionForView(
  submission: IndicatorSubmission | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): IndicatorSubmission | null {
  if (!submission || !isSchoolHeadCurrentReportStatus(submission.status)) {
    return null;
  }

  const selectedSchoolId = String(options.selectedSchoolId ?? "").trim();
  if (selectedSchoolId && resolveSubmissionSchoolId(submission) !== selectedSchoolId) {
    return null;
  }

  const selectedAcademicYearId = String(options.selectedAcademicYearId ?? "").trim();
  if (
    selectedAcademicYearId
    && selectedAcademicYearId !== "all"
    && String(submission.academicYear?.id ?? "").trim() !== selectedAcademicYearId
  ) {
    return null;
  }

  return submission;
}

export function submissionRows(submission: IndicatorSubmission | null | undefined): IndicatorSubmissionItem[] {
  if (!submission) {
    return [];
  }

  const directIndicators = Array.isArray(submission.indicators) ? submission.indicators : [];
  if (directIndicators.length > 0) {
    return directIndicators;
  }

  return Array.isArray(submission.items) ? submission.items : [];
}

export function submissionHasRenderableIndicatorDetails(submission: IndicatorSubmission | null | undefined): boolean {
  return submissionRows(submission).some((item) => {
    const metricCode = String(item.metric?.code ?? "").trim();
    const metricName = String(item.metric?.name ?? "").trim();
    return metricCode.length > 0 || metricName.length > 0;
  });
}

export function submissionFilesHaveRenderableReportDetails(files: IndicatorSubmissionFiles | null | undefined): boolean {
  return Object.values(files ?? {}).some((entry) => {
    if (!entry) {
      return false;
    }

    return Boolean(
      entry.uploaded
      || String(entry.originalFilename ?? "").trim()
      || String(entry.viewUrl ?? "").trim()
      || String(entry.downloadUrl ?? "").trim(),
    );
  });
}

export function submissionHasRenderableReportDetails(submission: IndicatorSubmission | null | undefined): boolean {
  return submissionHasRenderableIndicatorDetails(submission)
    || submissionFilesHaveRenderableReportDetails(submission?.files);
}

export const TARGETS_MET_SCHOOL_ACHIEVEMENT_ROWS = [
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

export const TARGETS_MET_KPI_ROWS = [
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

const TARGETS_MET_METRIC_KEYS = {
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

const TARGETS_MET_METRIC_CODES = {
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

const TARGETS_MET_METRIC_CODE_ALIASES = {
  schoolAchievement: {
    school_head_name: ["SALO"],
  },
  kpi: {},
} as const;

export function normalizeMetricLookupKey(label: string | null | undefined): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TARGETS_MET_NORMALIZED_METRIC_CODES = {
  schoolAchievement: Object.fromEntries(
    Object.entries(TARGETS_MET_METRIC_CODES.schoolAchievement).map(([key, code]) => [
      key,
      normalizeMetricLookupKey(code),
    ]),
  ) as Record<keyof typeof TARGETS_MET_METRIC_CODES.schoolAchievement, string>,
  kpi: Object.fromEntries(
    Object.entries(TARGETS_MET_METRIC_CODES.kpi).map(([key, code]) => [
      key,
      normalizeMetricLookupKey(code),
    ]),
  ) as Record<keyof typeof TARGETS_MET_METRIC_CODES.kpi, string>,
};

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

  if (hasIndicatorDisplayValue(indicator.actualTypedValue)) score += 8;
  if (hasIndicatorDisplayValue(indicator.actualDisplay)) score += 4;
  if (hasIndicatorDisplayValue(indicator.actualValue)) score += 2;
  if (hasIndicatorDisplayValue(indicator.targetTypedValue)) score += 4;
  if (hasIndicatorDisplayValue(indicator.targetDisplay)) score += 2;
  if (hasIndicatorDisplayValue(indicator.targetValue)) score += 1;

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
  group: keyof typeof TARGETS_MET_METRIC_KEYS,
  key: string,
): IndicatorSubmissionItem | null {
  const groupCodeMappings: Record<string, string> =
    group === "schoolAchievement"
      ? TARGETS_MET_NORMALIZED_METRIC_CODES.schoolAchievement
      : TARGETS_MET_NORMALIZED_METRIC_CODES.kpi;
  const expectedMetricCode = groupCodeMappings[key];

  const groupAliasMappings: Record<string, readonly string[] | undefined> =
    group === "schoolAchievement"
      ? TARGETS_MET_METRIC_CODE_ALIASES.schoolAchievement
      : TARGETS_MET_METRIC_CODE_ALIASES.kpi;
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

  const nameAliases = (TARGETS_MET_METRIC_KEYS[group] as Record<string, readonly string[]>)[key] ?? [];
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

export interface TargetsMetSchoolAchievementReportRow {
  key: string;
  label: string;
  indicator: IndicatorSubmissionItem | null;
  value: string;
}

export interface TargetsMetKpiReportRow {
  key: string;
  label: string;
  indicator: IndicatorSubmissionItem | null;
  target: string;
  actual: string;
  status: string;
}

export interface TargetsMetReportViewRows {
  schoolAchievementRows: TargetsMetSchoolAchievementReportRow[];
  kpiRows: TargetsMetKpiReportRow[];
  getIndicatorByGroupAKey: (
    group: keyof typeof TARGETS_MET_METRIC_KEYS,
    key: string,
  ) => IndicatorSubmissionItem | null;
}

export function buildTargetsMetReportViewRows(
  indicators: IndicatorSubmissionItem[],
  selectedYearLabel: string | null | undefined,
  options?: {
    showSchoolAchievements?: boolean;
    showKeyPerformance?: boolean;
  },
): TargetsMetReportViewRows {
  const showSchoolAchievements = options?.showSchoolAchievements ?? true;
  const showKeyPerformance = options?.showKeyPerformance ?? true;
  const getIndicatorByGroupAKey = (
    group: keyof typeof TARGETS_MET_METRIC_KEYS,
    key: string,
  ): IndicatorSubmissionItem | null => resolveCurrentReportIndicatorByGroupAKey(indicators, group, key);

  const schoolAchievementRows = TARGETS_MET_SCHOOL_ACHIEVEMENT_ROWS.map<TargetsMetSchoolAchievementReportRow>((row) => {
    const indicator = showSchoolAchievements ? getIndicatorByGroupAKey("schoolAchievement", row.key) : null;
    return {
      key: row.key,
      label: row.label,
      indicator,
      value: indicator ? resolveIndicatorValue(indicator, "actual", selectedYearLabel) : "-",
    };
  });

  const kpiRows = TARGETS_MET_KPI_ROWS.map<TargetsMetKpiReportRow>((row) => {
    const indicator = showKeyPerformance ? getIndicatorByGroupAKey("kpi", row.key) : null;
    return {
      key: row.key,
      label: row.label,
      indicator,
      target: indicator ? resolveIndicatorValue(indicator, "target", selectedYearLabel, { strictSelectedYear: true }) : "-",
      actual: indicator ? resolveIndicatorValue(indicator, "actual", selectedYearLabel, { strictSelectedYear: true }) : "-",
      status: indicator ? formatKpiComplianceStatusForSelectedYear(indicator, selectedYearLabel) : "-",
    };
  });

  return {
    schoolAchievementRows,
    kpiRows,
    getIndicatorByGroupAKey,
  };
}

export function buildTargetsMetReportViewRowsForSubmission(
  submission: IndicatorSubmission | null | undefined,
  selectedYearLabel: string | null | undefined,
  options?: {
    showSchoolAchievements?: boolean;
    showKeyPerformance?: boolean;
  },
): TargetsMetReportViewRows & { indicators: IndicatorSubmissionItem[] } {
  const indicators = submissionRows(submission);
  return {
    indicators,
    ...buildTargetsMetReportViewRows(indicators, selectedYearLabel, options),
  };
}

function mergeHydratedReportDetailsForSameSubmission(
  selectedSubmission: IndicatorSubmission,
  hydratedSubmission: IndicatorSubmission,
): IndicatorSubmission {
  if (!submissionHasRenderableReportDetails(selectedSubmission)) {
    return hydratedSubmission;
  }

  const selectedRows = submissionRows(selectedSubmission);
  const hydratedRows = submissionRows(hydratedSubmission);
  const rowsSource = hydratedRows.length > 0 ? hydratedSubmission : selectedSubmission;
  const filesSource = submissionFilesHaveRenderableReportDetails(hydratedSubmission.files)
    ? hydratedSubmission
    : selectedSubmission;

  return {
    ...selectedSubmission,
    indicators: rowsSource.indicators,
    items: Array.isArray(rowsSource.items) && rowsSource.items.length > 0
      ? rowsSource.items
      : rowsSource.indicators,
    files: filesSource.files ?? selectedSubmission.files,
    completion: filesSource.completion ?? selectedSubmission.completion,
    presentation: filesSource.presentation ?? selectedSubmission.presentation,
  };
}

export function resolveStableSubmittedReportViewSubmission(
  selectedSubmission: IndicatorSubmission | null | undefined,
  hydratedSubmission: IndicatorSubmission | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): IndicatorSubmission | null {
  const eligibleSelectedSubmission = resolveSubmittedReportSubmissionForView(selectedSubmission, options);
  const eligibleHydratedSubmission = resolveSubmittedReportSubmissionForView(hydratedSubmission, options);

  if (
    eligibleSelectedSubmission
    && eligibleHydratedSubmission
    && String(eligibleSelectedSubmission.id ?? "").trim() === String(eligibleHydratedSubmission.id ?? "").trim()
    && submissionHasRenderableReportDetails(eligibleHydratedSubmission)
  ) {
    return mergeHydratedReportDetailsForSameSubmission(eligibleSelectedSubmission, eligibleHydratedSubmission);
  }

  const preferredSubmission = resolveSelectedYearReportSubmission(
    [eligibleSelectedSubmission, eligibleHydratedSubmission].filter((entry): entry is IndicatorSubmission => Boolean(entry)),
  );

  if (
    eligibleHydratedSubmission
    && preferredSubmission
    && eligibleHydratedSubmission.id === preferredSubmission.id
    && submissionHasRenderableReportDetails(eligibleHydratedSubmission)
  ) {
    return eligibleHydratedSubmission;
  }

  return eligibleSelectedSubmission;
}

export function resolveStableSchoolHeadCurrentReportViewSubmission(
  selectedSubmission: IndicatorSubmission | null | undefined,
  hydratedSubmission: IndicatorSubmission | null | undefined,
  options: {
    selectedSchoolId: string | null | undefined;
    selectedAcademicYearId: string | null | undefined;
  },
): IndicatorSubmission | null {
  const eligibleSelectedSubmission = resolveSchoolHeadCurrentReportSubmissionForView(selectedSubmission, options);
  const eligibleHydratedSubmission = resolveSchoolHeadCurrentReportSubmissionForView(hydratedSubmission, options);

  if (
    eligibleSelectedSubmission
    && eligibleHydratedSubmission
    && String(eligibleSelectedSubmission.id ?? "").trim() === String(eligibleHydratedSubmission.id ?? "").trim()
    && submissionHasRenderableReportDetails(eligibleHydratedSubmission)
  ) {
    return mergeHydratedReportDetailsForSameSubmission(eligibleSelectedSubmission, eligibleHydratedSubmission);
  }

  const preferredSubmission = resolveSelectedYearSchoolHeadCurrentReportSubmission(
    [eligibleSelectedSubmission, eligibleHydratedSubmission].filter((entry): entry is IndicatorSubmission => Boolean(entry)),
  );

  if (
    eligibleHydratedSubmission
    && preferredSubmission
    && eligibleHydratedSubmission.id === preferredSubmission.id
    && submissionHasRenderableReportDetails(eligibleHydratedSubmission)
  ) {
    return eligibleHydratedSubmission;
  }

  return eligibleSelectedSubmission;
}

export function resolveSubmittedReportIndicatorByMetricCode(
  indicators: IndicatorSubmissionItem[],
  expectedMetricCode: string | null | undefined,
): IndicatorSubmissionItem | null {
  return resolveExactSubmissionItemByMetricCode(indicators, expectedMetricCode);
}

export function buildSubmittedReportBlankStateLines(): [string, string] {
  return [
    "No finalized submitted report package exists yet for the selected academic year.",
    "The report tables are shown for reference. Finalized values will appear here after you submit the package.",
  ];
}

export function buildSchoolHeadCurrentReportBlankStateLines(): [string, string] {
  return [
    "No saved School Head report package exists yet for the selected academic year.",
    "The report tables are shown for reference. Saved values will appear here after you save or final-submit the package.",
  ];
}

export function buildSubmittedReportSourceContext(
  submission: IndicatorSubmission | null | undefined,
  selectedReportYearLabel: string,
): string[] {
  const lines = [`Viewing finalized submitted report for SY ${selectedReportYearLabel}.`];

  if (!submission?.id) {
    lines.push("Source package: None yet.");
    lines.push("Status: Reference only.");
    return lines;
  }

  const packageId = String(submission.id ?? "").trim();
  const statusLabel = String(submission.statusLabel ?? submission.status ?? "").trim() || "Submitted";
  lines.push(`Source package: #${packageId} (${statusLabel}).`);

  const submittedAtLabel = submission.submittedAt
    ? new Date(submission.submittedAt).toLocaleDateString()
    : null;
  if (submittedAtLabel) {
    lines.push(`Submitted: ${submittedAtLabel}.`);
  }

  return lines;
}

export function buildSchoolHeadCurrentReportSourceContext(
  submission: IndicatorSubmission | null | undefined,
  selectedReportYearLabel: string,
): string[] {
  const sourceMode = resolveSchoolHeadReportSourceMode(submission);
  const lines = [
    sourceMode === "workspace_preview"
      ? `Viewing saved workspace preview for SY ${selectedReportYearLabel}.`
      : `Viewing submitted School Head report for SY ${selectedReportYearLabel}.`,
  ];

  if (!submission?.id) {
    lines.push("Source package: None yet.");
    lines.push("Status: Reference only.");
    return lines;
  }

  const packageId = String(submission.id ?? "").trim();
  const statusLabel = String(submission.statusLabel ?? submission.status ?? "").trim() || "Submitted";
  lines.push(`Source package: #${packageId} (${statusLabel}).`);

  const timestampLabel = sourceMode === "workspace_preview"
    ? submission.updatedAt || submission.createdAt
    : submission.submittedAt || submission.reviewedAt;
  const timestampPrefix = sourceMode === "workspace_preview"
    ? "Saved"
    : (submission.submittedAt ? "Submitted" : "Reviewed");
  const renderedLabel = timestampLabel
    ? new Date(timestampLabel).toLocaleDateString()
    : null;
  if (renderedLabel) {
    lines.push(`${timestampPrefix}: ${renderedLabel}.`);
  }

  return lines;
}

export function resolveIndicatorValue(
  indicator: IndicatorSubmissionItem | null | undefined,
  kind: "target" | "actual",
  selectedYear?: string | null,
  options?: { strictSelectedYear?: boolean },
): string {
  return resolveSubmissionItemDisplayValue(indicator, kind, {
    selectedYear,
    strictSelectedYear: options?.strictSelectedYear,
  });
}

export function resolveIndicatorSelectedYearRawValue(
  indicator: IndicatorSubmissionItem | null | undefined,
  kind: "target" | "actual",
  selectedYear?: string | null,
): unknown {
  return resolveSubmissionItemSelectedYearRawValue(indicator, kind, selectedYear);
}
