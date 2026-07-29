import { useCallback, useEffect, useState } from "react";
import type { DownloadedFmQadVersionPin, FmQadTemplateVersion } from "@/types/fmQadTemplates";

const STORAGE_PREFIX = "cspams.fm-qad-download";

function storageKey(schoolId: string, academicYearId: string, scopeId: string) {
  return `${STORAGE_PREFIX}:${schoolId}:${academicYearId}:${scopeId}`;
}

export function useDownloadedFmQadVersionPins(schoolId: string, academicYearId: string) {
  const [pinsByScope, setPinsByScope] = useState<Record<string, DownloadedFmQadVersionPin>>({});

  useEffect(() => {
    const next: Record<string, DownloadedFmQadVersionPin> = {};
    if (typeof window !== "undefined" && schoolId && academicYearId) {
      const prefix = `${STORAGE_PREFIX}:${schoolId}:${academicYearId}:`;
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        try {
          const pin = JSON.parse(window.localStorage.getItem(key) ?? "") as DownloadedFmQadVersionPin;
          if (pin.schoolId === schoolId && pin.academicYearId === academicYearId && pin.scopeId) {
            next[pin.scopeId] = pin;
          }
        } catch {
          window.localStorage.removeItem(key);
        }
      }
    }
    setPinsByScope(next);
  }, [academicYearId, schoolId]);

  const recordDownload = useCallback((version: FmQadTemplateVersion) => {
    if (!schoolId || !academicYearId || !version.scopeId) return;
    const pin: DownloadedFmQadVersionPin = {
      schoolId,
      academicYearId,
      scopeId: version.scopeId,
      versionId: version.id,
      revisionLabel: version.revisionLabel,
      downloadedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(storageKey(schoolId, academicYearId, version.scopeId), JSON.stringify(pin));
    setPinsByScope((current) => ({ ...current, [version.scopeId]: pin }));
  }, [academicYearId, schoolId]);

  return { pinsByScope, recordDownload };
}
