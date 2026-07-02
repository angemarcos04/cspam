export type SchoolCoverageToken = "elementary" | "junior_high" | "senior_high";
export type SchoolLevelToken = SchoolCoverageToken | "high_school" | "unknown";

export interface SchoolCoverageOption {
  token: SchoolCoverageToken;
  label: string;
}

export interface SchoolCoverageParseResult {
  tokens: SchoolCoverageToken[];
  legacyHighSchool: boolean;
  unknownLabel: string | null;
}

export const SCHOOL_COVERAGE_OPTIONS: SchoolCoverageOption[] = [
  { token: "elementary", label: "Elementary" },
  { token: "junior_high", label: "Junior High" },
  { token: "senior_high", label: "Senior High" },
];

export const CANONICAL_SCHOOL_COVERAGE_VALUES = [
  "Elementary",
  "Junior High",
  "Senior High",
  "Elementary / Junior High",
  "Elementary / Senior High",
  "Junior High / Senior High",
  "Elementary / Junior High / Senior High",
  "High School",
] as const;

const COVERAGE_LABEL_BY_TOKEN: Record<SchoolCoverageToken, string> = {
  elementary: "Elementary",
  junior_high: "Junior High",
  senior_high: "Senior High",
};

const COVERAGE_ORDER: SchoolCoverageToken[] = ["elementary", "junior_high", "senior_high"];

function normalizeSchoolCoverageText(value: string | null | undefined): string {
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

function tokenForPart(part: string): SchoolCoverageToken | "legacy_high_school" | null {
  const normalized = normalizeSchoolCoverageText(part);

  if (!normalized) return null;
  if (normalized === "elementary" || normalized === "elem") return "elementary";
  if (normalized === "junior high" || normalized === "junior high school" || normalized === "jhs") return "junior_high";
  if (normalized === "senior high" || normalized === "senior high school" || normalized === "shs") return "senior_high";
  if (normalized === "high school" || normalized === "secondary") return "legacy_high_school";

  return null;
}

export function parseSchoolCoverage(value: string | null | undefined): SchoolCoverageParseResult {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return { tokens: [], legacyHighSchool: false, unknownLabel: null };
  }

  const tokenSet = new Set<SchoolCoverageToken>();
  let legacyHighSchool = false;
  let unknownLabel: string | null = null;
  const parts = raw.split(/\s*(?:\/|,|&|\+|\|)\s*/).filter((part) => part.trim().length > 0);

  for (const part of parts.length > 0 ? parts : [raw]) {
    const token = tokenForPart(part);
    if (token === "legacy_high_school") {
      legacyHighSchool = true;
      continue;
    }
    if (token) {
      tokenSet.add(token);
      continue;
    }
    unknownLabel = unknownLabel ?? part.trim();
  }

  return {
    tokens: COVERAGE_ORDER.filter((token) => tokenSet.has(token)),
    legacyHighSchool,
    unknownLabel,
  };
}

export function coverageTokensToStoredLevel(tokens: SchoolCoverageToken[]): string {
  const tokenSet = new Set(tokens);
  return COVERAGE_ORDER
    .filter((token) => tokenSet.has(token))
    .map((token) => COVERAGE_LABEL_BY_TOKEN[token])
    .join(" / ");
}

export function formatSchoolCoverageLabel(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "N/A";

  const parsed = parseSchoolCoverage(raw);
  if (parsed.tokens.length > 0) {
    return coverageTokensToStoredLevel(parsed.tokens);
  }
  if (parsed.legacyHighSchool && !parsed.unknownLabel) {
    return "High School";
  }
  if (parsed.unknownLabel) {
    return titleCaseLabel(normalizeSchoolCoverageText(parsed.unknownLabel));
  }

  return "N/A";
}

export function isLegacyHighSchoolCoverage(value: string | null | undefined): boolean {
  const parsed = parseSchoolCoverage(value);
  return parsed.legacyHighSchool && parsed.tokens.length === 0 && parsed.unknownLabel === null;
}

export function hasSchoolCoverageToken(value: string | null | undefined, token: SchoolCoverageToken): boolean {
  return parseSchoolCoverage(value).tokens.includes(token);
}

export function normalizeSchoolLevelToken(value: string | null | undefined): SchoolLevelToken {
  const parsed = parseSchoolCoverage(value);
  if (parsed.tokens.length === 1) return parsed.tokens[0];
  if (parsed.legacyHighSchool) return "high_school";
  return "unknown";
}

export const formatSchoolLevelLabel = formatSchoolCoverageLabel;
