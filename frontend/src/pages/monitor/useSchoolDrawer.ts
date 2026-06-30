import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { IndicatorDataContextType } from "@/context/IndicatorData";
import type { StudentDataContextType } from "@/context/StudentData";
import type { TeacherDataContextType } from "@/context/TeacherData";
import { messageForApiError } from "@/lib/api";
import { deriveAvailableMonitorSchoolDetailYears } from "@/pages/monitor/monitorSchoolDetailYear";
import type { MonitorDrawerYearOption } from "@/pages/monitor/monitorDrawerTypes";
import type { IndicatorSubmission } from "@/types";
import type { MonitorUiRealtimeBatch } from "./useMonitorUiRefresh";

const SCHOOL_DETAIL_COUNTS_CACHE_TTL_MS = 45_000;
type SchoolDetailCounts = { students: number; teachers: number };
type SchoolDetailCountsCacheEntry = SchoolDetailCounts & { fetchedAt: number };

export type SchoolDrawerTab = "submissions" | "history" | "audit" | "management";

interface UseSchoolDrawerOptions {
  authSessionKey: string;
  isAuthenticated: boolean;
  latestRealtimeBatch: MonitorUiRealtimeBatch | null;
  resolveRecordId: (schoolKey: string | null) => string;
  resolveSchoolCode: (schoolKey: string | null) => string;
  resolveLatestIndicatorSubmissionId: (schoolKey: string | null) => string;
  fetchSubmission: IndicatorDataContextType["fetchSubmission"];
  listSubmissionsForSchool: IndicatorDataContextType["listSubmissionsForSchool"];
  queryStudents: StudentDataContextType["queryStudents"];
  listTeachers: TeacherDataContextType["listTeachers"];
}

export interface UseSchoolDrawerResult {
  schoolDrawerKey: string | null;
  schoolDrawerRecordId: string;
  schoolDrawerSchoolCode: string;
  activeSchoolDrawerTab: SchoolDrawerTab;
  selectedSchoolDrawerYear: string | null;
  availableSchoolDrawerYears: MonitorDrawerYearOption[];
  expandedDrawerIndicatorRows: Record<string, boolean>;
  highlightedDrawerIndicatorKey: string | null;
  schoolDrawerSubmissions: IndicatorSubmission[];
  isSchoolDrawerSubmissionsLoading: boolean;
  schoolDrawerSubmissionsError: string;
  accurateSyncedCountsBySchoolKey: Record<string, { students: number; teachers: number }>;
  syncedCountsLoadingSchoolKey: string | null;
  syncedCountsError: string;
  openSchoolDrawer: (schoolKey: string) => void;
  closeSchoolDrawer: () => void;
  refreshSchoolDrawer: () => void;
  setActiveSchoolDrawerTab: Dispatch<SetStateAction<SchoolDrawerTab>>;
  setSelectedSchoolDrawerYear: Dispatch<SetStateAction<string | null>>;
  setHighlightedDrawerIndicatorKey: Dispatch<SetStateAction<string | null>>;
  toggleDrawerIndicatorLabel: (key: string) => void;
}

export function deriveAvailableSchoolDrawerYears(submissions: IndicatorSubmission[]): MonitorDrawerYearOption[] {
  return deriveAvailableMonitorSchoolDetailYears(submissions);
}

export function matchesDrawerSchool(
  schoolId: string,
  schoolCode: string,
  recordId: string,
  normalizedSchoolCode: string,
): boolean {
  const normalizedRecordId = recordId.trim();

  return (
    (Boolean(normalizedSchoolCode) && schoolCode === normalizedSchoolCode) ||
    (Boolean(normalizedRecordId) && schoolId === normalizedRecordId)
  );
}

export function matchesDrawerSubmission(
  submissionId: string,
  latestSubmissionId: string,
  activeSubmissionIds: ReadonlySet<string>,
): boolean {
  const normalizedSubmissionId = submissionId.trim();
  if (!normalizedSubmissionId) {
    return false;
  }

  return normalizedSubmissionId === latestSubmissionId.trim() || activeSubmissionIds.has(normalizedSubmissionId);
}

export function isMissingSchoolRecordError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.trim() : "";
  return message === "School record not found. It may have been archived or permanently deleted.";
}

export function buildSyncedCountsUnavailableMessage(hasStudentFailure: boolean, hasTeacherFailure: boolean): string {
  if (hasStudentFailure && hasTeacherFailure) {
    return "Unable to refresh synced student and teacher totals right now. Showing last available counts.";
  }

  if (hasStudentFailure) {
    return "Unable to refresh synced student totals right now. Showing last available counts.";
  }

  return "Unable to refresh synced teacher totals right now. Showing last available counts.";
}

export function isFreshSchoolDetailCountsCacheEntry(
  cached: SchoolDetailCountsCacheEntry | null,
  now = Date.now(),
): cached is SchoolDetailCountsCacheEntry {
  if (!cached) {
    return false;
  }

  return now - cached.fetchedAt <= SCHOOL_DETAIL_COUNTS_CACHE_TTL_MS;
}

function resolveSyncedCountTotal(payload: { data?: unknown[]; meta?: { total?: number; recordCount?: number } }): number {
  return Number(payload.meta?.total ?? payload.meta?.recordCount ?? payload.data?.length ?? 0);
}

export function buildSyncedCountsRefreshOutcome(
  studentsResult: PromiseSettledResult<{ data: unknown[]; meta: { total?: number; recordCount?: number } }>,
  teachersResult: PromiseSettledResult<{ data: unknown[]; meta: { total?: number; recordCount?: number } }>,
  currentKnownCounts: SchoolDetailCounts | null | undefined,
): { nextCounts: SchoolDetailCounts; error: string } {
  const nextCounts = {
    students:
      studentsResult.status === "fulfilled"
        ? resolveSyncedCountTotal(studentsResult.value)
        : Number(currentKnownCounts?.students ?? 0),
    teachers:
      teachersResult.status === "fulfilled"
        ? resolveSyncedCountTotal(teachersResult.value)
        : Number(currentKnownCounts?.teachers ?? 0),
  };
  const hasStudentFailure = studentsResult.status === "rejected";
  const hasTeacherFailure = teachersResult.status === "rejected";

  return {
    nextCounts,
    error: hasStudentFailure || hasTeacherFailure
      ? buildSyncedCountsUnavailableMessage(hasStudentFailure, hasTeacherFailure)
      : "",
  };
}

export function shouldForceSchoolSubmissionReload(submissionRefreshTick: number): boolean {
  return submissionRefreshTick > 0;
}

export function mergeLatestSchoolDrawerSubmission(
  latestSubmission: IndicatorSubmission | null,
  listRows: IndicatorSubmission[],
): IndicatorSubmission[] {
  if (!latestSubmission) {
    return listRows;
  }

  const latestId = String(latestSubmission.id ?? "").trim();
  if (!latestId) {
    return [latestSubmission, ...listRows];
  }

  return [
    latestSubmission,
    ...listRows.filter((row) => String(row.id ?? "").trim() !== latestId),
  ];
}

export function useSchoolDrawer({
  authSessionKey,
  isAuthenticated,
  latestRealtimeBatch,
  resolveRecordId,
  resolveSchoolCode,
  resolveLatestIndicatorSubmissionId,
  fetchSubmission,
  listSubmissionsForSchool,
  queryStudents,
  listTeachers,
}: UseSchoolDrawerOptions): UseSchoolDrawerResult {
  const [schoolDrawerKey, setSchoolDrawerKey] = useState<string | null>(null);
  const [activeSchoolDrawerTab, setActiveSchoolDrawerTab] = useState<SchoolDrawerTab>("submissions");
  const [selectedSchoolDrawerYear, setSelectedSchoolDrawerYearState] = useState<string | null>(null);
  const [expandedDrawerIndicatorRows, setExpandedDrawerIndicatorRows] = useState<Record<string, boolean>>({});
  const [highlightedDrawerIndicatorKey, setHighlightedDrawerIndicatorKey] = useState<string | null>(null);
  const [schoolDrawerSubmissions, setSchoolDrawerSubmissions] = useState<IndicatorSubmission[]>([]);
  const [isSchoolDrawerSubmissionsLoading, setIsSchoolDrawerSubmissionsLoading] = useState(false);
  const [schoolDrawerSubmissionsError, setSchoolDrawerSubmissionsError] = useState("");
  const [accurateSyncedCountsBySchoolKey, setAccurateSyncedCountsBySchoolKey] = useState<
    Record<string, { students: number; teachers: number }>
  >({});
  const [syncedCountsLoadingSchoolKey, setSyncedCountsLoadingSchoolKey] = useState<string | null>(null);
  const [syncedCountsError, setSyncedCountsError] = useState("");
  const [submissionRefreshTick, setSubmissionRefreshTick] = useState(0);
  const [countsRefreshTick, setCountsRefreshTick] = useState(0);
  const [realtimeSubmissionDetailId, setRealtimeSubmissionDetailId] = useState("");
  const schoolDetailCountsCacheRef = useRef<Map<string, SchoolDetailCountsCacheEntry>>(
    new Map(),
  );
  const accurateSyncedCountsRef = useRef<Record<string, SchoolDetailCounts>>({});
  const schoolDetailCountsAbortRef = useRef<AbortController | null>(null);
  const schoolDrawerSubmissionIdsRef = useRef<Set<string>>(new Set());
  const hasManuallySelectedSchoolDrawerYearRef = useRef(false);
  const fetchSubmissionRef = useRef(fetchSubmission);
  const listSubmissionsForSchoolRef = useRef(listSubmissionsForSchool);

  const schoolDrawerRecordId = useMemo(
    () => resolveRecordId(schoolDrawerKey),
    [resolveRecordId, schoolDrawerKey],
  );
  const schoolDrawerSchoolCode = useMemo(
    () => resolveSchoolCode(schoolDrawerKey),
    [resolveSchoolCode, schoolDrawerKey],
  );
  const schoolDrawerLatestSubmissionId = useMemo(
    () => resolveLatestIndicatorSubmissionId(schoolDrawerKey).trim(),
    [resolveLatestIndicatorSubmissionId, schoolDrawerKey],
  );

  useEffect(() => {
    fetchSubmissionRef.current = fetchSubmission;
  }, [fetchSubmission]);

  useEffect(() => {
    listSubmissionsForSchoolRef.current = listSubmissionsForSchool;
  }, [listSubmissionsForSchool]);

  useEffect(() => {
    schoolDrawerSubmissionIdsRef.current = new Set(
      schoolDrawerSubmissions
        .map((submission) => String(submission.id ?? "").trim())
        .filter((submissionId) => submissionId !== ""),
    );
  }, [schoolDrawerSubmissions]);

  const openSchoolDrawer = useCallback((schoolKey: string) => {
    hasManuallySelectedSchoolDrawerYearRef.current = false;
    setSchoolDrawerKey(schoolKey);
    setActiveSchoolDrawerTab("submissions");
    setSelectedSchoolDrawerYearState(null);
    setExpandedDrawerIndicatorRows({});
    setHighlightedDrawerIndicatorKey(null);
    setRealtimeSubmissionDetailId("");
  }, []);

  const closeSchoolDrawer = useCallback(() => {
    hasManuallySelectedSchoolDrawerYearRef.current = false;
    setSchoolDrawerKey(null);
    setSelectedSchoolDrawerYearState(null);
    setHighlightedDrawerIndicatorKey(null);
    setRealtimeSubmissionDetailId("");
  }, []);

  const setSelectedSchoolDrawerYear: Dispatch<SetStateAction<string | null>> = useCallback((value) => {
    hasManuallySelectedSchoolDrawerYearRef.current = true;
    setSelectedSchoolDrawerYearState(value);
  }, []);

  const refreshSchoolDrawer = useCallback(() => {
    setSubmissionRefreshTick((current) => current + 1);
    setCountsRefreshTick((current) => current + 1);
  }, []);

  const toggleDrawerIndicatorLabel = useCallback((key: string) => {
    setExpandedDrawerIndicatorRows((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }, []);

  useEffect(() => {
    schoolDetailCountsCacheRef.current.clear();
    schoolDetailCountsAbortRef.current?.abort();
    schoolDetailCountsAbortRef.current = null;
    setSchoolDrawerKey(null);
    setActiveSchoolDrawerTab("submissions");
    hasManuallySelectedSchoolDrawerYearRef.current = false;
    setSelectedSchoolDrawerYearState(null);
    setExpandedDrawerIndicatorRows({});
    setHighlightedDrawerIndicatorKey(null);
    setSchoolDrawerSubmissions([]);
    setIsSchoolDrawerSubmissionsLoading(false);
    setSchoolDrawerSubmissionsError("");
    setAccurateSyncedCountsBySchoolKey({});
    accurateSyncedCountsRef.current = {};
    setSyncedCountsLoadingSchoolKey(null);
    setSyncedCountsError("");
    setSubmissionRefreshTick(0);
    setCountsRefreshTick(0);
    setRealtimeSubmissionDetailId("");
  }, [authSessionKey]);

  useEffect(() => {
    if (!schoolDrawerKey) {
      return;
    }

    if (schoolDrawerRecordId || schoolDrawerSchoolCode || schoolDrawerLatestSubmissionId) {
      return;
    }

    closeSchoolDrawer();
    setSchoolDrawerSubmissions([]);
    setSchoolDrawerSubmissionsError("");
    setSyncedCountsLoadingSchoolKey(null);
    setSyncedCountsError("");
  }, [closeSchoolDrawer, schoolDrawerKey, schoolDrawerLatestSubmissionId, schoolDrawerRecordId, schoolDrawerSchoolCode]);

  useEffect(() => {
    if (!schoolDrawerKey || !latestRealtimeBatch) {
      return;
    }

    const normalizedSchoolCode = schoolDrawerSchoolCode.trim().toUpperCase();
    const activeSubmissionIds = schoolDrawerSubmissionIdsRef.current;
    const matchingIndicatorUpdates = latestRealtimeBatch.updates.filter((update) => (
      update.entity === "indicators" &&
      (
        matchesDrawerSchool(update.schoolId, update.schoolCode, schoolDrawerRecordId, normalizedSchoolCode) ||
        matchesDrawerSubmission(update.submissionId, schoolDrawerLatestSubmissionId, activeSubmissionIds)
      )
    ));

    if (matchingIndicatorUpdates.length > 0) {
      const directHydrationUpdate = matchingIndicatorUpdates.find((update) => (
        Boolean(update.submissionId) &&
        [
          "indicators.scopes_submitted",
          "indicators.scope_verified",
          "indicators.scope_unverified",
          "indicators.scope_returned",
        ].includes(update.eventType)
      ));
      if (directHydrationUpdate?.submissionId) {
        setRealtimeSubmissionDetailId(directHydrationUpdate.submissionId);
      }
      setSubmissionRefreshTick((current) => current + 1);
    }

    const hasMatchingCountUpdate = latestRealtimeBatch.updates.some(
      (update) =>
        (update.entity === "students" || update.entity === "teachers" || update.entity === "dashboard") &&
        matchesDrawerSchool(update.schoolId, update.schoolCode, schoolDrawerRecordId, normalizedSchoolCode),
    );
    if (hasMatchingCountUpdate) {
      setCountsRefreshTick((current) => current + 1);
    }
  }, [latestRealtimeBatch, schoolDrawerKey, schoolDrawerLatestSubmissionId, schoolDrawerRecordId, schoolDrawerSchoolCode]);

  useEffect(() => {
    const schoolSubmissionLookupKey = schoolDrawerSchoolCode || schoolDrawerRecordId;
    const preferredSubmissionDetailId = realtimeSubmissionDetailId || schoolDrawerLatestSubmissionId;
    if ((!schoolSubmissionLookupKey && !preferredSubmissionDetailId) || !isAuthenticated) {
      setSchoolDrawerSubmissions([]);
      setIsSchoolDrawerSubmissionsLoading(false);
      setSchoolDrawerSubmissionsError("");
      return;
    }

    let active = true;
    const abortController = new AbortController();

    const loadSchoolSubmissions = async () => {
      setIsSchoolDrawerSubmissionsLoading(true);
      setSchoolDrawerSubmissionsError("");

      let latestSubmission: IndicatorSubmission | null = null;

      if (preferredSubmissionDetailId) {
        try {
          latestSubmission = await fetchSubmissionRef.current(preferredSubmissionDetailId);
          if (!active) {
            return;
          }
          const latestSubmissionYearId = String(latestSubmission.academicYear?.id ?? latestSubmission.academicYearId ?? "").trim();
          if (latestSubmissionYearId) {
            setSelectedSchoolDrawerYearState((current) => current ?? latestSubmissionYearId);
          }
          setSchoolDrawerSubmissions(mergeLatestSchoolDrawerSubmission(latestSubmission, []));
          setSchoolDrawerSubmissionsError("");
        } catch (err) {
          if (!active) {
            return;
          }
          if (!schoolSubmissionLookupKey) {
            setSchoolDrawerSubmissions([]);
            setSchoolDrawerSubmissionsError(messageForApiError(err, "Unable to load school submissions."));
            setIsSchoolDrawerSubmissionsLoading(false);
            return;
          }
        }
      }

      if (!schoolSubmissionLookupKey) {
        if (active) {
          setIsSchoolDrawerSubmissionsLoading(false);
        }
        return;
      }

      try {
        const allRows = await listSubmissionsForSchoolRef.current(schoolSubmissionLookupKey, {
          signal: abortController.signal,
          force: shouldForceSchoolSubmissionReload(submissionRefreshTick),
          schoolCode: schoolDrawerSchoolCode || null,
        });
        if (!active) {
          return;
        }
        setSchoolDrawerSubmissions(mergeLatestSchoolDrawerSubmission(latestSubmission, allRows));
      } catch (err) {
        if (!active) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (isMissingSchoolRecordError(err)) {
          setSchoolDrawerSubmissions(latestSubmission ? [latestSubmission] : []);
          setSchoolDrawerSubmissionsError("");
          if (!latestSubmission) {
            closeSchoolDrawer();
          }
          return;
        }
        if (!latestSubmission) {
          setSchoolDrawerSubmissions([]);
          setSchoolDrawerSubmissionsError(messageForApiError(err, "Unable to load school submissions."));
        }
      } finally {
        if (active) {
          setIsSchoolDrawerSubmissionsLoading(false);
        }
      }
    };

    void loadSchoolSubmissions();

    return () => {
      active = false;
      abortController.abort();
    };
  }, [
    closeSchoolDrawer,
    isAuthenticated,
    realtimeSubmissionDetailId,
    schoolDrawerLatestSubmissionId,
    schoolDrawerRecordId,
    schoolDrawerSchoolCode,
    submissionRefreshTick,
  ]);

  const availableSchoolDrawerYears = useMemo(
    () => deriveAvailableSchoolDrawerYears(schoolDrawerSubmissions),
    [schoolDrawerSubmissions],
  );

  useEffect(() => {
    if (availableSchoolDrawerYears.length === 0) {
      setSelectedSchoolDrawerYearState((current) => (
        hasManuallySelectedSchoolDrawerYearRef.current && current
          ? current
          : null
      ));
      return;
    }

    const availableYearIds = availableSchoolDrawerYears.map((year) => year.id);
    setSelectedSchoolDrawerYearState((current) => {
      if (current && availableYearIds.includes(current)) {
        return current;
      }

      if (hasManuallySelectedSchoolDrawerYearRef.current && current && isSchoolDrawerSubmissionsLoading) {
        return current;
      }

      if (hasManuallySelectedSchoolDrawerYearRef.current && current) {
        hasManuallySelectedSchoolDrawerYearRef.current = false;
      }

      return availableYearIds[0] ?? null;
    });
  }, [availableSchoolDrawerYears, isSchoolDrawerSubmissionsLoading]);

  useEffect(() => {
    if (!schoolDrawerKey) {
      schoolDetailCountsAbortRef.current?.abort();
      schoolDetailCountsAbortRef.current = null;
      setSyncedCountsLoadingSchoolKey(null);
      setSyncedCountsError("");
      return;
    }

    const normalizedSchoolCode = schoolDrawerSchoolCode.trim().toUpperCase();
    if (!normalizedSchoolCode) {
      schoolDetailCountsAbortRef.current?.abort();
      schoolDetailCountsAbortRef.current = null;
      setSyncedCountsLoadingSchoolKey(null);
      setSyncedCountsError("");
      return;
    }
    if (import.meta.env.VITE_E2E_SKIP_DRAWER_COUNTS === "true") {
      schoolDetailCountsAbortRef.current?.abort();
      schoolDetailCountsAbortRef.current = null;
      setSyncedCountsLoadingSchoolKey(null);
      setSyncedCountsError("");
      return;
    }

    let active = true;
    const shouldForceRefresh = countsRefreshTick > 0;
    const readCachedCounts = () => {
      const cached = schoolDetailCountsCacheRef.current.get(schoolDrawerKey) ?? null;
      if (!isFreshSchoolDetailCountsCacheEntry(cached)) {
        return null;
      }
      return cached;
    };

    const hydrateAccurateSyncedCounts = async () => {
      const cached = shouldForceRefresh ? null : readCachedCounts();
      const currentKnownCounts = accurateSyncedCountsRef.current[schoolDrawerKey] ?? cached;
      if (cached) {
        accurateSyncedCountsRef.current = {
          ...accurateSyncedCountsRef.current,
          [schoolDrawerKey]: {
            students: cached.students,
            teachers: cached.teachers,
          },
        };
        setAccurateSyncedCountsBySchoolKey((current) => ({
          ...current,
          [schoolDrawerKey]: {
            students: cached.students,
            teachers: cached.teachers,
          },
        }));
        setSyncedCountsLoadingSchoolKey(null);
        setSyncedCountsError("");
        return;
      }

      schoolDetailCountsAbortRef.current?.abort();
      const controller = new AbortController();
      schoolDetailCountsAbortRef.current = controller;
      setSyncedCountsLoadingSchoolKey(schoolDrawerKey);
      setSyncedCountsError("");

      try {
        const [studentsResult, teachersResult] = await Promise.allSettled([
          queryStudents({ page: 1, perPage: 1, schoolCode: normalizedSchoolCode, signal: controller.signal }),
          listTeachers({ page: 1, perPage: 1, schoolCode: normalizedSchoolCode, signal: controller.signal }),
        ]);

        if (!active || controller.signal.aborted) {
          return;
        }

        const studentAborted =
          studentsResult.status === "rejected" &&
          studentsResult.reason instanceof DOMException &&
          studentsResult.reason.name === "AbortError";
        const teacherAborted =
          teachersResult.status === "rejected" &&
          teachersResult.reason instanceof DOMException &&
          teachersResult.reason.name === "AbortError";
        if (studentAborted || teacherAborted) {
          return;
        }

        const { nextCounts, error } = buildSyncedCountsRefreshOutcome(
          studentsResult as PromiseSettledResult<{ data: unknown[]; meta: { total?: number; recordCount?: number } }>,
          teachersResult as PromiseSettledResult<{ data: unknown[]; meta: { total?: number; recordCount?: number } }>,
          currentKnownCounts,
        );
        schoolDetailCountsCacheRef.current.set(schoolDrawerKey, {
          ...nextCounts,
          fetchedAt: Date.now(),
        });
        accurateSyncedCountsRef.current = {
          ...accurateSyncedCountsRef.current,
          [schoolDrawerKey]: nextCounts,
        };
        setAccurateSyncedCountsBySchoolKey((current) => ({
          ...current,
          [schoolDrawerKey]: nextCounts,
        }));

        if (error) {
          setSyncedCountsError(error);
        }
      } catch (err) {
        if (!active) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }

        setSyncedCountsError("Unable to refresh synced totals right now. Showing last available counts.");
      } finally {
        if (active && schoolDetailCountsAbortRef.current === controller) {
          schoolDetailCountsAbortRef.current = null;
          setSyncedCountsLoadingSchoolKey((current) => (current === schoolDrawerKey ? null : current));
        }
      }
    };

    void hydrateAccurateSyncedCounts();

    return () => {
      active = false;
      schoolDetailCountsAbortRef.current?.abort();
      schoolDetailCountsAbortRef.current = null;
    };
  }, [
    countsRefreshTick,
    listTeachers,
    queryStudents,
    schoolDrawerKey,
    schoolDrawerSchoolCode,
  ]);

  const hasResolvedSchoolDrawerSubmissions = schoolDrawerSubmissions.length > 0;

  return {
    schoolDrawerKey,
    schoolDrawerRecordId,
    schoolDrawerSchoolCode,
    activeSchoolDrawerTab,
    selectedSchoolDrawerYear,
    availableSchoolDrawerYears,
    expandedDrawerIndicatorRows,
    highlightedDrawerIndicatorKey,
    schoolDrawerSubmissions,
    isSchoolDrawerSubmissionsLoading: isSchoolDrawerSubmissionsLoading && !hasResolvedSchoolDrawerSubmissions,
    schoolDrawerSubmissionsError,
    accurateSyncedCountsBySchoolKey,
    syncedCountsLoadingSchoolKey,
    syncedCountsError,
    openSchoolDrawer,
    closeSchoolDrawer,
    refreshSchoolDrawer,
    setActiveSchoolDrawerTab,
    setSelectedSchoolDrawerYear,
    setHighlightedDrawerIndicatorKey,
    toggleDrawerIndicatorLabel,
  };
}
