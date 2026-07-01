import { useEffect, useState, type FormEvent } from "react";
import { Edit3 } from "lucide-react";
import { messageForApiError } from "@/lib/api";
import { monitorSchoolStatusLabel, resolveMonitorSchoolDisplayStatus } from "@/pages/monitor/monitorSchoolStatus";
import {
  BACKEND_SUPPORTED_SCHOOL_LEVEL_OPTIONS,
  coerceBackendSupportedSchoolLevel,
  formatSchoolLevelLabel,
} from "@/pages/monitor/schoolLevelLabels";
import type { SchoolRecord, SchoolRecordPayload, SchoolStatus } from "@/types";

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
  onToast: (message: string, tone?: ToastTone) => void;
}

function formatSchoolStatus(status: SchoolStatus | string | null | undefined): string {
  if (status === "active" || status === "inactive" || status === "pending") return monitorSchoolStatusLabel(status);
  return "Unknown";
}

function formatAccountStatus(status: string | null | undefined): string {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (normalized === "active") return "Active";
  if (normalized === "suspended") return "Suspended";
  if (normalized === "pending_setup") return "Pending Setup";
  if (normalized === "pending_verification") return "Pending Verification";
  if (normalized === "locked") return "Locked";
  if (normalized === "archived") return "Archived";
  if (normalized === "temporary_password_active") return "Temporary Password Active";
  if (normalized === "temporary_password_expired") return "Temporary Password Expired";

  return normalized
    ? normalized.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
    : "No Account";
}

function formatSchoolType(type: string | null | undefined): "public" | "private" {
  return String(type ?? "").toLowerCase() === "private" ? "private" : "public";
}

function buildFormState(record: SchoolRecord | null): SchoolManagementFormState {
  return {
    schoolName: record?.schoolName ?? "",
    level: coerceBackendSupportedSchoolLevel(record?.level),
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
    level: coerceBackendSupportedSchoolLevel(form.level),
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
  onToast,
}: MonitorSchoolManagementPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<SchoolManagementFormState>(() => buildFormState(record));
  const [formError, setFormError] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<"edit" | null>(null);

  useEffect(() => {
    setForm(buildFormState(record));
    setIsEditing(false);
    setFormError("");
    setFormMessage("");
    setPendingAction(null);
  }, [record?.id]);

  const schoolCode = String(record?.schoolCode ?? record?.schoolId ?? "").trim();
  const hasRecord = Boolean(record);
  const isBusy = isSaving || pendingAction !== null;
  const schoolHeadAccount = record?.schoolHeadAccount ?? null;
  const displayStatus = resolveMonitorSchoolDisplayStatus(record);

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
              <dd className="text-sm text-slate-700">{formatSchoolLevelLabel(record.level)}</dd>
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
                  {/* Junior/Senior High options require backend validation support before they can be submitted. */}
                  {BACKEND_SUPPORTED_SCHOOL_LEVEL_OPTIONS.map((levelOption) => (
                    <option key={levelOption} value={levelOption}>
                      {levelOption}
                    </option>
                  ))}
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
              <dd className="text-sm text-slate-700">{formatAccountStatus(schoolHeadAccount.accountStatus)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recommended Action</dt>
              <dd className="text-sm text-slate-700">{schoolHeadAccount.recommendedAction ?? "None"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No School Head account is linked to this school.</p>
        )}
      </section>
    </div>
  );
}
