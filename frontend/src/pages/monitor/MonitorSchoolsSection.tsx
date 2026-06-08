import type { ChangeEvent, RefObject } from "react";
import {
  Building2,
  ChevronDown,
  Database,
  Download,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { MonitorArchivedSchools, type MonitorArchivedSchoolsProps } from "@/pages/monitor/MonitorArchivedSchools";
import {
  MonitorSchoolHeadAccountsPanel,
  type MonitorSchoolHeadAccountsPanelProps,
} from "@/pages/monitor/MonitorSchoolHeadAccountsPanel";
import { MonitorSchoolMessages, type MonitorSchoolMessagesProps } from "@/pages/monitor/MonitorSchoolMessages";
import { MonitorSchoolRecordForm, type MonitorSchoolRecordFormProps } from "@/pages/monitor/MonitorSchoolRecordForm";
import { MonitorSchoolRecordsList, type MonitorSchoolRecordsListProps } from "@/pages/monitor/MonitorSchoolRecordsList";
import { MonitorQuickJumpChips, type MonitorQuickJumpBindings } from "@/pages/monitor/MonitorQuickJumpChips";
import type { SchoolCategoryCounts } from "@/pages/monitor/useMonitorRequirementData";
import type { MonitorRadarTotals } from "@/pages/monitor/useMonitorRadarTotals";
import type { SchoolLevelFilter, SchoolSectorFilter } from "@/pages/monitor/monitorFilters";

interface MonitorSchoolsSectionProps {
  sectionFocusClass: (targetId: string) => string;
  isMobileViewport: boolean;
  quickJumpBindings: MonitorQuickJumpBindings;
  totalSchoolsInScope: number;
  monitorRadarTotals: MonitorRadarTotals;
  schoolCategoryCounts: SchoolCategoryCounts;
  schoolSectorFilter: SchoolSectorFilter;
  schoolLevelFilter: SchoolLevelFilter;
  onClearSchoolCategoryFilter: () => void;
  onSelectSchoolCategoryFilter: (sector: Exclude<SchoolSectorFilter, "all">, level?: SchoolLevelFilter) => void;
  paginatedCompactSchoolRowsCount: number;
  compactSchoolRowsCount: number;
  activeSchoolPresetLabel: string | null;
  schoolActionsMenuRef: RefObject<HTMLDivElement>;
  bulkImportInputRef: RefObject<HTMLInputElement>;
  onBulkImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onOpenCreateRecordForm: () => void;
  onToggleAccountsPanel: () => void;
  showSchoolHeadAccountsPanel: boolean;
  onToggleActionsMenu: () => void;
  isSchoolActionsMenuOpen: boolean;
  onDownloadCsvFormat: () => void;
  onOpenBulkImportPicker: () => void;
  isBulkImporting: boolean;
  onToggleArchivedRecords: () => void;
  showArchivedRecords: boolean;
  onShowMfaResetApprovals: () => void;
  schoolHeadAccountsPanelProps: MonitorSchoolHeadAccountsPanelProps | null;
  messages: MonitorSchoolMessagesProps;
  schoolRecordFormProps: MonitorSchoolRecordFormProps;
  schoolRecordsListProps: MonitorSchoolRecordsListProps;
  archivedSchoolsProps: MonitorArchivedSchoolsProps;
}

export function MonitorSchoolsSection({
  sectionFocusClass,
  isMobileViewport,
  quickJumpBindings,
  totalSchoolsInScope,
  monitorRadarTotals,
  schoolCategoryCounts,
  schoolSectorFilter,
  schoolLevelFilter,
  onClearSchoolCategoryFilter,
  onSelectSchoolCategoryFilter,
  paginatedCompactSchoolRowsCount,
  compactSchoolRowsCount,
  activeSchoolPresetLabel,
  schoolActionsMenuRef,
  bulkImportInputRef,
  onBulkImportFileChange,
  onOpenCreateRecordForm,
  onToggleAccountsPanel,
  showSchoolHeadAccountsPanel,
  onToggleActionsMenu,
  isSchoolActionsMenuOpen,
  onDownloadCsvFormat,
  onOpenBulkImportPicker,
  isBulkImporting,
  onToggleArchivedRecords,
  showArchivedRecords,
  onShowMfaResetApprovals,
  schoolHeadAccountsPanelProps,
  messages,
  schoolRecordFormProps,
  schoolRecordsListProps,
  archivedSchoolsProps,
}: MonitorSchoolsSectionProps) {
  const currentPublicLevel = schoolSectorFilter === "public" ? schoolLevelFilter : "all";
  const currentPrivateLevel = schoolSectorFilter === "private" ? schoolLevelFilter : "all";
  const hasCategoryFilter = schoolSectorFilter !== "all" || schoolLevelFilter !== "all";
  const totalSchoolsCount = schoolCategoryCounts.total || totalSchoolsInScope;

  const categoryCardClass = (isActive: boolean) =>
    `w-full rounded-sm border px-3 py-3 text-left transition ${
      isActive
        ? "border-primary-300 bg-primary-50 text-primary-900"
        : "border-slate-200 bg-slate-50 text-slate-900 hover:border-primary-200 hover:bg-white"
    }`;
  const categoryButtonClass = "w-full text-left focus:outline-none focus:ring-2 focus:ring-primary-200";

  const selectClass =
    "mt-3 w-full rounded-sm border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100";

  return (
    <>
      <div id="monitor-school-radar" className={`bg-white p-3 ${sectionFocusClass("monitor-school-radar")}`}>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <article className={categoryCardClass(!hasCategoryFilter)}>
            <button
              type="button"
              onClick={onClearSchoolCategoryFilter}
              aria-pressed={!hasCategoryFilter}
              className={categoryButtonClass}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Total Schools</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-slate-900">{totalSchoolsCount.toLocaleString()}</p>
                  <p className="mt-2 text-[11px] font-medium text-slate-500">
                    {hasCategoryFilter ? "Click to show all schools" : "Showing all schools"}
                  </p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-slate-200 bg-white text-primary-700">
                  <Building2 className="h-5 w-5" />
                </span>
              </div>
            </button>
          </article>

          <article className={categoryCardClass(schoolSectorFilter === "public")}>
            <button
              type="button"
              onClick={() => onSelectSchoolCategoryFilter("public", "all")}
              aria-pressed={schoolSectorFilter === "public" && schoolLevelFilter === "all"}
              className={categoryButtonClass}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Total Public Schools</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-slate-900">{schoolCategoryCounts.public.toLocaleString()}</p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-slate-200 bg-white text-primary-700">
                  <Building2 className="h-5 w-5" />
                </span>
              </div>
            </button>
            <select
              aria-label="Filter public schools by level"
              value={currentPublicLevel}
              onChange={(event) => onSelectSchoolCategoryFilter("public", event.target.value as SchoolLevelFilter)}
              className={selectClass}
            >
              <option value="all">All public levels</option>
              <option value="elementary">Elementary ({schoolCategoryCounts.publicElementary.toLocaleString()})</option>
              <option value="high_school">High School ({schoolCategoryCounts.publicHighSchool.toLocaleString()})</option>
            </select>
          </article>

          <article className={categoryCardClass(schoolSectorFilter === "private")}>
            <button
              type="button"
              onClick={() => onSelectSchoolCategoryFilter("private", "all")}
              aria-pressed={schoolSectorFilter === "private" && schoolLevelFilter === "all"}
              className={categoryButtonClass}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">Total Private Schools</p>
                  <p className="mt-1 text-3xl font-bold leading-none text-slate-900">{schoolCategoryCounts.private.toLocaleString()}</p>
                </div>
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-slate-200 bg-white text-primary-700">
                  <Users className="h-5 w-5" />
                </span>
              </div>
            </button>
            <select
              aria-label="Filter private schools by level"
              value={currentPrivateLevel}
              onChange={(event) => onSelectSchoolCategoryFilter("private", event.target.value as SchoolLevelFilter)}
              className={selectClass}
            >
              <option value="all">All private levels</option>
              <option value="elementary">Elementary ({schoolCategoryCounts.privateElementary.toLocaleString()})</option>
              <option value="high_school">High School ({schoolCategoryCounts.privateHighSchool.toLocaleString()})</option>
            </select>
          </article>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
          <span>
            {monitorRadarTotals.syncedAt
              ? `Synced ${new Date(monitorRadarTotals.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Waiting for sync"}
          </span>
        </div>
      </div>

      <section
        id="monitor-school-records"
        className={`surface-panel dashboard-shell mt-5 animate-fade-slide overflow-hidden ${sectionFocusClass("monitor-school-records")}`}
      >
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Schools</h2>
            </div>
            {!isMobileViewport && <MonitorQuickJumpChips {...quickJumpBindings} mobile={false} />}
          </div>
          {isMobileViewport && <MonitorQuickJumpChips {...quickJumpBindings} mobile />}
        </div>

        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600">
              <p>
                Showing {paginatedCompactSchoolRowsCount} visible of {compactSchoolRowsCount}
              </p>
              {totalSchoolsInScope !== compactSchoolRowsCount ? (
                <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                  In scope: {totalSchoolsInScope}
                </p>
              ) : null}
              {activeSchoolPresetLabel ? (
                <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                  Preset: {activeSchoolPresetLabel}
                </p>
              ) : null}
              {schoolRecordsListProps.hasDashboardFilters && compactSchoolRowsCount < totalSchoolsInScope ? (
                <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                  Visible rows are limited by current filters.
                </p>
              ) : null}
            </div>
            <div ref={schoolActionsMenuRef} className="relative flex flex-wrap items-center gap-2">
              <input
                ref={bulkImportInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => void onBulkImportFileChange(event)}
              />
              <button
                type="button"
                onClick={onOpenCreateRecordForm}
                className="inline-flex items-center gap-1 rounded-sm border border-primary-300/70 bg-primary px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-600"
              >
                <Plus className="h-3.5 w-3.5" />
                Add School
              </button>
              <button
                type="button"
                onClick={onToggleAccountsPanel}
                className={`inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-xs font-semibold transition ${
                  showSchoolHeadAccountsPanel
                    ? "border-primary-200 bg-primary-50 text-primary-800 hover:bg-primary-100"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                Accounts
              </button>
              <button
                type="button"
                onClick={onToggleActionsMenu}
                className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                More
                <ChevronDown className={`h-3.5 w-3.5 transition ${isSchoolActionsMenuOpen ? "rotate-180" : ""}`} />
              </button>
              {isSchoolActionsMenuOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-sm border border-slate-200 bg-white shadow-xl">
                  <button
                    type="button"
                    onClick={onDownloadCsvFormat}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5 text-primary-600" />
                    Download CSV Format
                  </button>
                  <button
                    type="button"
                    onClick={onOpenBulkImportPicker}
                    disabled={isBulkImporting}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <Database className="h-3.5 w-3.5 text-primary-600" />
                    {isBulkImporting ? "Importing..." : "Import CSV"}
                  </button>
                  <button
                    type="button"
                    onClick={onToggleArchivedRecords}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-primary-600" />
                    {showArchivedRecords ? "Hide Archived" : "Show Archived"}
                  </button>
                  <button
                    type="button"
                    onClick={onShowMfaResetApprovals}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-primary-600" />
                    MFA Recovery Requests
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {schoolHeadAccountsPanelProps && <MonitorSchoolHeadAccountsPanel {...schoolHeadAccountsPanelProps} />}
        <MonitorSchoolMessages {...messages} />
        <MonitorSchoolRecordForm {...schoolRecordFormProps} />
        <MonitorSchoolRecordsList {...schoolRecordsListProps} />
        <MonitorArchivedSchools {...archivedSchoolsProps} />
      </section>
    </>
  );
}
