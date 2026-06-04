import { useState, type ComponentProps, type Dispatch, type SetStateAction } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  BellRing,
  CheckCircle2,
  Eye,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { MonitorIndicatorPanel } from "@/components/indicators/MonitorIndicatorPanel";
import { MonitorQuickJumpChips, type MonitorQuickJumpBindings } from "@/pages/monitor/MonitorQuickJumpChips";
import type { SchoolRecord, SchoolStatus } from "@/types";

interface ReviewQueueRow {
  schoolKey: string;
  schoolCode: string;
  schoolName: string;
  region: string;
  schoolStatus: SchoolStatus | null;
  hasComplianceRecord: boolean;
  indicatorStatus: string | null;
  hasAnySubmitted: boolean;
  isComplete: boolean;
  awaitingReviewCount: number;
  missingCount: number;
  lastActivityAt: string | null;
  lastActivityTime: number;
}

interface MonitorReviewsSectionProps {
  isMobileViewport: boolean;
  quickJumpBindings: MonitorQuickJumpBindings;
  sectionFocusClass: (targetId: string) => string;
  needsActionCount: number;
  returnedCount: number;
  submittedCount: number;
  autoAdvanceQueue: boolean;
  setAutoAdvanceQueue: Dispatch<SetStateAction<boolean>>;
  paginatedRequirementRows: ReviewQueueRow[];
  laneFilteredQueueRows: ReviewQueueRow[];
  schoolDrawerKey: string | null;
  remindingSchoolKey: string | null;
  resetQueueFilters: () => void;
  clearAllFilters: () => void;
  handleReviewSchool: (row: ReviewQueueRow) => void;
  handleSendReminder: (row: ReviewQueueRow, notes?: string | null) => Promise<void> | void;
  workflowTone: (status: string | null) => string;
  workflowLabel: (status: string | null) => string;
  queuePriorityTone: (row: ReviewQueueRow) => string;
  queuePriorityLabel: (row: ReviewQueueRow) => string;
  urgencyRowTone: (row: ReviewQueueRow) => string;
  isUrgentRequirement: (row: ReviewQueueRow) => boolean;
  sanitizeAnchorToken: (value: string) => string;
  formatDateTime: (value: string) => string;
  safeRequirementsPage: number;
  totalRequirementPages: number;
  setRequirementsPage: Dispatch<SetStateAction<number>>;
  queueWorkspaceSchoolFilterKeys: Set<string> | null;
  records: SchoolRecord[];
  pushToast: NonNullable<ComponentProps<typeof MonitorIndicatorPanel>["onToast"]>;
  sendReminderForSchool: NonNullable<ComponentProps<typeof MonitorIndicatorPanel>["onSendReminder"]>;
  handleQueueSchoolFocus: NonNullable<ComponentProps<typeof MonitorIndicatorPanel>["onSchoolFocusChange"]>;
  handleQueueReviewCompleted: NonNullable<ComponentProps<typeof MonitorIndicatorPanel>["onReviewCompleted"]>;
}

const REMINDER_NOTE_MAX_LENGTH = 500;

export function MonitorReviewsSection({
  isMobileViewport,
  quickJumpBindings,
  sectionFocusClass,
  needsActionCount,
  returnedCount,
  submittedCount,
  autoAdvanceQueue,
  setAutoAdvanceQueue,
  paginatedRequirementRows,
  laneFilteredQueueRows,
  schoolDrawerKey,
  remindingSchoolKey,
  resetQueueFilters,
  clearAllFilters,
  handleReviewSchool,
  handleSendReminder,
  workflowTone,
  workflowLabel,
  queuePriorityTone,
  queuePriorityLabel,
  urgencyRowTone,
  isUrgentRequirement,
  sanitizeAnchorToken,
  formatDateTime,
  safeRequirementsPage,
  totalRequirementPages,
  setRequirementsPage,
  queueWorkspaceSchoolFilterKeys,
  records,
  pushToast,
  sendReminderForSchool,
  handleQueueSchoolFocus,
  handleQueueReviewCompleted,
}: MonitorReviewsSectionProps) {
  const [reminderTarget, setReminderTarget] = useState<ReviewQueueRow | null>(null);
  const [reminderNote, setReminderNote] = useState("");

  const reminderNoteLength = reminderNote.length;
  const reminderNoteError =
    reminderNoteLength > REMINDER_NOTE_MAX_LENGTH
      ? `Reminder note must be ${REMINDER_NOTE_MAX_LENGTH} characters or less.`
      : "";
  const isReminderSubmitting = reminderTarget !== null && remindingSchoolKey === reminderTarget.schoolKey;

  const openReminderModal = (row: ReviewQueueRow) => {
    setReminderTarget(row);
    setReminderNote("");
  };

  const closeReminderModal = () => {
    if (isReminderSubmitting) return;
    setReminderTarget(null);
    setReminderNote("");
  };

  const submitReminder = async () => {
    if (!reminderTarget || reminderNoteError) return;

    const trimmedNote = reminderNote.trim();
    await Promise.resolve(handleSendReminder(reminderTarget, trimmedNote || null));
    setReminderTarget(null);
    setReminderNote("");
  };

  return (
    <>
      <section id="monitor-action-queue" className={`dashboard-shell mb-5 rounded-sm p-4 ${sectionFocusClass("monitor-action-queue")}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Reviews</h2>
          </div>
          {!isMobileViewport && <MonitorQuickJumpChips {...quickJumpBindings} mobile={false} />}
        </div>
        {isMobileViewport && <MonitorQuickJumpChips {...quickJumpBindings} mobile />}
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Needs Action" value={needsActionCount.toLocaleString()} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
          <StatCard label="Returned" value={returnedCount.toLocaleString()} icon={<ArrowDown className="h-5 w-5" />} tone="warning" />
          <StatCard label="Submitted" value={submittedCount.toLocaleString()} icon={<CheckCircle2 className="h-5 w-5" />} tone="success" />
        </div>
      </section>

      <section id="monitor-requirements-table" className={`surface-panel dashboard-shell mt-5 animate-fade-slide overflow-hidden ${sectionFocusClass("monitor-requirements-table")}`}>
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Queue List</h2>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={autoAdvanceQueue}
                onChange={(event) => setAutoAdvanceQueue(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary-200"
              />
              Auto-open next school after review
            </label>
          </div>
        </div>

        {paginatedRequirementRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-14 text-slate-500">
            <AlertCircle className="h-9 w-9 text-slate-400" />
            <p className="text-sm font-semibold">No Missing, Returned, or For Review schools found.</p>
            <p className="text-xs text-slate-400">Current filters may be hiding results.</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={resetQueueFilters}
                className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
              >
                Reset queue filters
              </button>
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 rounded-sm border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-semibold text-primary-700"
              >
                Clear all
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 px-4 py-4 md:hidden">
              {paginatedRequirementRows.map((row) => (
                <article
                  id={`monitor-queue-row-${sanitizeAnchorToken(row.schoolKey)}`}
                  key={row.schoolKey}
                  className={`rounded-sm border border-slate-200 bg-white p-3 ${
                    schoolDrawerKey === row.schoolKey
                      ? "ring-2 ring-primary-200"
                      : isUrgentRequirement(row)
                        ? urgencyRowTone(row)
                        : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{row.schoolName}</p>
                      <p className="text-xs text-slate-500">{row.schoolCode} - {row.region}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${queuePriorityTone(row)}`}>
                        {queuePriorityLabel(row)}
                      </span>
                      <span className="text-xs font-semibold text-slate-700">Missing: {row.missingCount}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${row.hasComplianceRecord ? "bg-primary-100 text-primary-700" : "bg-slate-100 text-slate-700"}`}>
                      School Data: {row.hasComplianceRecord ? "Submitted" : "Missing"}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${workflowTone(row.indicatorStatus)}`}>
                      Package: {workflowLabel(row.indicatorStatus)}
                    </span>
                    {row.awaitingReviewCount > 0 && <span className="text-slate-600">Ready: {row.awaitingReviewCount}</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleReviewSchool(row)}
                      className="inline-flex items-center justify-center gap-1 rounded-sm border border-primary-200 bg-primary-50 px-2 py-1.5 text-[11px] font-semibold text-primary-700"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => openReminderModal(row)}
                      disabled={remindingSchoolKey === row.schoolKey}
                      className="inline-flex items-center justify-center gap-1 rounded-sm border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <BellRing className="h-3.5 w-3.5" />
                      {remindingSchoolKey === row.schoolKey ? "Sending..." : "Reminder"}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="hidden overflow-x-auto px-5 py-4 md:block">
              <table className="min-w-full">
                <thead className="table-head-sticky">
                  <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <th className="px-2 py-2 text-left">School</th>
                    <th className="px-2 py-2 text-left">Location</th>
                    <th className="px-2 py-2 text-center">School Data</th>
                    <th className="px-2 py-2 text-center">Package</th>
                    <th className="px-2 py-2 text-center">Missing</th>
                    <th className="px-2 py-2 text-left">Last Activity</th>
                    <th className="px-2 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paginatedRequirementRows.map((row) => (
                    <tr
                      id={`monitor-queue-row-${sanitizeAnchorToken(row.schoolKey)}`}
                      key={row.schoolKey}
                      className={
                        schoolDrawerKey === row.schoolKey
                          ? "bg-primary-50/60"
                          : isUrgentRequirement(row)
                            ? urgencyRowTone(row)
                            : "dashboard-table-row"
                      }
                    >
                      <td className="px-2 py-2">
                        <p className="text-sm font-semibold text-slate-900">{row.schoolName}</p>
                        <p className="text-xs text-slate-500">{row.schoolCode}</p>
                      </td>
                      <td className="px-2 py-2 text-sm text-slate-700">{row.region}</td>
                      <td className="px-2 py-2 text-center">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                            row.hasComplianceRecord
                              ? "bg-primary-100 text-primary-700 ring-1 ring-primary-300"
                              : "bg-slate-100 text-slate-600 ring-1 ring-slate-300"
                          }`}
                        >
                          {row.hasComplianceRecord ? "Submitted" : "Missing"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${workflowTone(row.indicatorStatus)}`}>
                            {workflowLabel(row.indicatorStatus)}
                          </span>
                          {row.awaitingReviewCount > 0 && (
                            <span className="text-[11px] font-semibold text-slate-500">Ready: {row.awaitingReviewCount}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center text-sm font-semibold text-slate-900">{row.missingCount}</td>
                      <td className="px-2 py-2 text-sm text-slate-600">{row.lastActivityAt ? formatDateTime(row.lastActivityAt) : "N/A"}</td>
                      <td className="min-w-[11rem] px-2 py-2">
                        <div className="flex flex-nowrap items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleReviewSchool(row)}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-primary-200 bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Review
                          </button>
                          <button
                            type="button"
                            onClick={() => openReminderModal(row)}
                            disabled={remindingSchoolKey === row.schoolKey}
                            className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <BellRing className="h-3.5 w-3.5" />
                            {remindingSchoolKey === row.schoolKey ? "Sending..." : "Reminder"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {laneFilteredQueueRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-600">
              Page <span className="font-semibold text-slate-900">{safeRequirementsPage}</span> of{" "}
              <span className="font-semibold text-slate-900">{totalRequirementPages}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRequirementsPage((current) => Math.max(1, current - 1))}
                disabled={safeRequirementsPage <= 1}
                className="rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setRequirementsPage((current) => Math.min(totalRequirementPages, current + 1))}
                disabled={safeRequirementsPage >= totalRequirementPages}
                className="rounded-sm border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>

      {reminderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="queue-reminder-title"
            className="w-full max-w-md rounded-sm border border-slate-200 bg-white shadow-xl"
          >
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 id="queue-reminder-title" className="text-sm font-bold text-slate-900">
                Send Reminder
              </h3>
              <p className="mt-1 text-xs text-slate-600">{reminderTarget.schoolName}</p>
            </div>
            <div className="space-y-2 px-4 py-4">
              <label htmlFor="queue-reminder-note" className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Message
              </label>
              <textarea
                id="queue-reminder-note"
                value={reminderNote}
                onChange={(event) => setReminderNote(event.target.value)}
                rows={4}
                maxLength={REMINDER_NOTE_MAX_LENGTH + 1}
                className="w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-100"
                placeholder="Optional note for the School Head"
              />
              <div className="flex items-center justify-between gap-3 text-xs">
                <p className={reminderNoteError ? "font-semibold text-rose-700" : "text-slate-500"}>
                  {reminderNoteError || "Appears in the School Head notification and email."}
                </p>
                <span className={reminderNoteLength > REMINDER_NOTE_MAX_LENGTH ? "font-semibold text-rose-700" : "text-slate-500"}>
                  {reminderNoteLength}/{REMINDER_NOTE_MAX_LENGTH}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                onClick={closeReminderModal}
                disabled={isReminderSubmitting}
                className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitReminder()}
                disabled={isReminderSubmitting || Boolean(reminderNoteError)}
                className="inline-flex items-center gap-1 rounded-sm border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <BellRing className="h-3.5 w-3.5" />
                {isReminderSubmitting ? "Sending..." : "Send Reminder"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section
        id="monitor-queue-workspace"
        className={`surface-panel dashboard-shell mt-5 animate-fade-slide overflow-hidden rounded-sm ${sectionFocusClass("monitor-queue-workspace")}`}
      >
        {queueWorkspaceSchoolFilterKeys && queueWorkspaceSchoolFilterKeys.size > 0 ? (
          <MonitorIndicatorPanel
            embedded
            schoolFilterKeys={queueWorkspaceSchoolFilterKeys}
            schoolRecords={records}
            onToast={pushToast}
            onSendReminder={sendReminderForSchool}
            onSchoolFocusChange={handleQueueSchoolFocus}
            onReviewCompleted={handleQueueReviewCompleted}
          />
        ) : (
          <div className="px-5 py-8 text-sm text-slate-500">
            Select a school from the queue to start reviewing submissions.
          </div>
        )}
      </section>
    </>
  );
}
