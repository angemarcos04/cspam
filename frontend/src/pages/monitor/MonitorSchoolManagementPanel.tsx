import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Archive, Edit3 } from "lucide-react";
import { messageForApiError } from "@/lib/api";
import { monitorSchoolStatusLabel, resolveMonitorSchoolDisplayStatus } from "@/pages/monitor/monitorSchoolStatus";
import type { SchoolRecord, SchoolRecordDeletePreview, SchoolRecordPayload, SchoolStatus } from "@/types";

type ToastTone = "success" | "info" | "warning";

interface SchoolManagementFormState {
  schoolName: string;
  level: string;
  type: "public" | "private";
  address: string;
  district: string;
  region: string;
}

interface MonitorSchoolManagementPanelProps {
  record: SchoolRecord | null;
  isSaving: boolean;
  updateRecord: (id: string, updates: SchoolRecordPayload) => Promise<void>;
  previewDeleteRecord: (id: string) => Promise<SchoolRecordDeletePreview>;
  deleteRecord: (id: string) => Promise<void>;
  onArchived: () => void;
  onToast: (message: string, tone?: ToastTone) => void;
}

function formatSchoolStatus(status: SchoolStatus | string | null | undefined): string {
  if (status === "active" || status === "inactive" || status === "pending") return monitorSchoolStatusLabel(status);
  return "Unknown";
}

function formatSchoolType(type: string | null | undefined): "public" | "private" {
  return String(type ?? "").toLowerCase() === "private" ? "private" : "public";
}

function buildFormState(record: SchoolRecord | null): SchoolManagementFormState {
  return {
    schoolName: record?.schoolName ?? "",
    level: record?.level ?? "Elementary",
    type: formatSchoolType(record?.type),
    address: record?.address ?? "",
    district: record?.district ?? "",
    region: record?.region ?? "",
  };
}

function buildBasePayload(record: SchoolRecord, form: SchoolManagementFormState): SchoolRecordPayload {
  return {
    schoolId: record.schoolCode ?? record.schoolId ?? "",
    schoolName: form.schoolName.trim(),
    level: form.level,
    type: form.type,
    address: form.address.trim(),
    district: form.district.trim() || null,
    region: form.region.trim() || "",
    status: record.status,
  };
}

export function MonitorSchoolManagementPanel({
  record,
  isSaving,
  updateRecord,
  previewDeleteRecord,
  deleteRecord,
  onArchived,
  onToast,
}: MonitorSchoolManagementPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<SchoolManagementFormState>(() => buildFormState(record));
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [pendingStatus, setPendingStatus] = useState<SchoolStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [archivePreview, setArchivePreview] = useState<SchoolRecordDeletePreview | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveMessage, setArchiveMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<"edit" | "status" | "preview-archive" | "archive" | null>(null);

  useEffect(() => {
    setForm(buildFormState(record));
    setIsEditing(false);
    setFormError("");
    setFormMessage("");
    setPendingStatus(null);
    setStatusError("");
    setStatusMessage("");
    setArchivePreview(null);
    setArchiveError("");
    setArchiveMessage("");
    setPendingAction(null);
  }, [record?.id]);

  const schoolCode = String(record?.schoolCode ?? record?.schoolId ?? "").trim();
  const hasRecord = Boolean(record);
  const isBusy = isSaving || pendingAction !== null;
  const schoolHeadAccount = record?.schoolHeadAccount ?? null;
  const displayStatus = resolveMonitorSchoolDisplayStatus(record);

  const statusActions = useMemo<Array<{ status: SchoolStatus; label: string; description: string }>>(() => {
    if (!record) return [];
    if (record.status === "active") {
      return [{
        status: "inactive",
        label: "Mark as Suspended",
        description: "This removes the school from normal active monitoring views without deleting its records.",
      }];
    }

    if (record.status === "inactive") {
      return [{
        status: "active",
        label: "Reactivate School",
        description: "This returns the school to active monitoring.",
      }];
    }

    return [
      {
        status: "active",
        label: "Mark as Active",
        description: "This returns the school to active monitoring.",
      },
      {
        status: "inactive",
        label: "Mark as Suspended",
        description: "This removes the school from normal active monitoring views without deleting its records.",
      },
    ];
  }, [record]);

  const updateFormField = (field: keyof SchoolManagementFormState, value: string) => {
    setForm((current) => ({
      ...current,
      [field]: field === "type" ? formatSchoolType(value) : value,
    }));
    setFormError("");
    setFormMessage("");
  };

  const submitEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!record || isBusy) return;

    if (!form.schoolName.trim()) {
      setFormError("School name is required.");
      return;
    }

    if (!form.address.trim()) {
      setFormError("Address is required.");
      return;
    }

    setPendingAction("edit");
    setFormError("");
    setFormMessage("");
    try {
      await updateRecord(record.id, buildBasePayload(record, form));
      setFormMessage("School details updated.");
      setIsEditing(false);
      onToast("School details updated.", "success");
    } catch (err) {
      setFormError(messageForApiError(err, "Unable to update school details."));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmStatusChange = async () => {
    if (!record || !pendingStatus || isBusy) return;

    setPendingAction("status");
    setStatusError("");
    setStatusMessage("");
    try {
      await updateRecord(record.id, {
        ...buildBasePayload(record, buildFormState(record)),
        status: pendingStatus,
      });
      setStatusMessage(`School status updated to ${formatSchoolStatus(pendingStatus)}.`);
      onToast(`School status updated to ${formatSchoolStatus(pendingStatus)}.`, "success");
      setPendingStatus(null);
    } catch (err) {
      setStatusError(messageForApiError(err, "Unable to update school status."));
    } finally {
      setPendingAction(null);
    }
  };

  const loadArchivePreview = async () => {
    if (!record || isBusy) return;

    setPendingAction("preview-archive");
    setArchiveError("");
    setArchiveMessage("");
    try {
      const preview = await previewDeleteRecord(record.id);
      setArchivePreview(preview);
    } catch (err) {
      setArchiveError(messageForApiError(err, "Unable to load archive preview."));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmArchive = async () => {
    if (!record || isBusy) return;

    setPendingAction("archive");
    setArchiveError("");
    setArchiveMessage("");
    try {
      await deleteRecord(record.id);
      setArchiveMessage("School record archived.");
      onToast("School record archived.", "success");
      onArchived();
    } catch (err) {
      setArchiveError(messageForApiError(err, "Unable to archive school record."));
    } finally {
      setPendingAction(null);
    }
  };

  if (!hasRecord || !record) {
    return (
      <section className="rounded-sm border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">Management</h3>
        <p className="mt-2 text-sm text-slate-600">Open a school record to manage school details.</p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-sm border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">School Information</h3>
            <p className="mt-1 text-xs text-slate-600">Update school profile fields for this selected school.</p>
          </div>
          {!isEditing && (
            <button
              type="button"
              onClick={() => {
                setForm(buildFormState(record));
                setFormError("");
                setFormMessage("");
                setIsEditing(true);
              }}
              disabled={isBusy}
              className="inline-flex items-center justify-center gap-1 rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit School Details
            </button>
          )}
        </div>

        {!isEditing ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">School Code</dt>
              <dd className="text-sm font-semibold text-slate-900">{schoolCode || "N/A"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">School Name</dt>
              <dd className="text-sm font-semibold text-slate-900">{record.schoolName}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Level</dt>
              <dd className="text-sm text-slate-700">{record.level ?? "N/A"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type</dt>
              <dd className="text-sm text-slate-700">{formatSchoolType(record.type) === "private" ? "Private" : "Public"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">District</dt>
              <dd className="text-sm text-slate-700">{record.district || "N/A"}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Region</dt>
              <dd className="text-sm text-slate-700">{record.region || "N/A"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Address</dt>
              <dd className="text-sm text-slate-700">{record.address || "N/A"}</dd>
            </div>
          </dl>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={submitEdit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                School Code
                <input
                  value={schoolCode}
                  readOnly
                  aria-readonly="true"
                  className="mt-1 w-full rounded-sm border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                School Name
                <input
                  value={form.schoolName}
                  onChange={(event) => updateFormField("schoolName", event.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Level
                <select
                  value={form.level}
                  onChange={(event) => updateFormField("level", event.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900"
                >
                  <option value="Elementary">Elementary</option>
                  <option value="High School">High School</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Type
                <select
                  value={form.type}
                  onChange={(event) => updateFormField("type", event.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900"
                >
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                District
                <input
                  value={form.district}
                  onChange={(event) => updateFormField("district", event.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Region
                <input
                  value={form.region}
                  onChange={(event) => updateFormField("region", event.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600 sm:col-span-2">
                Address
                <input
                  value={form.address}
                  onChange={(event) => updateFormField("address", event.target.value)}
                  className="mt-1 w-full rounded-sm border border-slate-300 px-3 py-2 text-sm text-slate-900"
                />
              </label>
            </div>
            {formError && <p className="text-xs font-semibold text-rose-700">{formError}</p>}
            {formMessage && <p className="text-xs font-semibold text-emerald-700">{formMessage}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setForm(buildFormState(record));
                  setFormError("");
                }}
                disabled={isBusy}
                className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBusy}
                className="rounded-sm border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "edit" ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rounded-sm border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">School Status</h3>
        <p className="mt-1 text-xs text-slate-600">
          Current status: <span className="font-semibold text-slate-900">{formatSchoolStatus(displayStatus)}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {statusActions.map((action) => (
            <button
              key={action.status}
              type="button"
              onClick={() => {
                setPendingStatus(action.status);
                setStatusError("");
                setStatusMessage("");
              }}
              disabled={isBusy}
              title={action.description}
              className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {action.label}
            </button>
          ))}
        </div>
        {pendingStatus && (
          <div role="alert" className="mt-3 rounded-sm border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">
              Confirm status change to {formatSchoolStatus(pendingStatus)}?
            </p>
            <p className="mt-1 text-xs text-amber-700">
              This updates the selected school record using the existing school status values.
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingStatus(null)}
                disabled={isBusy}
                className="rounded-sm border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmStatusChange()}
                disabled={isBusy}
                className="rounded-sm border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "status" ? "Updating..." : "Confirm status change"}
              </button>
            </div>
          </div>
        )}
        {statusError && <p className="mt-2 text-xs font-semibold text-rose-700">{statusError}</p>}
        {statusMessage && <p className="mt-2 text-xs font-semibold text-emerald-700">{statusMessage}</p>}
      </section>

      <section className="rounded-sm border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900">School Head Account Access</h3>
        {schoolHeadAccount ? (
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name</dt>
              <dd className="text-sm font-semibold text-slate-900">{schoolHeadAccount.name}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="text-sm text-slate-700">{schoolHeadAccount.email}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Account Status</dt>
              <dd className="text-sm text-slate-700">{String(schoolHeadAccount.accountStatus).replace(/[_-]+/g, " ")}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recommended Action</dt>
              <dd className="text-sm text-slate-700">{schoolHeadAccount.recommendedAction ?? "None"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No School Head account is linked to this school.</p>
        )}
        <p className="mt-3 rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Manage School Head account actions from Schools -&gt; Accounts so confirmation-code protections stay intact.
        </p>
      </section>

      <section className="rounded-sm border border-rose-200 bg-rose-50 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
          <div>
            <h3 className="text-sm font-bold text-rose-900">Archive School Record</h3>
            <p className="mt-1 text-xs text-rose-800">
              Archive removes this school from the active list while preserving history unless it is permanently
              deleted later from archived-record management.
            </p>
          </div>
        </div>

        {!archivePreview ? (
          <button
            type="button"
            onClick={() => void loadArchivePreview()}
            disabled={isBusy}
            className="mt-3 inline-flex items-center gap-1 rounded-sm border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Archive className="h-3.5 w-3.5" />
            {pendingAction === "preview-archive" ? "Loading preview..." : "Archive School Record"}
          </button>
        ) : (
          <div role="dialog" aria-modal="false" aria-labelledby="archive-school-record-title" className="mt-3 rounded-sm border border-rose-300 bg-white p-3">
            <h4 id="archive-school-record-title" className="text-sm font-bold text-rose-900">
              Archive this school record?
            </h4>
            <p className="mt-1 text-xs text-rose-800">
              This will remove <span className="font-semibold">{archivePreview.schoolName}</span>{" "}
              ({archivePreview.schoolId}) from the active school list. Existing records, submissions, audit history,
              and linked account history remain preserved unless permanently deleted later.
            </p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Students</dt>
                <dd className="text-sm font-semibold text-rose-900">{archivePreview.dependencies.students}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Indicator Submissions</dt>
                <dd className="text-sm font-semibold text-rose-900">{archivePreview.dependencies.indicatorSubmissions}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Histories</dt>
                <dd className="text-sm font-semibold text-rose-900">{archivePreview.dependencies.histories}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">Linked Users</dt>
                <dd className="text-sm font-semibold text-rose-900">{archivePreview.dependencies.linkedUsers}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setArchivePreview(null)}
                disabled={isBusy}
                className="rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmArchive()}
                disabled={isBusy}
                className="rounded-sm border border-rose-300 bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "archive" ? "Archiving..." : "Archive School Record"}
              </button>
            </div>
          </div>
        )}
        {archiveError && <p className="mt-2 text-xs font-semibold text-rose-800">{archiveError}</p>}
        {archiveMessage && <p className="mt-2 text-xs font-semibold text-emerald-700">{archiveMessage}</p>}
      </section>
    </div>
  );
}
