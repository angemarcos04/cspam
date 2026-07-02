import {
  Archive,
  Building2,
  ChevronDown,
  Download,
  FileUp,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ChangeEvent, MutableRefObject, Ref } from "react";
import { MonitorArchivedSchools, type MonitorArchivedSchoolsProps } from "@/pages/monitor/MonitorArchivedSchools";
import { MonitorSchoolHeadAccountsPanel, type MonitorSchoolHeadAccountsPanelProps } from "@/pages/monitor/MonitorSchoolHeadAccountsPanel";
import { MonitorSchoolMessages, type MonitorSchoolMessagesProps } from "@/pages/monitor/MonitorSchoolMessages";
import { MonitorSchoolRecordsList, type MonitorSchoolRecordsListProps } from "@/pages/monitor/MonitorSchoolRecordsList";
import { MonitorQuickJumpChips, type MonitorQuickJumpBindings } from "@/pages/monitor/MonitorQuickJumpChips";
import type { SchoolCategoryCounts } from "@/pages/monitor/useMonitorRequirementData";
import type { MonitorRadarTotals } from "@/pages/monitor/useMonitorRadarTotals";
import type { SchoolLevelFilter, SchoolSectorFilter } from "@/pages/monitor/monitorFilters";
import { formatSchoolCoverageLabel } from "@/pages/monitor/schoolLevelLabels";

interface MonitorSchoolsSectionProps {
  sectionFocusClass: (targetId: string) => string;
  isMobileViewport: boolean;
  quickJumpBindings: MonitorQuickJumpBindings;
  totalSchoolsInScope: number;
  monitorRadarTotals: MonitorRadarTotals;
  schoolCategoryCounts: SchoolCategoryCounts;
  schoolSectorFilter: SchoolSectorFilter;
  schoolLevelFilter: SchoolLevelFilter;
  search: string;
  onSearchChange: (value: string) => void;
  globalSearchInputRef: Ref<HTMLInputElement>;
  onClearSchoolCategoryFilter: () => void;
  onSelectSchoolCategoryFilter: (sector: Exclude<SchoolSectorFilter, "all">, level?: SchoolLevelFilter) => void;
  messages: MonitorSchoolMessagesProps;
  schoolRecordsListProps: MonitorSchoolRecordsListProps;
  bulkImportInputRef: MutableRefObject<HTMLInputElement | null>;
  schoolActionsMenuRef: MutableRefObject<HTMLDivElement | null>;
  showSchoolHeadAccountsPanel: boolean;
  isSchoolActionsMenuOpen: boolean;
  isBulkImporting: boolean;
  showArchivedRecords: boolean;
  schoolHeadAccountsPanelProps: MonitorSchoolHeadAccountsPanelProps | null;
  archivedSchoolsProps: MonitorArchivedSchoolsProps;
  handleBulkImportFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  toggleSchoolHeadAccountsPanel: () => void;
  toggleActionsMenu: () => void;
  closeActionsMenu: () => void;
  downloadCsvFormat: () => void;
  openBulkImportPicker: () => void;
  toggleArchivedRecords: () => void | Promise<void>;
  onOpenMfaRecoveryRequests: () => void;
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
  search,
  onSearchChange,
  globalSearchInputRef,
  onClearSchoolCategoryFilter,
  onSelectSchoolCategoryFilter,
  messages,
  schoolRecordsListProps,
  bulkImportInputRef,
  schoolActionsMenuRef,
  showSchoolHeadAccountsPanel,
  isSchoolActionsMenuOpen,
  isBulkImporting,
  showArchivedRecords,
  schoolHeadAccountsPanelProps,
  archivedSchoolsProps,
  handleBulkImportFileChange,
  toggleSchoolHeadAccountsPanel,
  toggleActionsMenu,
  closeActionsMenu,
  downloadCsvFormat,
  openBulkImportPicker,
  toggleArchivedRecords,
  onOpenMfaRecoveryRequests,
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
  const managementButtonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-sm border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100";
  const menuItemClass =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50";

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
              aria-label="Filter public schools by coverage"
              value={currentPublicLevel}
              onChange={(event) => onSelectSchoolCategoryFilter("public", event.target.value as SchoolLevelFilter)}
              className={selectClass}
            >
              <option value="all">All public coverage</option>
              <option value="elementary">{formatSchoolCoverageLabel("elementary")} ({schoolCategoryCounts.publicElementary.toLocaleString()})</option>
              <option value="junior_high">{formatSchoolCoverageLabel("junior_high")} ({schoolCategoryCounts.publicJuniorHigh.toLocaleString()})</option>
              <option value="senior_high">{formatSchoolCoverageLabel("senior_high")} ({schoolCategoryCounts.publicSeniorHigh.toLocaleString()})</option>
              <option value="legacy_high_school">Legacy High School ({schoolCategoryCounts.publicLegacyHighSchool.toLocaleString()})</option>
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
              aria-label="Filter private schools by coverage"
              value={currentPrivateLevel}
              onChange={(event) => onSelectSchoolCategoryFilter("private", event.target.value as SchoolLevelFilter)}
              className={selectClass}
            >
              <option value="all">All private coverage</option>
              <option value="elementary">{formatSchoolCoverageLabel("elementary")} ({schoolCategoryCounts.privateElementary.toLocaleString()})</option>
              <option value="junior_high">{formatSchoolCoverageLabel("junior_high")} ({schoolCategoryCounts.privateJuniorHigh.toLocaleString()})</option>
              <option value="senior_high">{formatSchoolCoverageLabel("senior_high")} ({schoolCategoryCounts.privateSeniorHigh.toLocaleString()})</option>
              <option value="legacy_high_school">Legacy High School ({schoolCategoryCounts.privateLegacyHighSchool.toLocaleString()})</option>
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
        className={`surface-panel dashboard-shell mt-5 overflow-hidden ${sectionFocusClass("monitor-school-records")}`}
      >
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Schools</h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:justify-end">
              <button
                type="button"
                onClick={toggleSchoolHeadAccountsPanel}
                aria-pressed={showSchoolHeadAccountsPanel}
                className={`${managementButtonClass} ${
                  showSchoolHeadAccountsPanel ? "border-primary-200 bg-primary-50 text-primary-700" : ""
                }`}
              >
                <Users className="h-4 w-4" />
                Accounts
              </button>
              <div ref={schoolActionsMenuRef} className="relative">
                <button
                  type="button"
                  onClick={toggleActionsMenu}
                  aria-haspopup="menu"
                  aria-expanded={isSchoolActionsMenuOpen}
                  className={managementButtonClass}
                >
                  More
                  <ChevronDown className="h-4 w-4" />
                </button>
                {isSchoolActionsMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Schools management menu"
                    className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-sm border border-slate-200 bg-white py-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={downloadCsvFormat}
                      className={menuItemClass}
                    >
                      <Download className="h-3.5 w-3.5 text-slate-500" />
                      Download CSV Format
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={openBulkImportPicker}
                      disabled={isBulkImporting}
                      className={`${menuItemClass} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <FileUp className="h-3.5 w-3.5 text-slate-500" />
                      Import CSV
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void toggleArchivedRecords()}
                      className={menuItemClass}
                    >
                      <Archive className="h-3.5 w-3.5 text-slate-500" />
                      {showArchivedRecords ? "Hide Archived Schools" : "Show Archived Schools"}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        closeActionsMenu();
                        onOpenMfaRecoveryRequests();
                      }}
                      className={menuItemClass}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                      MFA Recovery Requests
                    </button>
                  </div>
                )}
              </div>
              <input
                ref={bulkImportInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="Import schools CSV"
                className="sr-only"
                onChange={(event) => void handleBulkImportFileChange(event)}
              />
              {!isMobileViewport && <MonitorQuickJumpChips {...quickJumpBindings} mobile={false} />}
            </div>
          </div>
          {isMobileViewport && <MonitorQuickJumpChips {...quickJumpBindings} mobile />}
        </div>

        <div className="border-b border-slate-200 bg-white px-5 py-3">
          <label className="relative block w-full lg:max-w-lg">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={globalSearchInputRef}
              type="text"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search school code, school name, or school head"
              className="w-full rounded-sm border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-100"
            />
          </label>
        </div>

        <MonitorSchoolMessages {...messages} />
        {schoolHeadAccountsPanelProps ? (
          <MonitorSchoolHeadAccountsPanel {...schoolHeadAccountsPanelProps} />
        ) : null}
        <MonitorArchivedSchools {...archivedSchoolsProps} />
        <MonitorSchoolRecordsList {...schoolRecordsListProps} />
      </section>
    </>
  );
}
