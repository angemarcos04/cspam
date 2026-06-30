import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/Auth";
import { apiRequest, displayMessageForApiError } from "@/lib/api";
import type { RefreshOptions } from "@/lib/runRefreshBatches";
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

  const requestUrl = useMemo(
    () => buildMonitorReviewInboxUrl(filters, page, perPage),
    [filters, page, perPage],
  );

  const refresh = useCallback(async (options?: RefreshOptions): Promise<MonitorSchoolRequirementSummary[]> => {
    if (!enabled) {
      return rowsRef.current;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);

    try {
      const payload = await apiRequest<MonitorReviewInboxResponse>(requestUrl, {
        token: apiToken,
      });
      const nextRows = Array.isArray(payload.data) ? payload.data : [];
      const nextMeta = normalizeMeta(payload.meta, perPage);

      if (requestIdRef.current === requestId) {
        setRows(nextRows);
        rowsRef.current = nextRows;
        setMeta(nextMeta);
        setError("");
        setLastSyncedAt(new Date().toISOString());
      }

      return nextRows;
    } catch (err) {
      const message = displayMessageForApiError(err, "Unable to refresh review inbox.");
      if (requestIdRef.current === requestId) {
        setError(message);
      }
      if (options?.throwOnError) {
        throw err;
      }
      return rowsRef.current;
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [apiToken, enabled, perPage, requestUrl]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      rowsRef.current = [];
      setMeta({ ...DEFAULT_META, perPage });
      setError("");
      setIsLoading(false);
      return;
    }

    void refresh();
  }, [enabled, refresh, perPage]);

  return {
    rows,
    meta,
    isLoading,
    error,
    lastSyncedAt,
    refresh,
  };
}
