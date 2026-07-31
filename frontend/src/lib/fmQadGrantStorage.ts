import type { FmQadDownloadedVersionGrant } from "@/types/fmQadTemplates";

export const FM_QAD_GRANT_STORAGE_PREFIX = "cspams:fm-qad-grant:";

export interface FmQadGrantStorageScope {
  userId: string;
  schoolId: string;
  academicYearId: string;
  scopeId: string;
}

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function fmQadGrantStorageKey(input: FmQadGrantStorageScope): string {
  return [
    FM_QAD_GRANT_STORAGE_PREFIX.slice(0, -1),
    input.userId,
    input.schoolId,
    input.academicYearId,
    input.scopeId,
  ].join(":");
}

export function storeFmQadGrant(
  input: FmQadGrantStorageScope,
  grant: FmQadDownloadedVersionGrant,
): void {
  try {
    sessionStorageOrNull()?.setItem(fmQadGrantStorageKey(input), JSON.stringify(grant));
  } catch {
    // Storage is continuity only; the backend grant remains authoritative.
  }
}

export function removeStoredFmQadGrant(input: FmQadGrantStorageScope): void {
  try {
    sessionStorageOrNull()?.removeItem(fmQadGrantStorageKey(input));
  } catch {
    // Ignore restricted browser storage.
  }
}

export function readStoredFmQadGrants(input: Omit<FmQadGrantStorageScope, "scopeId">): Map<string, FmQadDownloadedVersionGrant> {
  const grants = new Map<string, FmQadDownloadedVersionGrant>();
  const storage = sessionStorageOrNull();
  if (!storage) return grants;

  const prefix = [
    FM_QAD_GRANT_STORAGE_PREFIX.slice(0, -1),
    input.userId,
    input.schoolId,
    input.academicYearId,
    "",
  ].join(":");

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;

      try {
        const grant = JSON.parse(storage.getItem(key) ?? "") as FmQadDownloadedVersionGrant;
        const expectedKey = fmQadGrantStorageKey({
          ...input,
          scopeId: grant.scopeId,
        });
        if (
          key === expectedKey
          && grant.schoolId === input.schoolId
          && grant.academicYearId === input.academicYearId
        ) {
          grants.set(grant.scopeId, grant);
        } else {
          storage.removeItem(key);
        }
      } catch {
        storage.removeItem(key);
      }
    }
  } catch {
    return new Map();
  }

  return grants;
}
