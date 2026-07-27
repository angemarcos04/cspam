import type { SchoolRecord } from "@/types";

export interface SchoolIdentity {
  id?: string | number | null;
  schoolId?: string | number | null;
  schoolCode?: string | number | null;
}

export interface ReviewInboxSchoolIdentityRow {
  schoolKey: string;
  schoolId?: string;
  schoolCode: string;
  schoolName: string;
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
  const recordId = normalizeSchoolIdentityValue(record.id);
  const recordSchoolId = normalizeSchoolIdentityValue(record.schoolId);
  const recordSchoolCode = normalizeSchoolIdentityValue(record.schoolCode);
  const identityId = normalizeSchoolIdentityValue(identity.id);
  const identitySchoolId = normalizeSchoolIdentityValue(identity.schoolId);
  const identitySchoolCode = normalizeSchoolIdentityValue(identity.schoolCode);

  if (identityId && recordId === identityId) {
    return true;
  }

  if (
    identitySchoolCode
    && (recordSchoolCode === identitySchoolCode || recordSchoolId === identitySchoolCode)
  ) {
    return true;
  }

  return Boolean(
    identitySchoolId
    && (recordSchoolId === identitySchoolId || recordSchoolCode === identitySchoolId),
  );
}

export function schoolIdentitiesMatch(
  left: SchoolIdentity,
  right: SchoolIdentity,
): boolean {
  const leftId = normalizeSchoolIdentityValue(left.id);
  const rightId = normalizeSchoolIdentityValue(right.id);
  if (leftId && rightId && leftId === rightId) {
    return true;
  }

  const leftCodes = [
    normalizeSchoolIdentityValue(left.schoolCode),
    normalizeSchoolIdentityValue(left.schoolId),
  ].filter(Boolean);
  const rightCodes = new Set([
    normalizeSchoolIdentityValue(right.schoolCode),
    normalizeSchoolIdentityValue(right.schoolId),
  ].filter(Boolean));

  return leftCodes.some((value) => rightCodes.has(value));
}

export function reviewInboxRowMatchesSchoolIdentity(
  row: Pick<ReviewInboxSchoolIdentityRow, "schoolKey" | "schoolId" | "schoolCode" | "schoolName">,
  identity: SchoolIdentity,
): boolean {
  const rowId = normalizeSchoolIdentityValue(row.schoolId);
  const identityId = normalizeSchoolIdentityValue(identity.id);
  if (rowId && identityId && rowId === identityId) {
    return true;
  }

  const rowSchoolCode = normalizeSchoolIdentityValue(row.schoolCode);
  const identityCodes = new Set([
    normalizeSchoolIdentityValue(identity.schoolCode),
    normalizeSchoolIdentityValue(identity.schoolId),
  ].filter(Boolean));

  if (rowSchoolCode && identityCodes.has(rowSchoolCode)) {
    return true;
  }

  const schoolKey = normalizeSchoolIdentityValue(row.schoolKey).toLowerCase();
  if (schoolKey.startsWith("code:")) {
    const keyCode = schoolKey.slice("code:".length);
    return [...identityCodes].some((value) => value.toLowerCase() === keyCode);
  }

  if (schoolKey.startsWith("id:")) {
    return Boolean(identityId && schoolKey.slice("id:".length) === identityId.toLowerCase());
  }

  return false;
}
