import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/Auth";
import { apiRequest, displayMessageForApiError } from "@/lib/api";
import type { RefreshOptions } from "@/lib/runRefreshBatches";
import { subscribeSharedSyncPolling } from "@/lib/sharedSyncPolling";
import type { MonitorSchoolRequirementSummary } from "@/pages/monitor/MonitorSchoolRecordsList";
import type {
  QueueLane,
  RequirementFilter,
  SchoolLevelFilter,
  SchoolQuickPreset,
  SchoolSectorFilter,
} from "@/pages/monitor/monitorFilters";
import {
  matchesQueueLane,
  matchesSchoolQuickPreset,
  resolveWorkflowStatus,
} from "@/pages/monitor/monitorRequirementRules";
import { buildSchoolCategoryCounts } from "@/pages/monitor/useMonitorRequirementData";
import type { SchoolStatus } from "@/types";
import {
  normalizeSchoolIdentityValue,
  reviewInboxRowMatchesSchoolIdentity,
  schoolIdentitiesMatch,
  type SchoolIdentity,
} from "@/utils/schoolRecordIdentity";

export interface MonitorReviewInboxFilters {
  search?: string;
  status?: SchoolStatus | "all";
  workflow?: RequirementFilter;
  lane?: QueueLane;
  preset?: SchoolQuickPreset;
  sector?: SchoolSectorFilter;
  level?: SchoolLevelFilter;
  schoolId?: string | number | null;
  dateFrom?: string;
  dateTo?: string;
  academicYearId?: string | number | null;
}

export interface MonitorReviewInboxMeta {
  currentPage: number;
  lastPage: number;
  perPage: number;
  total: number;
  from: number | null;
  to: number | null;
  hasMorePages: boolean;
  requirementCounts?: Record<string, number>;
  workflowStatusCounts?: Record<string, number>;
  schoolStatusCounts?: Record<string, number>;
  queueLaneCounts?: Record<string, number>;
  schoolPresetCounts?: Record<string, number>;
  schoolCategoryCounts?: Record<string, number>;
  needsActionCount?: number;
}

interface MonitorReviewInboxResponse {
  data?: MonitorSchoolRequirementSummary[];
  meta?: Partial<MonitorReviewInboxMeta>;
}

interface UseMonitorReviewInboxArgs {
  enabled: boolean;
  filters: MonitorReviewInboxFilters;
  page: number;
  perPage: number;
}

interface UseMonitorReviewInboxResult {
  rows: MonitorSchoolRequirementSummary[];
  meta: MonitorReviewInboxMeta;
  isLoading: boolean;
  error: string;
  lastSyncedAt: string | null;
  refresh: (options?: RefreshOptions) => Promise<MonitorSchoolRequirementSummary[]>;
}

const DEFAULT_META: MonitorReviewInboxMeta = {
  currentPage: 1,
  lastPage: 1,
  perPage: 10,
  total: 0,
  from: null,
  to: null,
  hasMorePages: false,
};
const RECENT_REVIEW_INBOX_SYNC_TTL_MS = 1_000;
const REVIEW_INBOX_DELETION_TOMBSTONE_TTL_MS = 10 * 60 * 1000;

interface ReviewInboxInFlightRequest {
  url: string;
  requestId: number;
  controller: AbortController;
  promise: Promise<MonitorSchoolRequirementSummary[]>;
  throwingPromise: Promise<MonitorSchoolRequirementSummary[]>;
}

interface ReviewInboxDeletionTombstone {
  identity: SchoolIdentity;
  deletedAt: number;
  requestIdAtDeletion: number;
  mutationId?: string;
  wasVisibleAtDeletion: boolean;
}

function appendParam(params: URLSearchParams, key: string, value: string | number | null | undefined): void {
  const normalized = String(value ?? "").trim();
  if (!normalized) return;
  params.set(key, normalized);
}

function appendNonAllParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "all") return;
  params.set(key, normalized);
}

export function buildMonitorReviewInboxUrl(
  filters: MonitorReviewInboxFilters,
  page: number,
  perPage: number,
): string {
  const params = new URLSearchParams();

  appendParam(params, "search", filters.search);
  appendNonAllParam(params, "status", filters.status);
  appendNonAllParam(params, "workflow", filters.workflow);
  appendNonAllParam(params, "lane", filters.lane);
  appendNonAllParam(params, "preset", filters.preset);
  appendNonAllParam(params, "sector", filters.sector);
  appendNonAllParam(params, "level", filters.level);
  appendParam(params, "school_id", filters.schoolId);
  appendParam(params, "date_from", filters.dateFrom);
  appendParam(params, "date_to", filters.dateTo);
  appendParam(params, "academic_year_id", filters.academicYearId);
  params.set("page", String(Math.max(1, page)));
  params.set("per_page", String(Math.max(1, perPage)));

  const query = params.toString();
  return `/api/dashboard/review-inbox${query ? `?${query}` : ""}`;
}

function normalizeMeta(meta: Partial<MonitorReviewInboxMeta> | undefined, perPage: number): MonitorReviewInboxMeta {
  return {
    ...DEFAULT_META,
    ...meta,
    currentPage: Number(meta?.currentPage ?? DEFAULT_META.currentPage),
    lastPage: Math.max(1, Number(meta?.lastPage ?? DEFAULT_META.lastPage)),
    perPage: Number(meta?.perPage ?? perPage),
    total: Number(meta?.total ?? DEFAULT_META.total),
    from: typeof meta?.from === "number" ? meta.from : null,
    to: typeof meta?.to === "number" ? meta.to : null,
    hasMorePages: Boolean(meta?.hasMorePages),
  };
}

function decrementRecordCount(
  counts: Record<string, number> | undefined,
  keys: string[],
): Record<string, number> | undefined {
  if (!counts) {
    return undefined;
  }

  const next = { ...counts };
  keys.forEach((key) => {
    if (key in next) {
      next[key] = Math.max(0, Number(next[key] ?? 0) - 1);
    }
  });
  return next;
}

function rowNeedsAction(row: MonitorSchoolRequirementSummary): boolean {
  return row.missingCount > 0
    || row.awaitingReviewCount > 0
    || row.indicatorStatus === "returned";
}

export function removeReviewInboxRowsFromMeta(
  meta: MonitorReviewInboxMeta,
  removedRows: MonitorSchoolRequirementSummary[],
  remainingVisibleRows: number,
): MonitorReviewInboxMeta {
  if (removedRows.length === 0) {
    return meta;
  }

  let next = { ...meta };
  removedRows.forEach((row) => {
    const actionRow = rowNeedsAction(row);
    const categoryDelta = buildSchoolCategoryCounts([{
      type: row.schoolType ?? row.packageSchoolType,
      level: row.schoolLevel,
    }]);
    const categoryKeys = Object.entries(categoryDelta)
      .filter(([, value]) => value > 0)
      .map(([key]) => key);
    const requirementKeys = [
      "total",
      ...(row.hasAnySubmitted ? ["submittedAny"] : []),
      ...(row.isComplete ? ["complete"] : []),
      ...(row.awaitingReviewCount > 0 ? ["awaitingReview"] : []),
      ...(row.missingCount > 0 ? ["missing"] : []),
      ...(row.indicatorStatus === "returned" ? ["returned"] : []),
    ];
    const workflowKeys = ["all", resolveWorkflowStatus(row)];
    const schoolStatusKeys = [
      "all",
      ...(row.schoolStatus ? [row.schoolStatus] : []),
    ];
    const queueKeys = actionRow
      ? [
          "all",
          ...(["urgent", "returned", "for_review", "waiting_data"] as const)
            .filter((lane) => matchesQueueLane(row, lane)),
        ]
      : [];
    const presetKeys = [
      "all",
      ...(["pending", "missing", "returned", "no_submission"] as const)
        .filter((preset) => matchesSchoolQuickPreset(row, preset)),
    ];

    next = {
      ...next,
      total: Math.max(0, next.total - 1),
      needsActionCount: typeof next.needsActionCount === "number"
        ? Math.max(0, next.needsActionCount - (actionRow ? 1 : 0))
        : undefined,
      requirementCounts: decrementRecordCount(next.requirementCounts, requirementKeys),
      workflowStatusCounts: decrementRecordCount(next.workflowStatusCounts, workflowKeys),
      schoolStatusCounts: decrementRecordCount(next.schoolStatusCounts, schoolStatusKeys),
      queueLaneCounts: decrementRecordCount(next.queueLaneCounts, queueKeys),
      schoolPresetCounts: decrementRecordCount(next.schoolPresetCounts, presetKeys),
      schoolCategoryCounts: decrementRecordCount(next.schoolCategoryCounts, categoryKeys),
    };
  });

  const lastPage = Math.max(1, Math.ceil(next.total / Math.max(1, next.perPage)));
  const currentPage = Math.min(next.currentPage, lastPage);
  const from = remainingVisibleRows > 0 ? next.from : null;
  const to = remainingVisibleRows > 0 && from !== null
    ? from + remainingVisibleRows - 1
    : null;

  return {
    ...next,
    currentPage,
    lastPage,
    from,
    to,
    hasMorePages: currentPage < lastPage,
  };
}

export function useMonitorReviewInbox({
  enabled,
  filters,
  page,
  perPage,
}: UseMonitorReviewInboxArgs): UseMonitorReviewInboxResult {
  const { apiToken } = useAuth();
  const [rows, setRows] = useState<MonitorSchoolRequirementSummary[]>([]);
  const [meta, setMeta] = useState<MonitorReviewInboxMeta>(() => ({ ...DEFAULT_META, perPage }));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const rowsRef = useRef<MonitorSchoolRequirementSummary[]>([]);
  const metaRef = useRef<MonitorReviewInboxMeta>({ ...DEFAULT_META, perPage });
  const inFlightRequestRef = useRef<ReviewInboxInFlightRequest | null>(null);
  const lastCompletedRequestRef = useRef<{ url: string; completedAt: number } | null>(null);
  const deletedSchoolTombstonesRef = useRef<ReviewInboxDeletionTombstone[]>([]);
  const scheduledRefreshTimerRef = useRef<number | null>(null);
  const aggregatesStaleRef = useRef(false);

  const requestUrl = useMemo(
    () => buildMonitorReviewInboxUrl(filters, page, perPage),
    [filters, page, perPage],
  );

  const refresh = useCallback((options?: RefreshOptions): Promise<MonitorSchoolRequirementSummary[]> => {
    if (!enabled) {
      return Promise.resolve(rowsRef.current);
    }

    const existingRequest = inFlightRequestRef.current;
    if (!options?.force && existingRequest?.url === requestUrl) {
      return options?.throwOnError
        ? existingRequest.throwingPromise
        : existingRequest.promise;
    }

    const lastCompletedRequest = lastCompletedRequestRef.current;
    if (
      !options?.force
      && lastCompletedRequest?.url === requestUrl
      && Date.now() - lastCompletedRequest.completedAt < RECENT_REVIEW_INBOX_SYNC_TTL_MS
    ) {
      return Promise.resolve(rowsRef.current);
    }

    existingRequest?.controller.abort();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = new AbortController();
    setIsLoading(true);

    const requestPromise = (async () => {
      try {
        const payload = await apiRequest<MonitorReviewInboxResponse>(requestUrl, {
          token: apiToken,
          signal: controller.signal,
        });
        const nextRows = Array.isArray(payload.data) ? payload.data : [];
        const nextMeta = normalizeMeta(payload.meta, perPage);
        const tombstones = deletedSchoolTombstonesRef.current;
        const safeRows = nextRows.filter((row) => !tombstones.some((tombstone) =>
          reviewInboxRowMatchesSchoolIdentity(row, tombstone.identity)));
        const suppressedRows = nextRows.filter((row) => tombstones.some((tombstone) =>
          reviewInboxRowMatchesSchoolIdentity(row, tombstone.identity)));
        const requestPredatesDeletion = tombstones.some((tombstone) =>
          requestId <= tombstone.requestIdAtDeletion);
        const now = Date.now();
        deletedSchoolTombstonesRef.current = tombstones.filter((tombstone) => {
          if (requestId <= tombstone.requestIdAtDeletion) {
            return true;
          }

          const serverStillContainsSchool = nextRows.some((row) =>
            reviewInboxRowMatchesSchoolIdentity(row, tombstone.identity));
          const scopedSchoolId = new URL(requestUrl, "https://cspams.local")
            .searchParams.get("school_id");
          const scopedRequestConfirmsAbsence = Boolean(
            scopedSchoolId
            && normalizeSchoolIdentityValue(tombstone.identity.id) === scopedSchoolId,
          );
          if (
            !serverStillContainsSchool
            && (tombstone.wasVisibleAtDeletion || scopedRequestConfirmsAbsence)
          ) {
            return false;
          }

          return now - tombstone.deletedAt < REVIEW_INBOX_DELETION_TOMBSTONE_TTL_MS;
        });

        if (requestIdRef.current === requestId) {
          const safeMeta = requestPredatesDeletion
            ? metaRef.current
            : removeReviewInboxRowsFromMeta(nextMeta, suppressedRows, safeRows.length);
          setRows(safeRows);
          rowsRef.current = safeRows;
          setMeta(safeMeta);
          metaRef.current = safeMeta;
          if (!requestPredatesDeletion) {
            aggregatesStaleRef.current = false;
          }
          setError("");
          setLastSyncedAt(new Date().toISOString());
          lastCompletedRequestRef.current = {
            url: requestUrl,
            completedAt: Date.now(),
          };
        }

        return safeRows;
      } catch (err) {
        if (controller.signal.aborted) {
          return rowsRef.current;
        }

        const message = displayMessageForApiError(err, "Unable to refresh review inbox.");
        if (requestIdRef.current === requestId) {
          setError(message);
        }
        throw err;
      } finally {
        if (inFlightRequestRef.current?.controller === controller) {
          inFlightRequestRef.current = null;
        }
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      }
    })();

    const safeRequestPromise = requestPromise.catch(() => rowsRef.current);
    inFlightRequestRef.current = {
      url: requestUrl,
      requestId,
      controller,
      promise: safeRequestPromise,
      throwingPromise: requestPromise,
    };

    return options?.throwOnError ? requestPromise : safeRequestPromise;
  }, [apiToken, enabled, perPage, requestUrl]);

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1;
      inFlightRequestRef.current?.controller.abort();
      inFlightRequestRef.current = null;
      lastCompletedRequestRef.current = null;
      setRows([]);
      rowsRef.current = [];
      const nextMeta = { ...DEFAULT_META, perPage };
      setMeta(nextMeta);
      metaRef.current = nextMeta;
      deletedSchoolTombstonesRef.current = [];
      aggregatesStaleRef.current = false;
      setError("");
      setIsLoading(false);
      return;
    }

    void refresh();
  }, [enabled, refresh, perPage]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    inFlightRequestRef.current?.controller.abort();
    inFlightRequestRef.current = null;
    if (scheduledRefreshTimerRef.current !== null) {
      window.clearTimeout(scheduledRefreshTimerRef.current);
      scheduledRefreshTimerRef.current = null;
    }
    deletedSchoolTombstonesRef.current = [];
    aggregatesStaleRef.current = false;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleConfirmedDeletion = (event: Event) => {
      const identity = (event as CustomEvent<SchoolIdentity & { mutationId?: string }>).detail;
      if (!identity) {
        return;
      }

      const mutationId = String(identity.mutationId ?? "").trim();
      const existingTombstone = deletedSchoolTombstonesRef.current.some((tombstone) =>
        (mutationId && tombstone.mutationId === mutationId)
        || schoolIdentitiesMatch(tombstone.identity, identity));
      if (existingTombstone) {
        return;
      }

      const removedRows = rowsRef.current.filter((row) =>
        reviewInboxRowMatchesSchoolIdentity(row, identity));
      const nextRows = rowsRef.current.filter((row) =>
        !reviewInboxRowMatchesSchoolIdentity(row, identity));
      deletedSchoolTombstonesRef.current = [
        ...deletedSchoolTombstonesRef.current,
        {
          identity,
          deletedAt: Date.now(),
          requestIdAtDeletion: requestIdRef.current,
          mutationId: mutationId || undefined,
          wasVisibleAtDeletion: removedRows.length > 0,
        },
      ];
      lastCompletedRequestRef.current = null;
      inFlightRequestRef.current?.controller.abort();
      if (scheduledRefreshTimerRef.current !== null) {
        window.clearTimeout(scheduledRefreshTimerRef.current);
        scheduledRefreshTimerRef.current = null;
      }

      rowsRef.current = nextRows;
      setRows(nextRows);
      const nextMeta = removeReviewInboxRowsFromMeta(metaRef.current, removedRows, nextRows.length);
      metaRef.current = nextMeta;
      setMeta(nextMeta);
      aggregatesStaleRef.current = removedRows.length === 0;
      setError("");

      if (enabled) {
        scheduledRefreshTimerRef.current = window.setTimeout(() => {
          scheduledRefreshTimerRef.current = null;
          void refresh({ force: true });
        }, 0);
      }
    };

    window.addEventListener("cspams:school-deleted", handleConfirmedDeletion);
    return () => window.removeEventListener("cspams:school-deleted", handleConfirmedDeletion);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const clearRefreshTimer = () => {
      if (scheduledRefreshTimerRef.current !== null) {
        window.clearTimeout(scheduledRefreshTimerRef.current);
        scheduledRefreshTimerRef.current = null;
      }
    };

    const scheduleRefresh = (delayMs: number, force = false) => {
      clearRefreshTimer();
      scheduledRefreshTimerRef.current = window.setTimeout(() => {
        scheduledRefreshTimerRef.current = null;
        void refresh(force ? { force: true } : undefined);
      }, delayMs);
    };

    const unsubscribe = subscribeSharedSyncPolling((trigger, payload) => {
      if (trigger === "realtime") {
        const entity = String(payload?.entity ?? "").trim();
        if (entity !== "indicators" && entity !== "dashboard") {
          return;
        }

        if (
          entity === "dashboard"
          && payload?.eventType === "school_head_account_and_school.removed"
        ) {
          const mutationId = String(payload.mutationId ?? "").trim();
          if (
            mutationId
            && deletedSchoolTombstonesRef.current.some((tombstone) =>
              tombstone.mutationId === mutationId)
          ) {
            return;
          }
        }

        scheduleRefresh(250, true);
        return;
      }

      scheduleRefresh(0);
    });

    return () => {
      unsubscribe();
      clearRefreshTimer();
    };
  }, [enabled, refresh]);

  return {
    rows,
    meta,
    isLoading,
    error,
    lastSyncedAt,
    refresh,
  };
}
