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
import type { SchoolStatus } from "@/types";

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

interface ReviewInboxInFlightRequest {
  url: string;
  controller: AbortController;
  promise: Promise<MonitorSchoolRequirementSummary[]>;
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
  const inFlightRequestRef = useRef<ReviewInboxInFlightRequest | null>(null);
  const lastCompletedRequestRef = useRef<{ url: string; completedAt: number } | null>(null);

  const requestUrl = useMemo(
    () => buildMonitorReviewInboxUrl(filters, page, perPage),
    [filters, page, perPage],
  );

  const refresh = useCallback(async (options?: RefreshOptions): Promise<MonitorSchoolRequirementSummary[]> => {
    if (!enabled) {
      return rowsRef.current;
    }

    const existingRequest = inFlightRequestRef.current;
    if (existingRequest?.url === requestUrl) {
      try {
        return await existingRequest.promise;
      } catch (err) {
        if (options?.throwOnError) {
          throw err;
        }

        return rowsRef.current;
      }
    }

    const lastCompletedRequest = lastCompletedRequestRef.current;
    if (
      !options?.force
      && lastCompletedRequest?.url === requestUrl
      && Date.now() - lastCompletedRequest.completedAt < RECENT_REVIEW_INBOX_SYNC_TTL_MS
    ) {
      return rowsRef.current;
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

        if (requestIdRef.current === requestId) {
          setRows(nextRows);
          rowsRef.current = nextRows;
          setMeta(nextMeta);
          setError("");
          setLastSyncedAt(new Date().toISOString());
          lastCompletedRequestRef.current = {
            url: requestUrl,
            completedAt: Date.now(),
          };
        }

        return nextRows;
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

    inFlightRequestRef.current = {
      url: requestUrl,
      controller,
      promise: requestPromise,
    };

    try {
      return await requestPromise;
    } catch (err) {
      if (options?.throwOnError) {
        throw err;
      }

      return rowsRef.current;
    }
  }, [apiToken, enabled, perPage, requestUrl]);

  useEffect(() => {
    if (!enabled) {
      requestIdRef.current += 1;
      inFlightRequestRef.current?.controller.abort();
      inFlightRequestRef.current = null;
      lastCompletedRequestRef.current = null;
      setRows([]);
      rowsRef.current = [];
      setMeta({ ...DEFAULT_META, perPage });
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
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let refreshTimer: number | null = null;

    const clearRefreshTimer = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (delayMs: number, force = false) => {
      clearRefreshTimer();
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refresh(force ? { force: true } : undefined);
      }, delayMs);
    };

    const unsubscribe = subscribeSharedSyncPolling((trigger, payload) => {
      if (trigger === "realtime") {
        const entity = String(payload?.entity ?? "").trim();
        if (entity !== "indicators" && entity !== "dashboard") {
          return;
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
