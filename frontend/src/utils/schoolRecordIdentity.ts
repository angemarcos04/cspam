import type { SchoolRecord } from "@/types";

export interface SchoolIdentity {
  id?: string | number | null;
  schoolId?: string | number | null;
  schoolCode?: string | number | null;
}

export function normalizeSchoolIdentityValue(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export function schoolRecordMatchesIdentity(
  record: Pick<SchoolRecord, "id" | "schoolId" | "schoolCode">,
  identity: SchoolIdentity,
): boolean {
  const recordValues = [
    normalizeSchoolIdentityValue(record.id),
    normalizeSchoolIdentityValue(record.schoolId),
    normalizeSchoolIdentityValue(record.schoolCode),
  ].filter((value) => value !== "");
  const identityValues = [
    normalizeSchoolIdentityValue(identity.id),
    normalizeSchoolIdentityValue(identity.schoolId),
    normalizeSchoolIdentityValue(identity.schoolCode),
  ].filter((value) => value !== "");

  if (recordValues.length === 0 || identityValues.length === 0) {
    return false;
  }

  const recordValueSet = new Set(recordValues);
  return identityValues.some((value) => recordValueSet.has(value));
}
