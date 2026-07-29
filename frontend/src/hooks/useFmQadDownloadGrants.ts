import { useCallback, useEffect, useState } from "react";
import type { FmQadDownloadedVersionGrant, FmQadTemplateVersion } from "@/types/fmQadTemplates";

const STORAGE_PREFIX = "cspams.fm-qad-download-grant";

function storageKey(userId: string, schoolId: string, academicYearId: string, scopeId: string) {
  return `${STORAGE_PREFIX}:${userId}:${schoolId}:${academicYearId}:${scopeId}`;
}

export function useFmQadDownloadGrants(userId: string, schoolId: string, academicYearId: string) {
  const [grantsByScope, setGrantsByScope] = useState<Record<string, FmQadDownloadedVersionGrant>>({});

  useEffect(() => {
    const next: Record<string, FmQadDownloadedVersionGrant> = {};
    if (typeof window !== "undefined" && userId && schoolId && academicYearId) {
      const prefix = `${STORAGE_PREFIX}:${userId}:${schoolId}:${academicYearId}:`;
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try {
          const grant = JSON.parse(window.localStorage.getItem(key) ?? "") as FmQadDownloadedVersionGrant;
          if (
            grant.grantId
            && grant.userId === userId
            && grant.schoolId === schoolId
            && grant.academicYearId === academicYearId
            && grant.scopeId
          ) {
            next[grant.scopeId] = grant;
          }
        } catch {
          window.localStorage.removeItem(key);
        }
      }
    }
    setGrantsByScope(next);
  }, [academicYearId, schoolId, userId]);

  const recordDownload = useCallback((version: FmQadTemplateVersion, grantId: string) => {
    if (!grantId || !userId || !schoolId || !academicYearId || !version.scopeId) return;
    const grant: FmQadDownloadedVersionGrant = {
      grantId,
      userId,
      schoolId,
      academicYearId,
      scopeId: version.scopeId,
      versionId: version.id,
      revisionLabel: version.revisionLabel,
      downloadedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(userId, schoolId, academicYearId, version.scopeId), JSON.stringify(grant));
    setGrantsByScope((current) => ({ ...current, [version.scopeId]: grant }));
  }, [academicYearId, schoolId, userId]);

  const discardGrant = useCallback((scopeId: string) => {
    if (!userId || !schoolId || !academicYearId || !scopeId) return;
    window.localStorage.removeItem(storageKey(userId, schoolId, academicYearId, scopeId));
    setGrantsByScope((current) => {
      const next = { ...current };
      delete next[scopeId];
      return next;
    });
  }, [academicYearId, schoolId, userId]);

  return { grantsByScope, recordDownload, discardGrant };
}
