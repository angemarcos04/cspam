import { useEffect, useState } from "react";
import { CheckCircle2, Download, RotateCcw, X } from "lucide-react";
import { SUBMISSION_FILE_DEFINITION_BY_TYPE } from "@/constants/submissionFiles";
import { useAuth } from "@/context/Auth";
import { useIndicatorData } from "@/context/IndicatorData";
import { apiRequestVoid, COOKIE_SESSION_TOKEN, getApiBaseUrl, messageForApiError } from "@/lib/api";
import { MonitorAuditTrail } from "@/pages/monitor/MonitorAuditTrail";
import type { MonitorTopNavigatorId } from "@/pages/monitor/monitorFilters";
import type {
  MonitorDrawerHistorySummary,
  MonitorDrawerPackageRow,
  MonitorDrawerYearDetail,
  MonitorDrawerYearOption,
  SchoolDetailSnapshot,
  SchoolDrawerCriticalAlert,
  SchoolIndicatorMatrix,
  SchoolIndicatorPackageRow,
  SchoolIndicatorRowGroup,
} from "@/pages/monitor/monitorDrawerTypes";
import type { SchoolDrawerTab } from "@/pages/monitor/useSchoolDrawer";
import type { IndicatorSubmission, IndicatorSubmissionFileType } from "@/types";
interface MonitorSchoolDrawerViewState {
  isOpen: boolean;
  showNavigatorManual: boolean;
  isMobileViewport: boolean;
  activeTopNavigator: MonitorTopNavigatorId;
  activeSchoolDrawerTab: SchoolDrawerTab;
  selectedSchoolDrawerYear: string | null;
  highlightedDrawerIndicatorKey: string | null;
  expandedDrawerIndicatorRows: Record<string, boolean>;
}

interface MonitorSchoolDrawerLoadingState {
  syncedCountsLoadingSchoolKey: string | null;
  syncedCountsError: string;
  isSchoolDrawerSubmissionsLoading: boolean;
  schoolDrawerSubmissionsError: string;
}

interface MonitorSchoolDrawerData {
  schoolDetail: SchoolDetailSnapshot | null;
  availableSchoolDrawerYears: MonitorDrawerYearOption[];
  schoolDrawerYearDetail: MonitorDrawerYearDetail | null;
  schoolDrawerHistorySummary: MonitorDrawerHistorySummary | null;
  schoolDrawerCriticalAlerts: SchoolDrawerCriticalAlert[];
  schoolIndicatorPackageRows: SchoolIndicatorPackageRow[];
  latestSchoolPackage: SchoolIndicatorPackageRow | null;
  schoolIndicatorMatrix: SchoolIndicatorMatrix;
  latestSchoolIndicatorYear: string;
  schoolDrawerIndicatorSubmissions: IndicatorSubmission[];
  schoolIndicatorRowsByCategory: SchoolIndicatorRowGroup[];
  missingDrawerIndicatorKeys: string[];
  returnedDrawerIndicatorKeys: string[];
  missingDrawerIndicatorKeySet: Set<string>;
  returnedDrawerIndicatorKeySet: Set<string>;
}

interface MonitorSchoolDrawerActions {
  setActiveSchoolDrawerTab: (tab: SchoolDrawerTab) => void;
  setSelectedSchoolDrawerYear: (value: string | null | ((current: string | null) => string | null)) => void;
  closeSchoolDrawer: () => void;
  handleJumpToMissingIndicators: () => void;
  handleJumpToReturnedIndicators: () => void;
  toggleDrawerIndicatorLabel: (key: string) => void;
  onReviewDataChanged?: (payload: {
    reason: "scope-review" | "file-preview-stale";
    submission?: IndicatorSubmission;
    decision?: "verified" | "returned" | "unverified";
    row?: MonitorDrawerPackageRow;
  }) => void | Promise<void>;
}

interface MonitorSchoolDrawerFormatting {
  workflowTone: (status: string | null) => string;
  workflowLabel: (status: string | null) => string;
  formatDateTime: (value: string) => string;
}

interface MonitorSchoolDrawerProps {
  viewState: MonitorSchoolDrawerViewState;
  loadingState: MonitorSchoolDrawerLoadingState;
  data: MonitorSchoolDrawerData;
  actions: MonitorSchoolDrawerActions;
  formatting: MonitorSchoolDrawerFormatting;
}

function isSubItemMetric(label: string): boolean {
  return /^[a-e]\.\s/i.test(label);
}

function packageRowStatusClass(tone: MonitorDrawerPackageRow["tone"]): string {
  if (tone === "warning") {
    return "border-amber-300 bg-amber-50 text-amber-700";
  }

  if (tone === "info") {
    return "border-primary-200 bg-primary-50 text-primary-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function disabledPackageActionTitle(row: MonitorDrawerPackageRow): string {
  if (!row.submissionId) {
    return "No submission yet.";
  }

  if (row.kind === "file" && row.missingFromStorage) {
    return row.fileUnavailableReason
      ?? "The submitted file record exists, but the stored file is missing. Ask the school to re-upload and resend it.";
  }

  if (row.kind === "file" && !row.viewUrl && !row.downloadUrl) {
    return row.available === false
      ? "File is unavailable for preview."
      : "File has not been uploaded yet.";
  }

  return "This requirement must be submitted before review.";
}

function errorMessageFromUnknown(error: unknown): string {
  return messageForApiError(error, "Unable to save this review decision. Please try again.");
}

function extractPreviewPayloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  if ("error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  if ("errors" in payload && payload.errors && typeof payload.errors === "object") {
    for (const value of Object.values(payload.errors as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const firstString = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
        if (firstString) {
          return firstString;
        }
      }
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return null;
}

function sanitizePreviewFailureMessage(message: string | null): string | null {
  const trimmed = String(message ?? "")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[path]")
    .replace(/\/[^\s"'<>]+/g, "[path]")
    .replace(/\s+/g, " ")
    .trim();

  if (!trimmed || trimmed.length < 3 || /<html|<!doctype/i.test(trimmed)) {
    return null;
  }

  return trimmed.length > 140 ? `${trimmed.slice(0, 137).trimEnd()}...` : trimmed;
}

async function previewFailureMessageForResponse(response: Response): Promise<string> {
  let safeMessage: string | null = null;

  try {
    const contentType = response.headers.get("content-type") ?? "";
    const rawText = await response.text();
    if (rawText.trim()) {
      if (contentType.includes("json")) {
        try {
          safeMessage = extractPreviewPayloadMessage(JSON.parse(rawText));
        } catch {
          safeMessage = rawText;
        }
      } else if (contentType.includes("text/plain")) {
        safeMessage = rawText;
      }
    }
  } catch {
    safeMessage = null;
  }

  const suffix = sanitizePreviewFailureMessage(safeMessage);
  return `Preview failed (status ${response.status}).${suffix ? ` ${suffix}.` : ""} Use Download in this modal to open the uploaded file.`;
}

function reportSectionElementId(target: MonitorDrawerPackageRow["actionTarget"]): string | null {
  if (target === "school_achievements") {
    return "monitor-submitted-report-school-achievements";
  }
  if (target === "key_performance") {
    return "monitor-submitted-report-key-performance";
  }
  return null;
}

function normalizeFileExtension(filename: string | null | undefined): string {
  const raw = String(filename ?? "").trim();
  const match = raw.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function buildAuthenticatedReportPreviewEndpoint(relativeUrl: string): string {
  const apiBaseUrl = getApiBaseUrl();

  if (/^https?:\/\//i.test(apiBaseUrl)) {
    return new URL(relativeUrl, apiBaseUrl).toString();
  }

  return relativeUrl;
}

function inferSubmissionIdFromFileUrl(relativeUrl: string | null | undefined): string | null {
  if (!relativeUrl) {
    return null;
  }

  const match = relativeUrl.match(/\/submissions\/([^/]+)\/(?:view|download)\//i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function revokeBlobUrl(blobUrl: string | null): void {
  if (blobUrl && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(blobUrl);
  }
}

type LocalScopeReviewOverride = {
  decision: "verified" | "returned" | "unverified";
  notes: string | null;
};

function scopeReviewOverrideKey(row: MonitorDrawerPackageRow): string | null {
  return row.submissionId ? `${row.submissionId}:${row.id}` : null;
}

function applyLocalScopeReviewOverride(
  row: MonitorDrawerPackageRow,
  override: LocalScopeReviewOverride | null | undefined,
): MonitorDrawerPackageRow {
  if (!override) {
    return row;
  }

  const isReturned = override.decision === "returned";
  const isUnverified = override.decision === "unverified";
  return {
    ...row,
    statusLabel: isReturned ? "Returned" : isUnverified ? "For Review" : "Verified",
    tone: isReturned ? "warning" : isUnverified ? "info" : "success",
    detail: isReturned
      ? "Returned by monitor. Waiting for School Head correction and resend."
      : row.detail,
    viewUrl: isReturned ? null : row.viewUrl,
    downloadUrl: isReturned ? null : row.downloadUrl,
    actionTarget: isReturned ? null : row.actionTarget,
    canReview: isUnverified ? true : false,
    reviewDecision: override.decision,
    reviewNotes: isReturned ? override.notes : null,
  };
}

export function MonitorSchoolDrawer({
  viewState,
  loadingState,
  data,
  actions,
  formatting,
}: MonitorSchoolDrawerProps) {
  const { apiToken } = useAuth();
  const { downloadSubmissionFile, reviewSubmissionScope } = useIndicatorData();
  const [scopeReviewSavingKey, setScopeReviewSavingKey] = useState<string | null>(null);
  const [scopeReviewError, setScopeReviewError] = useState<string>("");
  const [returnReviewRow, setReturnReviewRow] = useState<MonitorDrawerPackageRow | null>(null);
  const [returnReviewNotes, setReturnReviewNotes] = useState("");
  const [includeReturnNote, setIncludeReturnNote] = useState(false);
  const [activeFilePreviewRow, setActiveFilePreviewRow] = useState<MonitorDrawerPackageRow | null>(null);
  const [activeFilePreviewUrl, setActiveFilePreviewUrl] = useState<string | null>(null);
  const [activeFilePreviewError, setActiveFilePreviewError] = useState("");
  const [downloadingFileRowId, setDownloadingFileRowId] = useState<string | null>(null);
  const [localScopeReviewOverrides, setLocalScopeReviewOverrides] = useState<Record<string, LocalScopeReviewOverride>>({});
  const {
    isOpen,
    showNavigatorManual,
    isMobileViewport,
    activeTopNavigator,
    activeSchoolDrawerTab,
    selectedSchoolDrawerYear,
  } = viewState;
  const {
    isSchoolDrawerSubmissionsLoading,
    schoolDrawerSubmissionsError,
  } = loadingState;
  const {
    schoolDetail,
    availableSchoolDrawerYears,
    schoolDrawerYearDetail,
  } = data;
  const {
    setActiveSchoolDrawerTab,
    setSelectedSchoolDrawerYear,
    closeSchoolDrawer,
    onReviewDataChanged,
  } = actions;
  const { formatDateTime } = formatting;

  useEffect(() => {
    setLocalScopeReviewOverrides({});
  }, [isOpen, selectedSchoolDrawerYear, schoolDetail?.schoolKey]);

  const closeFilePreview = () => {
    revokeBlobUrl(activeFilePreviewUrl);
    setActiveFilePreviewRow(null);
    setActiveFilePreviewUrl(null);
    setActiveFilePreviewError("");
  };

  useEffect(() => () => {
    revokeBlobUrl(activeFilePreviewUrl);
  }, [activeFilePreviewUrl]);

  const openFilePreview = async (row: MonitorDrawerPackageRow) => {
    const relativeUrl = row.viewUrl;
    if (row.kind !== "file" || !relativeUrl) {
      return;
    }

    if (activeFilePreviewUrl) {
      revokeBlobUrl(activeFilePreviewUrl);
    }

    setActiveFilePreviewRow(row);
    setActiveFilePreviewUrl(null);
    setActiveFilePreviewError("");

    try {
      const endpoint = buildAuthenticatedReportPreviewEndpoint(relativeUrl);
      const headers = new Headers({ Accept: "*/*" });
      if (apiToken !== COOKIE_SESSION_TOKEN) {
        headers.set("Authorization", `Bearer ${apiToken}`);
      }

      const response = await fetch(endpoint, {
        method: "GET",
        credentials: apiToken === COOKIE_SESSION_TOKEN ? "include" : "omit",
        headers,
      });

      if (!response.ok) {
        if (response.status === 403) {
          setActiveFilePreviewError("This file is no longer available for monitor review. Refreshing the school detail...");
          await onReviewDataChanged?.({ reason: "file-preview-stale", row });
          return;
        }

        if (response.status === 404) {
          setActiveFilePreviewError("This file was removed or reset and can no longer be previewed. Refreshing the school detail...");
          await onReviewDataChanged?.({ reason: "file-preview-stale", row });
          return;
        }

        setActiveFilePreviewError(await previewFailureMessageForResponse(response));
        return;
      }

      setActiveFilePreviewUrl(URL.createObjectURL(await response.blob()));
    } catch {
      setActiveFilePreviewError("Preview could not be loaded due to a network or server error. Use Download in this modal to open the uploaded file.");
    }
  };

  const downloadFileRow = async (row: MonitorDrawerPackageRow) => {
    if (row.kind !== "file") {
      return;
    }

    const submissionId = row.submissionId ?? inferSubmissionIdFromFileUrl(row.downloadUrl ?? row.viewUrl);
    if (!submissionId) {
      setScopeReviewError("Download is unavailable for this file.");
      return;
    }

    const fileType = row.id as IndicatorSubmissionFileType;
    setDownloadingFileRowId(row.id);
    setScopeReviewError("");
    try {
      await downloadSubmissionFile(submissionId, fileType);
    } catch (error) {
      setScopeReviewError(errorMessageFromUnknown(error));
    } finally {
      setDownloadingFileRowId(null);
    }
  };

  const saveScopeReview = async (
    row: MonitorDrawerPackageRow,
    decision: "verified" | "returned" | "unverified",
    notes?: string | null,
  ) => {
    const canSendDecision = decision === "unverified"
      ? row.reviewDecision === "verified"
      : row.canReview;
    if (!row.submissionId || !canSendDecision) {
      return;
    }

    const reviewKey = `${row.submissionId}:${row.id}:${decision}`;
    setScopeReviewSavingKey(reviewKey);
    setScopeReviewError("");

    try {
      const updatedSubmission = await reviewSubmissionScope(row.submissionId, {
        scopeId: row.id,
        decision,
        notes: notes?.trim() || null,
      });
      const overrideKey = scopeReviewOverrideKey(row);
      if (overrideKey) {
        setLocalScopeReviewOverrides((current) => ({
          ...current,
          [overrideKey]: {
            decision,
            notes: decision === "returned" ? notes?.trim() || null : null,
          },
        }));
      }
      if (decision === "returned") {
        setReturnReviewRow(null);
        setReturnReviewNotes("");
        setIncludeReturnNote(false);
      }
      await onReviewDataChanged?.({
        reason: "scope-review",
        submission: updatedSubmission,
        decision,
        row,
      });
    } catch (error) {
      setScopeReviewError(errorMessageFromUnknown(error));
    } finally {
      setScopeReviewSavingKey(null);
    }
  };

  const submitReturnReview = () => {
    if (!returnReviewRow) {
      return;
    }

    const notes = includeReturnNote ? returnReviewNotes.trim() : "";
    if (includeReturnNote && notes.length < 3) {
      setScopeReviewError("Add a short return note before sending this back.");
      return;
    }

    void saveScopeReview(returnReviewRow, "returned", includeReturnNote ? notes : null);
  };

  const viewSectionReport = (row: MonitorDrawerPackageRow) => {
    const sectionId = reportSectionElementId(row.actionTarget ?? null);
    if (!sectionId) {
      return;
    }

    if (row.submissionId && row.actionTarget) {
      void apiRequestVoid(`/api/indicators/submissions/${row.submissionId}/report-viewed`, {
        method: "POST",
        token: apiToken,
        body: {
          scopeId: row.id,
        },
      }).catch(() => {
        // Viewing should still work if audit logging fails; backend tests cover audit behavior.
      });
    }

    setActiveSchoolDrawerTab("history");
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  return (
    <>
      {!showNavigatorManual && isOpen && activeTopNavigator !== "reviews" && (
        <button
          type="button"
          onClick={closeSchoolDrawer}
          className="fixed inset-0 z-[74] bg-slate-900/25"
          aria-label="Close school detail panel"
        />
      )}

      <aside
        style={
          activeTopNavigator === "reviews"
            ? undefined
            : isMobileViewport
              ? undefined
              : { top: "var(--shell-sticky-top, 10rem)", height: "calc(100vh - var(--shell-sticky-top, 10rem))" }
        }
        className={
          activeTopNavigator === "reviews"
            ? !showNavigatorManual && isOpen
              ? "surface-panel dashboard-shell mt-5 animate-fade-slide overflow-hidden rounded-sm border border-slate-200 bg-white shadow-sm"
              : "hidden"
            : isMobileViewport
              ? `mobile-bottom-sheet mobile-safe-bottom fixed inset-x-0 bottom-0 z-[75] flex flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl transition-transform duration-[160ms] ${
                  !showNavigatorManual && isOpen ? "translate-y-0" : "translate-y-full"
                }`
              : `fixed right-0 z-[75] flex w-[min(48rem,100vw)] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-[160ms] ${
                  !showNavigatorManual && isOpen ? "translate-x-0" : "translate-x-full"
                }`
        }
      >
        <div
          className={`flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 ${
            isMobileViewport && activeTopNavigator !== "reviews" ? "sticky top-0 z-10" : ""
          }`}
        >
          <div>
            {isMobileViewport && activeTopNavigator !== "reviews" && (
              <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300 lg:hidden" />
            )}
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">School Detail</p>
            <p className="text-sm font-semibold text-slate-900">{schoolDetail?.schoolName ?? "No school selected"}</p>
          </div>
          <button
            type="button"
            onClick={closeSchoolDrawer}
            className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={activeTopNavigator === "reviews" ? "p-4" : "flex-1 overflow-y-auto p-4 mobile-safe-bottom"}>
          {schoolDetail ? (
            <div className="space-y-3">
              <article className="rounded-sm border border-slate-200 bg-white p-2.5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <div className="inline-flex rounded-sm border border-slate-200 bg-slate-50 p-1">
                      {([
                        { id: "submissions", label: "Submissions" },
                        { id: "history", label: "Indicator History" },
                        { id: "audit", label: "Audit Trail" },
                      ] as Array<{ id: SchoolDrawerTab; label: string }>).map((tab) => (
                        <button
                          key={`school-drawer-tab-${tab.id}`}
                          type="button"
                          onClick={() => setActiveSchoolDrawerTab(tab.id)}
                          className={`rounded-sm px-2.5 py-1.5 text-xs font-semibold transition ${
                            activeSchoolDrawerTab === tab.id ? "bg-primary-700 text-white" : "text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      <span>Academic Year</span>
                      <select
                        value={selectedSchoolDrawerYear ?? ""}
                        onChange={(event) => setSelectedSchoolDrawerYear(event.target.value || null)}
                        disabled={availableSchoolDrawerYears.length === 0}
                        className="rounded-sm border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                        aria-label="Monitor school detail academic year"
                      >
                        {availableSchoolDrawerYears.length === 0 ? (
                          <option value="">No submission years yet</option>
                        ) : (
                          availableSchoolDrawerYears.map((year) => (
                            <option key={`monitor-school-drawer-year-${year.id}`} value={year.id}>
                              {year.label}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-slate-600">
                  {schoolDetail.schoolCode} | {schoolDetail.level} | {schoolDetail.type}
                </p>
              </article>

              {activeSchoolDrawerTab === "submissions" && (
                <div className="space-y-3">
                  <article className="rounded-sm border border-slate-200 bg-white">
                    {(isSchoolDrawerSubmissionsLoading || schoolDrawerSubmissionsError) && (
                      <div className="border-b border-slate-200 bg-slate-50 px-3 py-3">
                        {isSchoolDrawerSubmissionsLoading && (
                          <p className="text-[11px] font-semibold text-primary-700">Syncing latest submissions...</p>
                        )}
                        {!isSchoolDrawerSubmissionsLoading && schoolDrawerSubmissionsError && (
                          <p className="text-[11px] font-semibold text-rose-600">{schoolDrawerSubmissionsError}</p>
                        )}
                      </div>
                    )}
                    {schoolDrawerYearDetail?.packageRows.length ? (
                      <div className="overflow-x-auto">
                        {scopeReviewError && (
                          <div className="mx-3 mt-3 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                            {scopeReviewError}
                          </div>
                        )}
                        <table className="min-w-[720px] w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                              <th className="px-3 py-2 text-left">Requirement</th>
                              <th className="px-3 py-2 text-left">Status</th>
                              <th className="px-3 py-2 text-left">Submitted</th>
                              <th className="px-3 py-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {schoolDrawerYearDetail.packageRows.map((row) => {
                              const overrideKey = scopeReviewOverrideKey(row);
                              const displayRow = applyLocalScopeReviewOverride(
                                row,
                                overrideKey ? localScopeReviewOverrides[overrideKey] : null,
                              );
                              const canPreviewFile = displayRow.kind === "file" && Boolean(displayRow.viewUrl);
                              const isVerifiedRow = displayRow.reviewDecision === "verified";
                              const isReturnedRow = displayRow.reviewDecision === "returned";
                              const canViewSection = displayRow.kind === "section"
                                && Boolean(displayRow.actionTarget)
                                && (displayRow.canReview || isVerifiedRow);

                              return (
                              <tr key={`monitor-package-row-${displayRow.id}`} className="bg-white">
                                <td className="px-3 py-3 align-top">
                                  <p className="font-semibold text-slate-900">{displayRow.label}</p>
                                  <p className="mt-0.5 text-xs text-slate-500">{displayRow.detail}</p>
                                  {displayRow.kind === "file" && displayRow.missingFromStorage && (
                                    <p className="mt-2 rounded-sm border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                                      {displayRow.fileUnavailableReason
                                        ?? "The submitted file record exists, but the stored file is missing. Ask the school to re-upload and resend it."}
                                    </p>
                                  )}
                                  {displayRow.reviewDecision === "returned" && displayRow.reviewNotes && (
                                    <p className="mt-2 rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                      Return note: {displayRow.reviewNotes}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${packageRowStatusClass(displayRow.tone)}`}>
                                    {displayRow.statusLabel}
                                  </span>
                                </td>
                                <td className="px-3 py-3 align-top text-xs text-slate-600">
                                  {displayRow.submittedAt ? formatDateTime(displayRow.submittedAt) : "-"}
                                </td>
                                <td className="px-3 py-3 text-right align-top">
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    {canPreviewFile ? (
                                      <button
                                        type="button"
                                        onClick={() => void openFilePreview(displayRow)}
                                        className="inline-flex items-center rounded-sm border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 transition hover:bg-primary-100"
                                      >
                                        View
                                      </button>
                                    ) : canViewSection ? (
                                      <button
                                        type="button"
                                        onClick={() => viewSectionReport(displayRow)}
                                        className="inline-flex items-center rounded-sm border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 transition hover:bg-primary-100"
                                      >
                                        View
                                      </button>
                                    ) : null}
                                    {!canPreviewFile && !canViewSection && (
                                      <button
                                        type="button"
                                        disabled
                                        title={disabledPackageActionTitle(displayRow)}
                                        className="inline-flex items-center rounded-sm border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-400"
                                      >
                                        View
                                      </button>
                                    )}
                                    {isVerifiedRow ? (
                                      <button
                                        type="button"
                                        onClick={() => void saveScopeReview(displayRow, "unverified")}
                                        disabled={scopeReviewSavingKey !== null}
                                        title="Reopen this requirement for review."
                                        className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        Unverify
                                      </button>
                                    ) : !isReturnedRow ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => void saveScopeReview(displayRow, "verified")}
                                          disabled={!displayRow.canReview || scopeReviewSavingKey !== null}
                                          title={displayRow.canReview ? "Verify this requirement." : disabledPackageActionTitle(displayRow)}
                                          className="inline-flex items-center gap-1 rounded-sm border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
                                        >
                                          <CheckCircle2 className="h-3.5 w-3.5" />
                                          Verify
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (!displayRow.canReview) {
                                              return;
                                            }
                                            setScopeReviewError("");
                                            setReturnReviewNotes("");
                                            setIncludeReturnNote(false);
                                            setReturnReviewRow(displayRow);
                                          }}
                                          disabled={!displayRow.canReview || scopeReviewSavingKey !== null}
                                          title={displayRow.canReview ? "Return this requirement." : disabledPackageActionTitle(displayRow)}
                                          className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
                                        >
                                          <RotateCcw className="h-3.5 w-3.5" />
                                          Return
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-3 py-6 text-sm text-slate-500">
                        No required package rows are available for this school.
                      </div>
                    )}
                  </article>
                </div>
              )}

              {activeSchoolDrawerTab === "history" && (
                <article className="rounded-sm border border-slate-200 bg-white p-3">
                  <div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Indicator History</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Historical package lineage and indicator reference.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 overflow-hidden rounded-sm border border-slate-200 bg-white">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="inline-block border-l-[3px] border-primary-600 pl-3 text-base font-semibold text-slate-900">
                          TARGETS-MET
                        </span>
                      </div>
                    </div>

                    {isSchoolDrawerSubmissionsLoading ? (
                      <div className="px-4 py-5 text-sm text-slate-500">
                        Loading submitted indicators for this school...
                      </div>
                    ) : schoolDrawerYearDetail
                      && (schoolDrawerYearDetail.schoolAchievementRows.length > 0 || schoolDrawerYearDetail.kpiRows.length > 0) ? (
                      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2">
                        <div id="monitor-submitted-report-school-achievements" className="scroll-mt-24 overflow-hidden rounded-sm border border-slate-200 bg-white">
                          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                            <h3 className="text-sm font-semibold text-slate-800">
                              School&apos;s Achievement (SY {schoolDrawerYearDetail.selectedYearLabel ?? "N/A"})
                            </h3>
                          </div>
                          <table className="w-full text-[13px] text-slate-900">
                            <thead>
                              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Metric</th>
                                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Value</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E5E7EB]">
                              {schoolDrawerYearDetail.schoolAchievementRows.map((row) => (
                                <tr key={`monitor-achievement-report-${row.key}`}>
                                  <td className={`px-4 py-2.5 text-slate-900 ${isSubItemMetric(row.label) ? "pl-9 text-[12px] italic font-medium text-slate-600" : ""}`}>
                                    {row.label}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-slate-900">
                                    <span className="font-semibold text-slate-900">
                                      {row.value}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div id="monitor-submitted-report-key-performance" className="scroll-mt-24 overflow-hidden rounded-sm border border-slate-200 bg-white">
                          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
                            <h3 className="text-sm font-semibold text-slate-800">
                              Key Performance Indicators (SY {schoolDrawerYearDetail.selectedYearLabel ?? "N/A"})
                            </h3>
                          </div>
                          <table className="w-full text-[13px] text-slate-900">
                            <thead>
                              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB]">
                                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Indicator</th>
                                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Target</th>
                                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Actual</th>
                                <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.6px] text-slate-500">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#E5E7EB]">
                              {schoolDrawerYearDetail.kpiRows.map((row) => (
                                <tr key={`monitor-kpi-report-${row.key}`}>
                                  <td className="px-4 py-2.5 text-slate-900">{row.label}</td>
                                  <td className="px-4 py-2.5 text-center text-slate-900">
                                    <span className="font-semibold text-slate-900">
                                      {row.target}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-center text-slate-900">
                                    <span className="font-semibold text-slate-900">
                                      {row.actual}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-center text-slate-900">{row.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-5 text-sm text-slate-500">
                        {schoolDrawerYearDetail?.reportBlankStateLines[0] ?? "No monitor-visible submitted report package exists yet for the selected academic year."}
                      </div>
                    )}
                  </div>

                </article>
              )}

              {activeSchoolDrawerTab === "audit" && (
                <MonitorAuditTrail
                  compact
                  title="School Audit Trail"
                  description="Recent workflow activity for this school and selected academic year."
                  schoolCode={schoolDetail.schoolCode}
                  academicYearLabel={schoolDrawerYearDetail?.selectedYearLabel ?? selectedSchoolDrawerYear}
                />
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Select a school to view details.
            </div>
          )}
        </div>
      </aside>

      {activeFilePreviewRow && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-slate-950/70 p-3 backdrop-blur-sm">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-slate-300 bg-white shadow-2xl">
            <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  {(SUBMISSION_FILE_DEFINITION_BY_TYPE[activeFilePreviewRow.id as IndicatorSubmissionFileType]?.shortLabel ?? activeFilePreviewRow.label)} Report
                </p>
                <p className="mt-1 text-xs text-slate-500">{activeFilePreviewRow.detail}</p>
              </div>
              <div className="flex items-center gap-2">
                {activeFilePreviewRow.downloadUrl && (
                  <button
                    type="button"
                    onClick={() => void downloadFileRow(activeFilePreviewRow)}
                    disabled={downloadingFileRowId === activeFilePreviewRow.id}
                    className="inline-flex items-center gap-1 rounded-sm border border-primary-300 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 disabled:cursor-wait disabled:opacity-70"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {downloadingFileRowId === activeFilePreviewRow.id ? "Downloading..." : "Download"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeFilePreview}
                  className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100"
                  aria-label="Close file preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
              {activeFilePreviewError ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-600">
                  {activeFilePreviewError}
                </div>
              ) : !activeFilePreviewUrl ? (
                <div className="flex h-full items-center justify-center rounded-sm border border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-600">
                  Loading report preview...
                </div>
              ) : (() => {
                const extension = normalizeFileExtension(activeFilePreviewRow.detail);
                if (extension === "pdf") {
                  return (
                    <iframe
                      title={`${activeFilePreviewRow.label} PDF preview`}
                      src={activeFilePreviewUrl}
                      className="h-full w-full rounded-sm border border-slate-300 bg-white"
                    />
                  );
                }
                if (extension === "png" || extension === "jpg" || extension === "jpeg" || extension === "webp" || extension === "gif") {
                  return (
                    <div className="flex h-full items-center justify-center overflow-auto rounded-sm border border-slate-300 bg-white p-4">
                      <img
                        src={activeFilePreviewUrl}
                        alt={`${activeFilePreviewRow.label} report`}
                        className="max-h-full max-w-full"
                      />
                    </div>
                  );
                }
                if (extension === "xlsx" || extension === "xls" || extension === "csv") {
                  return (
                    <div className="flex h-full items-center justify-center rounded-sm border border-slate-300 bg-white p-6 text-center text-sm font-semibold text-slate-600">
                      Spreadsheet preview is not available in the browser. Use Download to open the uploaded file.
                    </div>
                  );
                }
                return (
                  <iframe
                    title={`${activeFilePreviewRow.label} report preview`}
                    src={activeFilePreviewUrl}
                    className="h-full w-full rounded-sm border border-slate-300 bg-white"
                  />
                );
              })()}
            </div>
          </section>
        </div>
      )}

      {returnReviewRow && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-sm border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Return Requirement</p>
                <p className="mt-1 text-xs text-slate-600">
                  Returning {returnReviewRow.label} will notify the School Head. A note is optional.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReturnReviewRow(null);
                  setReturnReviewNotes("");
                  setIncludeReturnNote(false);
                }}
                className="rounded-sm border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-100"
                aria-label="Close return requirement dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 px-4 py-4">
              {scopeReviewError && (
                <div className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {scopeReviewError}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={includeReturnNote}
                  onChange={(event) => {
                    setIncludeReturnNote(event.target.checked);
                    if (!event.target.checked) {
                      setReturnReviewNotes("");
                    }
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary-200"
                />
                Include a note to the School Head
              </label>
              {includeReturnNote && (
                <>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="scope-return-note">
                    Return note
                  </label>
                  <textarea
                    id="scope-return-note"
                    value={returnReviewNotes}
                    onChange={(event) => setReturnReviewNotes(event.target.value)}
                    rows={4}
                    maxLength={2000}
                    className="w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-100"
                    placeholder="Explain what needs to be corrected or clarified."
                  />
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setReturnReviewRow(null);
                  setReturnReviewNotes("");
                  setIncludeReturnNote(false);
                }}
                className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReturnReview}
                disabled={scopeReviewSavingKey !== null || (includeReturnNote && returnReviewNotes.trim().length < 3)}
                className="rounded-sm border border-amber-600 bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Return requirement
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
