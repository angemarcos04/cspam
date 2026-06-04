import { Fragment, useState } from "react";
import { CheckCircle2, RotateCcw, X } from "lucide-react";
import { useIndicatorData } from "@/context/IndicatorData";
import type { MonitorTopNavigatorId } from "@/pages/monitor/monitorFilters";
import type {
  MonitorDrawerHistorySummary,
  MonitorDrawerPackageRow,
  MonitorDrawerYearDetail,
  SchoolDetailSnapshot,
  SchoolDrawerCriticalAlert,
  SchoolIndicatorMatrix,
  SchoolIndicatorPackageRow,
  SchoolIndicatorRowGroup,
} from "@/pages/monitor/monitorDrawerTypes";
import type { SchoolDrawerTab } from "@/pages/monitor/useSchoolDrawer";
import type { IndicatorSubmission } from "@/types";
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
  availableSchoolDrawerYears: string[];
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

function truncateIndicatorDescription(value: string, maxLength = 48): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(12, maxLength - 3)).trimEnd()}...`;
}

function sanitizeAnchorToken(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "row";
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

  if (row.kind === "file" && !row.viewUrl && !row.downloadUrl) {
    return "File has not been uploaded yet.";
  }

  return "This requirement must be submitted before review.";
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Unable to save this review decision. Please try again.";
}

export function MonitorSchoolDrawer({
  viewState,
  loadingState,
  data,
  actions,
  formatting,
}: MonitorSchoolDrawerProps) {
  const { reviewSubmissionScope } = useIndicatorData();
  const [scopeReviewSavingKey, setScopeReviewSavingKey] = useState<string | null>(null);
  const [scopeReviewError, setScopeReviewError] = useState<string>("");
  const [returnReviewRow, setReturnReviewRow] = useState<MonitorDrawerPackageRow | null>(null);
  const [returnReviewNotes, setReturnReviewNotes] = useState("");
  const {
    isOpen,
    showNavigatorManual,
    isMobileViewport,
    activeTopNavigator,
    activeSchoolDrawerTab,
    selectedSchoolDrawerYear,
    highlightedDrawerIndicatorKey,
    expandedDrawerIndicatorRows,
  } = viewState;
  const {
    isSchoolDrawerSubmissionsLoading,
    schoolDrawerSubmissionsError,
  } = loadingState;
  const {
    schoolDetail,
    availableSchoolDrawerYears,
    schoolDrawerYearDetail,
    schoolDrawerHistorySummary,
    schoolDrawerCriticalAlerts,
    schoolIndicatorPackageRows,
    latestSchoolPackage,
    schoolIndicatorMatrix,
    latestSchoolIndicatorYear,
    schoolDrawerIndicatorSubmissions,
    schoolIndicatorRowsByCategory,
    missingDrawerIndicatorKeys,
    returnedDrawerIndicatorKeys,
    missingDrawerIndicatorKeySet,
    returnedDrawerIndicatorKeySet,
  } = data;
  const {
    setActiveSchoolDrawerTab,
    setSelectedSchoolDrawerYear,
    closeSchoolDrawer,
    handleJumpToMissingIndicators,
    handleJumpToReturnedIndicators,
    toggleDrawerIndicatorLabel,
  } = actions;
  const { workflowTone, workflowLabel, formatDateTime } = formatting;

  const saveScopeReview = async (
    row: MonitorDrawerPackageRow,
    decision: "verified" | "returned",
    notes?: string | null,
  ) => {
    if (!row.submissionId || !row.canReview) {
      return;
    }

    const reviewKey = `${row.submissionId}:${row.id}:${decision}`;
    setScopeReviewSavingKey(reviewKey);
    setScopeReviewError("");

    try {
      await reviewSubmissionScope(row.submissionId, {
        scopeId: row.id,
        decision,
        notes: notes?.trim() || null,
      });
      if (decision === "returned") {
        setReturnReviewRow(null);
        setReturnReviewNotes("");
      }
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

    const notes = returnReviewNotes.trim();
    if (notes.length < 3) {
      setScopeReviewError("Add a short return note before sending this back.");
      return;
    }

    void saveScopeReview(returnReviewRow, "returned", notes);
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
                        { id: "history", label: "History (Reference)" },
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
                            <option key={`monitor-school-drawer-year-${year}`} value={year}>
                              {year}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>
                  {(missingDrawerIndicatorKeys.length > 0 || returnedDrawerIndicatorKeys.length > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                      {missingDrawerIndicatorKeys.length > 0 && (
                        <button
                          type="button"
                          onClick={handleJumpToMissingIndicators}
                          className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100"
                        >
                          Jump to Missing ({missingDrawerIndicatorKeys.length})
                        </button>
                      )}
                      {returnedDrawerIndicatorKeys.length > 0 && (
                        <button
                          type="button"
                          onClick={handleJumpToReturnedIndicators}
                          className="inline-flex items-center rounded-sm border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700 transition hover:bg-primary-100"
                        >
                          Jump to Returned ({returnedDrawerIndicatorKeys.length})
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-600">
                  {schoolDetail.schoolCode} | {schoolDetail.level} | {schoolDetail.type}
                </p>
              </article>

              {activeSchoolDrawerTab === "submissions" && (
                <div className="space-y-3">
                  <article className="rounded-sm border border-slate-200 bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Submitted Packages</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {schoolDrawerYearDetail?.selectedYearLabel
                            ? `Viewing SY ${schoolDrawerYearDetail.selectedYearLabel}.`
                            : "Select an academic year to review this school."}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Required files and form sections for the selected academic year.
                        </p>
                        {isSchoolDrawerSubmissionsLoading && (
                          <p className="mt-1 text-[11px] font-semibold text-primary-700">Syncing latest submissions...</p>
                        )}
                        {!isSchoolDrawerSubmissionsLoading && schoolDrawerSubmissionsError && (
                          <p className="mt-1 text-[11px] font-semibold text-rose-600">{schoolDrawerSubmissionsError}</p>
                        )}
                      </div>
                      <div className="rounded-sm border border-slate-200 bg-white px-3 py-2 text-right">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Package status</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {schoolDrawerYearDetail?.selectedYearLatestStatus
                            ? workflowLabel(schoolDrawerYearDetail.selectedYearLatestStatus)
                            : "Not submitted"}
                        </p>
                      </div>
                    </div>
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
                            {schoolDrawerYearDetail.packageRows.map((row) => (
                              <tr key={`monitor-package-row-${row.id}`} className="bg-white">
                                <td className="px-3 py-3 align-top">
                                  <p className="font-semibold text-slate-900">{row.label}</p>
                                  <p className="mt-0.5 text-xs text-slate-500">{row.detail}</p>
                                  {row.reviewDecision === "returned" && row.reviewNotes && (
                                    <p className="mt-2 rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                                      Return note: {row.reviewNotes}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${packageRowStatusClass(row.tone)}`}>
                                    {row.statusLabel}
                                  </span>
                                </td>
                                <td className="px-3 py-3 align-top text-xs text-slate-600">
                                  {row.submittedAt ? formatDateTime(row.submittedAt) : "-"}
                                </td>
                                <td className="px-3 py-3 text-right align-top">
                                  <div className="flex flex-wrap justify-end gap-1.5">
                                    {row.viewUrl ? (
                                      <a
                                        href={row.viewUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center rounded-sm border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 transition hover:bg-primary-100"
                                      >
                                        {row.actionLabel ?? `View ${row.label}`}
                                      </a>
                                    ) : row.downloadUrl ? (
                                      <a
                                        href={row.downloadUrl}
                                        className="inline-flex items-center rounded-sm border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                                      >
                                        Download
                                      </a>
                                    ) : null}
                                    {!row.viewUrl && !row.downloadUrl && (
                                      <button
                                        type="button"
                                        disabled
                                        title={disabledPackageActionTitle(row)}
                                        className="inline-flex items-center rounded-sm border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-400"
                                      >
                                        View
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => void saveScopeReview(row, "verified")}
                                      disabled={!row.canReview || scopeReviewSavingKey !== null}
                                      title={row.canReview ? "Verify this requirement." : disabledPackageActionTitle(row)}
                                      className="inline-flex items-center gap-1 rounded-sm border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Verify
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!row.canReview) {
                                          return;
                                        }
                                        setScopeReviewError("");
                                        setReturnReviewNotes(row.reviewNotes ?? "");
                                        setReturnReviewRow(row);
                                      }}
                                      disabled={!row.canReview || scopeReviewSavingKey !== null}
                                      title={row.canReview ? "Return this requirement with a note." : disabledPackageActionTitle(row)}
                                      className="inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-slate-50"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      Return
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-3 py-6 text-sm text-slate-500">
                        No required package rows are available for this school.
                      </div>
                    )}
                  </article>

                  {schoolDrawerCriticalAlerts.length > 0 && (
                    <article className="rounded-sm border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Critical Alerts</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Last activity: {schoolDetail.lastActivityAt ? formatDateTime(schoolDetail.lastActivityAt) : "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 space-y-2">
                        {schoolDrawerCriticalAlerts.map((alert) => (
                          <div
                            key={`school-critical-alert-${alert.id}`}
                            className={`rounded-sm border px-2.5 py-2 ${
                              alert.tone === "warning"
                                ? "border-amber-300 bg-amber-50 text-amber-800"
                                : "border-primary-200 bg-primary-50 text-primary-700"
                            }`}
                          >
                            <p className="text-xs font-semibold">{alert.title}</p>
                            <p className="mt-0.5 text-xs">{alert.detail}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  )}
                </div>
              )}

              {activeSchoolDrawerTab === "history" && (
                <article className="rounded-sm border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Indicator History</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Historical package lineage and indicator reference. Hover or expand rows for full descriptions.
                      </p>
                    </div>
                    <div className="text-right text-[11px] text-slate-600">
                      <p>
                        Latest package: <span className="font-semibold text-slate-900">{schoolDrawerHistorySummary?.latestHistoryPackageId ? `#${schoolDrawerHistorySummary.latestHistoryPackageId}` : "N/A"}</span>
                      </p>
                      <p>
                        Matrix source year: <span className="font-semibold text-slate-900">{schoolDrawerHistorySummary?.latestRenderableSchoolYear ?? (latestSchoolIndicatorYear || "N/A")}</span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-sm border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-700">History Summary</p>
                        <p className="text-sm font-semibold text-slate-900">
                          {schoolDrawerHistorySummary?.historyAvailabilityLabel ?? "History status unavailable"}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          {schoolDrawerHistorySummary?.historyExplanation ?? "No history explanation available yet."}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        <div className="rounded-sm border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] text-slate-600">Packages</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {schoolDrawerHistorySummary?.historyPackageCount.toLocaleString() ?? "0"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] text-slate-600">School Years</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {schoolDrawerHistorySummary?.historySchoolYearCount.toLocaleString() ?? "0"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] text-slate-600">Renderable Packages</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {schoolDrawerHistorySummary?.packagesWithRenderableRowsCount.toLocaleString() ?? "0"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] text-slate-600">Without Rows</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {schoolDrawerHistorySummary?.packagesWithoutRenderableRowsCount.toLocaleString() ?? "0"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] text-slate-600">Latest Package</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {schoolDrawerHistorySummary?.latestHistoryPackageId ? `#${schoolDrawerHistorySummary.latestHistoryPackageId}` : "N/A"}
                          </p>
                        </div>
                        <div className="rounded-sm border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[11px] text-slate-600">History Source</p>
                          <p className="text-sm font-semibold text-slate-900">
                            {schoolDrawerHistorySummary?.latestRenderableSubmissionId ? `#${schoolDrawerHistorySummary.latestRenderableSubmissionId}` : "N/A"}
                          </p>
                        </div>
                      </div>
                    </div>
                    {schoolDrawerHistorySummary?.historyFallbackReason ? (
                      <div className="mt-3 rounded-sm border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                        {schoolDrawerHistorySummary.historyFallbackReason}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-sm border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Package History Context</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          This shows which package is the latest activity and which package is currently supplying renderable history detail.
                        </p>
                      </div>
                    </div>
                    {schoolIndicatorPackageRows.length === 0 ? (
                      <div className="mt-2 rounded-sm border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                        No package history exists yet for this school.
                      </div>
                    ) : (
                      <div className="mt-2 overflow-x-auto rounded-sm border border-slate-200">
                        <table className="min-w-[820px] w-full border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                              <th className="border border-slate-300 px-2 py-2 text-left">Package</th>
                              <th className="border border-slate-300 px-2 py-2 text-left">School Year</th>
                              <th className="border border-slate-300 px-2 py-2 text-center">Status</th>
                              <th className="border border-slate-300 px-2 py-2 text-center">Indicator Rows</th>
                              <th className="border border-slate-300 px-2 py-2 text-center">History Role</th>
                              <th className="border border-slate-300 px-2 py-2 text-left">Submitted</th>
                              <th className="border border-slate-300 px-2 py-2 text-left">Reviewed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {schoolIndicatorPackageRows.map((row) => {
                              const matchingSubmission = schoolDrawerIndicatorSubmissions.find((submission) => submission.id === row.id);
                              const hasIndicatorRows = Array.isArray(matchingSubmission?.indicators) && matchingSubmission.indicators.length > 0;
                              const historyRole =
                                schoolDrawerHistorySummary?.latestRenderableSubmissionId === row.id
                                  ? "Matrix source"
                                  : latestSchoolPackage?.id === row.id
                                    ? "Latest activity"
                                    : "Historical only";

                              return (
                                <tr key={`monitor-history-package-${row.id}`} className="bg-white">
                                  <td className="border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-900">#{row.id}</td>
                                  <td className="border border-slate-300 px-2 py-2 text-xs text-slate-700">{row.schoolYear}</td>
                                  <td className="border border-slate-300 px-2 py-2 text-center">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${workflowTone(row.status)}`}>
                                      {workflowLabel(row.status)}
                                    </span>
                                  </td>
                                  <td className="border border-slate-300 px-2 py-2 text-center text-xs text-slate-700">
                                    {hasIndicatorRows ? "Available" : "None"}
                                  </td>
                                  <td className="border border-slate-300 px-2 py-2 text-center text-xs text-slate-700">{historyRole}</td>
                                  <td className="border border-slate-300 px-2 py-2 text-xs text-slate-700">
                                    {row.submittedAt ? formatDateTime(row.submittedAt) : "N/A"}
                                  </td>
                                  <td className="border border-slate-300 px-2 py-2 text-xs text-slate-700">
                                    {row.reviewedAt ? formatDateTime(row.reviewedAt) : "N/A"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {schoolIndicatorMatrix.rows.length === 0 ? (
                    <div className="mt-3 rounded-sm border border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-500">
                      {isSchoolDrawerSubmissionsLoading
                        ? "Loading submitted indicators for this school..."
                        : schoolDrawerIndicatorSubmissions.length === 0
                          ? "No package history exists yet for this school."
                          : schoolDrawerHistorySummary?.historyFallbackReason
                            ?? "Packages exist, but none contain indicator rows for history rendering."}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-sm border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Indicator Matrix</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Currently representing package {schoolDrawerHistorySummary?.latestRenderableSubmissionId ? `#${schoolDrawerHistorySummary.latestRenderableSubmissionId}` : "history source unavailable"} for {schoolDrawerHistorySummary?.latestRenderableSchoolYear ?? (latestSchoolIndicatorYear || "N/A")}.
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-slate-600">
                          <p>
                            {schoolDrawerHistorySummary?.latestRenderableSubmissionId === schoolDrawerHistorySummary?.latestHistoryPackageId
                              ? "Latest package includes renderable indicator rows."
                              : "Matrix is using the most recent package with indicator rows."}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 overflow-x-auto rounded-sm border border-slate-200">
                        <table className="min-w-[1080px] w-full border-collapse">
                          <thead>
                            <tr className="bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                              <th rowSpan={2} className="sticky left-0 z-20 min-w-[270px] border border-slate-300 bg-slate-100 px-2 py-2 text-left">
                              Indicators
                            </th>
                            {schoolIndicatorMatrix.years.map((year) => (
                              <th key={`monitor-indicator-year-${year}`} colSpan={2} className="border border-slate-300 px-2 py-2 text-center">
                                {year}
                              </th>
                            ))}
                          </tr>
                          <tr className="bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                            {schoolIndicatorMatrix.years.map((year) => (
                              <Fragment key={`monitor-indicator-year-columns-${year}`}>
                                <th className="border border-slate-300 px-2 py-2 text-center">Target</th>
                                <th className="border border-slate-300 px-2 py-2 text-center">Actual</th>
                              </Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {schoolIndicatorRowsByCategory.map((group) => (
                            <Fragment key={`monitor-indicator-category-${group.category}`}>
                              <tr className="bg-primary-50/70">
                                <td
                                  colSpan={schoolIndicatorMatrix.years.length * 2 + 1}
                                  className="border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary-800"
                                >
                                  {group.category}
                                </td>
                              </tr>
                              {group.rows.map((row) => {
                                const rowId = `school-drawer-indicator-${sanitizeAnchorToken(row.key)}`;
                                const isExpanded = Boolean(expandedDrawerIndicatorRows[row.key]);
                                const shortLabel = truncateIndicatorDescription(row.label, 46);
                                const isHighlighted = highlightedDrawerIndicatorKey === row.key;
                                const isMissing = missingDrawerIndicatorKeySet.has(row.key);
                                const isReturned = returnedDrawerIndicatorKeySet.has(row.key);

                                return (
                                  <tr
                                    id={rowId}
                                    key={`monitor-indicator-row-${row.key}`}
                                    className={isHighlighted ? "bg-amber-50 transition-colors" : "bg-white"}
                                  >
                                    <td className="sticky left-0 z-10 min-w-[270px] border border-slate-300 bg-white px-2 py-2 align-top">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                          type="button"
                                          title={row.label}
                                          onClick={() => toggleDrawerIndicatorLabel(row.key)}
                                          className="text-left text-[12px] font-semibold leading-4 text-slate-900 hover:text-primary-700"
                                        >
                                          {isExpanded ? row.label : shortLabel}
                                        </button>
                                        {isMissing && (
                                          <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                            Missing
                                          </span>
                                        )}
                                        {isReturned && (
                                          <span className="inline-flex rounded-full border border-primary-300 bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700">
                                            Returned
                                          </span>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => toggleDrawerIndicatorLabel(row.key)}
                                          className="rounded-sm border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 transition hover:bg-slate-100"
                                        >
                                          {isExpanded ? "Less" : "More"}
                                        </button>
                                      </div>
                                      <p className="mt-0.5 text-[10px] text-slate-500">{row.code}</p>
                                    </td>
                                    {schoolIndicatorMatrix.years.map((year) => {
                                      const values = row.valuesByYear[year] ?? { target: "", actual: "" };

                                      return (
                                        <Fragment key={`monitor-indicator-cell-${row.key}-${year}`}>
                                          <td className="border border-slate-300 bg-slate-50/40 px-2 py-2 text-center text-xs text-slate-700">
                                            {values.target || "-"}
                                          </td>
                                          <td className="border border-slate-300 bg-slate-50/40 px-2 py-2 text-center text-xs text-slate-700">
                                            {values.actual || "-"}
                                          </td>
                                        </Fragment>
                                      );
                                    })}
                                  </tr>
                                );
                              })}
                            </Fragment>
                          ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </article>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Select a school to view details.
            </div>
          )}
        </div>
      </aside>

      {returnReviewRow && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-sm border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Return Requirement</p>
                <p className="mt-1 text-xs text-slate-600">
                  Add a note for {returnReviewRow.label}. The School Head will see this on their dashboard.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReturnReviewRow(null);
                  setReturnReviewNotes("");
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
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="scope-return-note">
                Return note
              </label>
              <textarea
                id="scope-return-note"
                value={returnReviewNotes}
                onChange={(event) => setReturnReviewNotes(event.target.value)}
                rows={4}
                className="w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-100"
                placeholder="Explain what needs to be corrected or clarified."
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setReturnReviewRow(null);
                  setReturnReviewNotes("");
                }}
                className="rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitReturnReview}
                disabled={scopeReviewSavingKey !== null || returnReviewNotes.trim().length < 3}
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
