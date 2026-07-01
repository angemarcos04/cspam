export type SchoolLevelToken = "elementary" | "high_school" | "junior_high" | "senior_high" | "unknown";

export const BACKEND_SUPPORTED_SCHOOL_LEVEL_OPTIONS = ["Elementary", "High School"] as const;

export type BackendSupportedSchoolLevel = (typeof BACKEND_SUPPORTED_SCHOOL_LEVEL_OPTIONS)[number];

function normalizeSchoolLevelText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function titleCaseLabel(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeSchoolLevelToken(value: string | null | undefined): SchoolLevelToken {
  const normalized = normalizeSchoolLevelText(value);

  if (!normalized) return "unknown";
  if (normalized === "elementary") return "elementary";
  if (normalized === "high school" || normalized === "secondary") return "high_school";
  if (normalized === "junior high" || normalized === "junior high school" || normalized === "jhs") return "junior_high";
  if (normalized === "senior high" || normalized === "senior high school" || normalized === "shs") return "senior_high";

  return "unknown";
}

export function formatSchoolLevelLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "N/A";

  const token = normalizeSchoolLevelToken(raw);
  if (token === "elementary") return "Elementary";
  if (token === "high_school") return "High School";
  if (token === "junior_high") return "Junior High";
  if (token === "senior_high") return "Senior High";

  return titleCaseLabel(normalizeSchoolLevelText(raw));
}

export function coerceBackendSupportedSchoolLevel(
  value: string | null | undefined,
  fallback: BackendSupportedSchoolLevel = "Elementary",
): BackendSupportedSchoolLevel {
  const token = normalizeSchoolLevelToken(value);

  if (token === "elementary") return "Elementary";
  if (token === "high_school") return "High School";

  return fallback;
}
