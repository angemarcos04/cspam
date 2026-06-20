import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/context/Auth";
import { apiRequest, COOKIE_SESSION_TOKEN } from "@/lib/api";
import type { CspamsRealtimePayload } from "@/lib/realtime";
import type { AuditLogEntry } from "@/types";

interface AuditLogResponse {
  data: AuditLogEntry[];
  meta?: {
    current_page?: number;
    last_page?: number;
    per_page?: number;
    total?: number;
  };
}

interface AuditTrailPanelProps {
  id?: string;
  title?: string;
  description?: string;
  schoolId?: string | number | null;
  schoolCode?: string | number | null;
  academicYearLabel?: string | null;
  eventPrefix?: string | null;
  ownEventsOnly?: boolean;
  compact?: boolean;
  enableRealtime?: boolean;
}

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "workspace.", label: "Workspace saves/resets" },
  { value: "submission.", label: "Send / final submit" },
  { value: "monitor.", label: "Monitor review/view" },
  { value: "auth.", label: "Login / security" },
];

function formatDateTime(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRole(role: string | null): string {
  if (!role) {
    return "-";
  }

  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function detailText(entry: AuditLogEntry): string {
  const pieces = [
    entry.scopeLabel,
    entry.fileLabel && entry.fileLabel !== entry.scopeLabel ? entry.fileLabel : null,
    entry.status.decision ? `Decision: ${entry.status.decision}` : null,
    entry.status.previousDecision ? `Previous: ${entry.status.previousDecision}` : null,
    entry.details.has_note === true ? "With note" : null,
  ].filter((piece): piece is string => Boolean(piece));

  return pieces.length > 0 ? pieces.join(" | ") : "-";
}

function normalizeRealtimeValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function auditRealtimeMatchesFilters(
  payload: CspamsRealtimePayload,
  {
    schoolId,
    schoolCode,
    academicYearLabel,
    actionPrefix,
  }: {
    schoolId: string | number | null;
    schoolCode: string | number | null;
    academicYearLabel: string | null;
    actionPrefix: string;
  },
): boolean {
  if (payload.entity !== "audit" || payload.eventType !== "audit.log_created") {
    return false;
  }

  const payloadAction = normalizeRealtimeValue(payload.auditAction);
  if (actionPrefix && !payloadAction.startsWith(actionPrefix)) {
    return false;
  }

  const expectedSchoolId = normalizeRealtimeValue(schoolId);
  if (expectedSchoolId && normalizeRealtimeValue(payload.schoolId) !== expectedSchoolId) {
    return false;
  }

  const expectedSchoolCode = normalizeRealtimeValue(schoolCode).toUpperCase();
  if (!expectedSchoolId && expectedSchoolCode && normalizeRealtimeValue(payload.schoolCode).toUpperCase() !== expectedSchoolCode) {
    return false;
  }

  const expectedAcademicYear = normalizeRealtimeValue(academicYearLabel);
  if (expectedAcademicYear && normalizeRealtimeValue(payload.academicYearLabel) !== expectedAcademicYear) {
    return false;
  }

  return true;
}

export function AuditTrailPanel({
  id,
  title = "Audit Trail",
  description = "Permanent record of workflow and security-sensitive activity.",
  schoolId = null,
  schoolCode = null,
  academicYearLabel = null,
  eventPrefix = null,
  ownEventsOnly = false,
  compact = false,
  enableRealtime = true,
}: AuditTrailPanelProps) {
  const { apiToken } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionPrefix, setActionPrefix] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const token = apiToken ?? COOKIE_SESSION_TOKEN;
  const effectiveActionPrefix = eventPrefix ?? actionPrefix;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("per_page", compact ? "12" : "30");

    if (schoolId !== null && schoolId !== "") {
      params.set("school_id", String(schoolId));
    } else if (schoolCode !== null && schoolCode !== "") {
      params.set("school_code", String(schoolCode));
    }

    if (academicYearLabel) {
      params.set("academic_year_label", academicYearLabel);
    }
    if (effectiveActionPrefix) {
      params.set("event_prefix", effectiveActionPrefix);
    }
    if (ownEventsOnly) {
      params.set("mine", "true");
    }
    if (dateFrom) {
      params.set("date_from", dateFrom);
    }
    if (dateTo) {
      params.set("date_to", dateTo);
    }

    return params.toString();
  }, [academicYearLabel, compact, dateFrom, dateTo, effectiveActionPrefix, ownEventsOnly, schoolCode, schoolId]);

  const loadAuditTrail = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await apiRequest<AuditLogResponse>(`/api/audit-logs?${queryString}`, {
        token,
        signal,
      });
      setEntries(response.data);
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      setError(err instanceof Error ? err.message : "Unable to load audit trail.");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [queryString, token]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAuditTrail(controller.signal);

    return () => controller.abort();
  }, [loadAuditTrail]);

  useEffect(() => {
    if (!enableRealtime || typeof window === "undefined") {
      return;
    }

    const handleRealtimeAuditEvent = (event: Event) => {
      const payload = (event as CustomEvent<CspamsRealtimePayload>).detail;
      if (!auditRealtimeMatchesFilters(payload, {
        schoolId,
        schoolCode,
        academicYearLabel,
        actionPrefix: effectiveActionPrefix,
      })) {
        return;
      }

      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }

      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void loadAuditTrail();
      }, 250);
    };

    window.addEventListener("cspams:update", handleRealtimeAuditEvent);

    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      window.removeEventListener("cspams:update", handleRealtimeAuditEvent);
    };
  }, [academicYearLabel, effectiveActionPrefix, enableRealtime, loadAuditTrail, schoolCode, schoolId]);

  return (
    <section id={id ?? (compact ? "monitor-school-audit-trail" : "monitor-audit-trail")} className="rounded-sm border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{title}</p>
          <p className="mt-1 text-xs text-slate-600">{description}</p>
          {lastLoadedAt && (
            <p className="mt-1 text-[11px] text-slate-500">Loaded {formatDateTime(lastLoadedAt)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void loadAuditTrail()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-sm border border-primary-200 bg-white px-3 py-2 text-xs font-semibold text-primary-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {!compact && (
        <div className="grid gap-3 border-b border-slate-200 px-4 py-3 md:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">
            Action
            <select
              value={eventPrefix ?? actionPrefix}
              onChange={(event) => setActionPrefix(event.target.value)}
              disabled={eventPrefix !== null}
              className="mt-1 w-full rounded-sm border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary-100"
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={`audit-action-${option.value || "all"}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="mt-1 w-full rounded-sm border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary-100"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="mt-1 w-full rounded-sm border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-primary-100"
            />
          </label>
        </div>
      )}

      {error && (
        <div className="m-4 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Time</th>
              {!compact && <th className="px-3 py-2 text-left">School</th>}
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Scope/File</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {isLoading && entries.length === 0 ? (
              <tr>
                <td colSpan={compact ? 5 : 6} className="px-3 py-6 text-center text-xs font-semibold text-slate-500">
                  Loading audit trail...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={compact ? 5 : 6} className="px-3 py-6 text-center text-xs font-semibold text-slate-500">
                  No audit events match this view yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={`audit-log-${entry.id}`} className="bg-white">
                  <td className="px-3 py-3 align-top text-xs font-semibold text-slate-700">{formatDateTime(entry.createdAt)}</td>
                  {!compact && (
                    <td className="px-3 py-3 align-top">
                      <p className="font-semibold text-slate-900">{entry.school.name ?? "-"}</p>
                      <p className="text-[11px] text-slate-500">{entry.school.code ?? ""}</p>
                    </td>
                  )}
                  <td className="px-3 py-3 align-top">
                    <p className="font-semibold text-slate-900">{entry.actor.name ?? "System"}</p>
                    <p className="text-[11px] text-slate-500">{formatRole(entry.actor.role)}</p>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <p className="font-semibold text-slate-900">{entry.eventLabel}</p>
                    <p className="text-[11px] text-slate-500">{entry.eventType}</p>
                  </td>
                  <td className="px-3 py-3 align-top text-xs text-slate-700">{detailText(entry)}</td>
                  <td className="px-3 py-3 align-top text-xs font-semibold text-slate-700">
                    {entry.status.decision ?? entry.status.to ?? "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MonitorAuditTrail(props: AuditTrailPanelProps) {
  return <AuditTrailPanel {...props} />;
}
