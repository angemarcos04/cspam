import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, Download, FileUp, Pencil, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/context/Auth";
import {
  downloadFmQadVersion,
  fetchFmQadVersions,
  fetchMonitorFmQadForms,
  mutateFmQadVersion,
  updateFmQadVersionMetadata,
  uploadFmQadVersion,
} from "@/lib/fmQadTemplatesApi";
import { isAbortError, isApiError, messageForApiError } from "@/lib/api";
import type { AcademicYearOption } from "@/types";
import type {
  FmQadTemplateForm,
  FmQadTemplateVersion,
  MonitorFmQadCatalogMeta,
} from "@/types/fmQadTemplates";

interface FmQadUploadDraft {
  revisionLabel: string;
  academicYearId: string;
  changeNotes: string;
  internalNote: string;
  file: File | null;
}

interface FmQadEditDraft {
  revisionLabel: string;
  academicYearId: string;
  changeNotes: string;
  internalNote: string;
}

const emptyUploadDraft = (): FmQadUploadDraft => ({
  revisionLabel: "",
  academicYearId: "",
  changeNotes: "",
  internalNote: "",
  file: null,
});

export function selectMonitorDisplayVersion(
  form: FmQadTemplateForm,
  academicYears: AcademicYearOption[],
): FmQadTemplateVersion | null {
  const activeVersions = (form.activeVersions ?? []).filter(
    (version) => version.status === "active",
  );
  const currentYear = academicYears.find((year) => year.isCurrent) ?? null;
  const exactCurrentYear = currentYear
    ? activeVersions.find((version) => version.academicYearId === currentYear.id)
    : null;

  return exactCurrentYear
    ?? activeVersions.find((version) => version.academicYearId === null)
    ?? activeVersions[0]
    ?? null;
}

export function MonitorFmQadTemplateManager({ onClose }: { onClose: () => void }) {
  const { apiToken } = useAuth();
  const [forms, setForms] = useState<FmQadTemplateForm[]>([]);
  const [years, setYears] = useState<AcademicYearOption[]>([]);
  const [catalogMeta, setCatalogMeta] = useState<MonitorFmQadCatalogMeta | null>(null);
  const [selectedForm, setSelectedForm] = useState<FmQadTemplateForm | null>(null);
  const [versions, setVersions] = useState<FmQadTemplateVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isVersionsLoading, setIsVersionsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadDraft, setUploadDraft] = useState<FmQadUploadDraft>(emptyUploadDraft);
  const [editingVersion, setEditingVersion] = useState<FmQadTemplateVersion | null>(null);
  const [editDraft, setEditDraft] = useState<FmQadEditDraft | null>(null);
  const formRequestSequenceRef = useRef(0);
  const versionRequestSequenceRef = useRef(0);
  const formAbortControllerRef = useRef<AbortController | null>(null);
  const versionAbortControllerRef = useRef<AbortController | null>(null);
  const selectedFormIdRef = useRef<string | null>(null);

  const loadVersions = useCallback(async (formId: string) => {
    const sequence = ++versionRequestSequenceRef.current;
    versionAbortControllerRef.current?.abort();
    const controller = new AbortController();
    versionAbortControllerRef.current = controller;
    setIsVersionsLoading(true);
    try {
      const result = await fetchFmQadVersions(apiToken, formId, controller.signal);
      if (sequence === versionRequestSequenceRef.current && selectedFormIdRef.current === formId) {
        setVersions(result);
      }
    } finally {
      if (sequence === versionRequestSequenceRef.current && selectedFormIdRef.current === formId) {
        setIsVersionsLoading(false);
      }
    }
  }, [apiToken]);

  const refresh = useCallback(async () => {
    const sequence = ++formRequestSequenceRef.current;
    formAbortControllerRef.current?.abort();
    const controller = new AbortController();
    formAbortControllerRef.current = controller;
    setIsLoading(true);
    setError("");
    try {
      const result = await fetchMonitorFmQadForms(apiToken, controller.signal);
      if (sequence !== formRequestSequenceRef.current) return;
      setForms(result.data);
      setYears(result.academicYears);
      setCatalogMeta(result.meta ?? null);
      const selectedId = selectedFormIdRef.current;
      if (selectedId) {
        const updated = result.data.find((form) => form.id === selectedId) ?? null;
        setSelectedForm(updated);
        if (updated) await loadVersions(updated.id);
      }
    } catch (cause) {
      if (!isAbortError(cause) && sequence === formRequestSequenceRef.current) {
        setError(
          isApiError(cause) && cause.status === 404
            ? "The FM-QAD catalog endpoint is unavailable. The backend deployment may be outdated."
            : messageForApiError(cause, "The FM-QAD catalog could not be loaded."),
        );
      }
    } finally {
      if (sequence === formRequestSequenceRef.current) setIsLoading(false);
    }
  }, [apiToken, loadVersions]);

  useEffect(() => {
    void refresh();
    return () => {
      formRequestSequenceRef.current++;
      versionRequestSequenceRef.current++;
      formAbortControllerRef.current?.abort();
      versionAbortControllerRef.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<{ entity?: string }>).detail?.entity === "fm_qad_template") void refresh();
    };
    window.addEventListener("cspams:update", listener);
    return () => window.removeEventListener("cspams:update", listener);
  }, [refresh]);

  const openVersions = async (form: FmQadTemplateForm) => {
    selectedFormIdRef.current = form.id;
    setSelectedForm(form);
    setVersions([]);
    setError("");
    try {
      await loadVersions(form.id);
    } catch (cause) {
      if (isAbortError(cause) || selectedFormIdRef.current !== form.id) {
        return;
      }
      setError(cause instanceof Error ? cause.message : "Unable to load version history.");
    }
  };

  const closeUpload = () => {
    setShowUpload(false);
    setUploadDraft(emptyUploadDraft());
  };

  const openUpload = () => {
    setEditingVersion(null);
    setEditDraft(null);
    setUploadDraft(emptyUploadDraft());
    setShowUpload(true);
  };

  const openEdit = (version: FmQadTemplateVersion) => {
    closeUpload();
    setEditingVersion(version);
    setEditDraft({
      revisionLabel: version.revisionLabel,
      academicYearId: version.academicYearId ?? "",
      changeNotes: version.changeNotes,
      internalNote: version.internalNote ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingVersion(null);
    setEditDraft(null);
  };

  const closeManager = () => {
    formRequestSequenceRef.current++;
    versionRequestSequenceRef.current++;
    formAbortControllerRef.current?.abort();
    versionAbortControllerRef.current?.abort();
    onClose();
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingVersion || !editDraft) return;
    setIsSaving(true);
    setError("");
    try {
      await updateFmQadVersionMetadata(apiToken, editingVersion.id, {
        revisionLabel: editDraft.revisionLabel,
        academicYearId: editDraft.academicYearId || null,
        changeNotes: editDraft.changeNotes,
        internalNote: editDraft.internalNote || null,
      });
      cancelEdit();
      await loadVersions(editingVersion.formId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update template details.");
    } finally {
      setIsSaving(false);
    }
  };

  const submitUpload = async (event: FormEvent, activate: boolean) => {
    event.preventDefault();
    const file = uploadDraft.file;
    if (
      !selectedForm
      || !file
      || !uploadDraft.revisionLabel.trim()
      || !uploadDraft.changeNotes.trim()
    ) {
      setError("Form, revision label, change notes, and a DOCX file are required.");
      return;
    }
    if (activate) {
      const confirmation = uploadDraft.academicYearId
        ? `Activate ${selectedForm.code} ${uploadDraft.revisionLabel.trim()}?\n\nThis will make it the current template for the selected Academic Year. Existing uploaded, submitted, returned, and verified files will not be changed.`
        : `Activate ${selectedForm.code} ${uploadDraft.revisionLabel.trim()} as the baseline template?\n\nIt will be used only when no Academic-Year-specific active revision exists. Existing uploaded, submitted, returned, and verified files will not be changed.`;
      if (!window.confirm(confirmation)) return;
    }
    setIsSaving(true);
    setError("");
    try {
      await uploadFmQadVersion(apiToken, selectedForm.id, {
        ...uploadDraft,
        academicYearId: uploadDraft.academicYearId || null,
        file,
        activate,
      });
      closeUpload();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to upload template revision.");
    } finally {
      setIsSaving(false);
    }
  };

  const performAction = async (version: FmQadTemplateVersion, action: "activate" | "archive") => {
    const message = action === "activate"
      ? `Activate ${version.code} ${version.revisionLabel}?\n\nThe current revision for this Academic Year will be archived. Existing submission files will not be changed.`
      : `Archive ${version.code} ${version.revisionLabel}?\n\nThe file and historical submission references will be preserved.`;
    if (!window.confirm(message)) return;
    setIsSaving(true);
    try {
      await mutateFmQadVersion(apiToken, version.id, action);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${action} revision.`);
    } finally {
      setIsSaving(false);
    }
  };

  const catalogIsUninitialized = forms.length === 0 && catalogMeta?.initializationRequired === true;
  const catalogIsIncomplete = forms.length > 0 && catalogMeta?.initializationRequired === true;
  const enabledCatalogIsIncomplete = forms.length > 0
    && catalogMeta !== null
    && catalogMeta.enabledCatalogCount < catalogMeta.configuredFormCount;

  return (
    <section aria-labelledby="fm-qad-manager-title" className="border-b border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="fm-qad-manager-title" className="text-base font-bold text-slate-900">Template Management</h2>
          <p className="mt-1 text-xs text-slate-500">Manage official DOCX revisions without changing permanent FM-QAD submission scopes.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-1 rounded-sm border px-3 py-2 text-xs font-semibold"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
          <button type="button" onClick={closeManager} aria-label="Close Template Management" className="rounded-sm border p-2"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-3 rounded-sm bg-rose-50 px-3 py-3 text-sm text-rose-700">
          <p>{error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-2 rounded-sm border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold">Retry catalog request</button>
        </div>
      )}
      {!error && catalogMeta && catalogIsIncomplete && (
        <div role="status" className="mt-3 rounded-sm bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <p className="font-semibold">The FM-QAD catalog is incomplete.</p>
          <p>{catalogMeta.catalogCount} of {catalogMeta.configuredFormCount} permanent forms are configured.</p>
          {catalogMeta.missingScopeIds.length > 0 && <p className="mt-1 text-xs">Missing: {catalogMeta.missingScopeIds.join(", ")}</p>}
        </div>
      )}
      {!error && catalogMeta && !catalogIsIncomplete && enabledCatalogIsIncomplete && (
        <div role="status" className="mt-3 rounded-sm bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <p className="font-semibold">Some permanent FM-QAD forms are disabled.</p>
          <p>{catalogMeta.enabledCatalogCount} of {catalogMeta.configuredFormCount} permanent forms are enabled.</p>
        </div>
      )}
      {!error && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-slate-500">
                <th className="min-w-28 whitespace-nowrap p-2">Code</th>
                <th className="min-w-72 p-2">Form name</th>
                <th className="min-w-32 p-2">Active revision</th>
                <th className="min-w-28 p-2">Academic Year</th>
                <th className="min-w-36 p-2">File</th>
                <th className="min-w-32 p-2">Status</th>
                <th className="min-w-24 p-2">Activated</th>
                <th className="whitespace-nowrap p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="p-6 text-center text-slate-600">Loading FM-QAD forms</td></tr>}
              {!isLoading && catalogMeta && catalogIsUninitialized && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-700">
                  <p className="font-semibold">No FM-QAD forms are configured.</p>
                  <p className="mt-1">The permanent FM-QAD form catalog has not been initialized.</p>
                  <p className="mt-1">Contact the system administrator, then refresh this page.</p>
                  <p className="mt-2 text-xs">Expected permanent forms: {catalogMeta.configuredFormCount}. Missing: {catalogMeta.missingScopeIds.length}.</p>
                  <details className="mt-2 text-xs"><summary className="cursor-pointer">Technical note</summary><p className="mt-1">Required operation: initialize the permanent FM-QAD form catalog.</p></details>
                  <button type="button" onClick={() => void refresh()} className="mt-3 rounded-sm border px-3 py-1.5 text-xs font-semibold">Retry catalog request</button>
                </td></tr>
              )}
              {!isLoading && forms.length === 0 && !catalogIsUninitialized && (
                <tr><td colSpan={8} className="p-6 text-center text-slate-700">
                  <p className="font-semibold">No FM-QAD forms are available.</p>
                  <p className="mt-1">Refresh the page or contact the system administrator.</p>
                  <button type="button" onClick={() => void refresh()} className="mt-3 rounded-sm border px-3 py-1.5 text-xs font-semibold">Retry catalog request</button>
                </td></tr>
              )}
              {!isLoading && forms.map((form) => {
                const current = selectMonitorDisplayVersion(form, years);
                return <tr key={form.id} className="border-b align-top"><td className="whitespace-nowrap p-2 font-bold">{form.code}</td><td className="p-2">{form.name}</td><td className="p-2">{current?.revisionLabel ?? "Not configured"}</td><td className="p-2">{current?.academicYearLabel ?? (current ? "Baseline" : "—")}</td><td className="p-2"><span className="block max-w-48 break-words">{current?.originalFilename ?? "—"}</span>{current && <span className="text-xs text-slate-500">{(current.sizeBytes / 1024).toFixed(1)} KB</span>}</td><td className="p-2">{current ? "Active" : "No active revision"}</td><td className="p-2">{current?.activatedAt ? new Date(current.activatedAt).toLocaleDateString() : "—"}</td><td className="p-2"><div className="flex min-w-max flex-col items-start gap-1"><button type="button" onClick={() => void openVersions(form)} className="font-semibold text-primary-700 underline">Manage</button>{current && <button type="button" onClick={() => void downloadFmQadVersion(apiToken, current)} className="font-semibold text-slate-700 underline">Download active</button>}</div></td></tr>;
              })}
            </tbody>
          </table>
        </div>
      )}
      {selectedForm && (
        <div className="mt-5 rounded-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold">{selectedForm.code} · {selectedForm.name}</h3><p className="text-xs text-slate-500">Newest revisions first</p></div>
            <button type="button" onClick={showUpload ? closeUpload : openUpload} className="inline-flex items-center gap-1 rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white"><FileUp className="h-3.5 w-3.5" /> Upload New Version</button>
          </div>
          {showUpload && (
            <form className="mt-4 grid gap-3 rounded-sm bg-slate-50 p-4 md:grid-cols-2" onSubmit={(event) => void submitUpload(event, false)}>
              <label className="text-xs font-semibold">Revision Label<input aria-label="Revision Label" value={uploadDraft.revisionLabel} onChange={(e) => setUploadDraft((draft) => ({ ...draft, revisionLabel: e.target.value }))} maxLength={50} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Effective Academic Year<select aria-label="Effective Academic Year" value={uploadDraft.academicYearId} onChange={(e) => setUploadDraft((draft) => ({ ...draft, academicYearId: e.target.value }))} className="mt-1 w-full rounded-sm border p-2 text-sm"><option value="">Baseline — used when no Academic-Year-specific revision exists</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
              <label className="text-xs font-semibold md:col-span-2">Change Notes<textarea aria-label="Change Notes" value={uploadDraft.changeNotes} onChange={(e) => setUploadDraft((draft) => ({ ...draft, changeNotes: e.target.value }))} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Internal Note (optional)<input aria-label="Internal Note" value={uploadDraft.internalNote} onChange={(e) => setUploadDraft((draft) => ({ ...draft, internalNote: e.target.value }))} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Template File<input aria-label="Template File" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setUploadDraft((draft) => ({ ...draft, file: e.target.files?.[0] ?? null }))} className="mt-1 block w-full text-sm" /></label>
              <div className="flex gap-2 md:col-span-2"><button type="submit" disabled={isSaving} className="rounded-sm border bg-white px-3 py-2 text-xs font-semibold">Save Draft</button><button type="button" disabled={isSaving} onClick={(event) => void submitUpload(event as unknown as FormEvent, true)} className="rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white">Upload and Activate</button></div>
            </form>
          )}
          {editingVersion && editDraft && (
            <form className="mt-4 grid gap-3 rounded-sm bg-blue-50 p-4 md:grid-cols-2" onSubmit={(event) => void submitEdit(event)}>
              <label className="text-xs font-semibold">Revision Label<input aria-label="Edit Revision Label" value={editDraft.revisionLabel} onChange={(e) => setEditDraft((draft) => draft ? ({ ...draft, revisionLabel: e.target.value }) : draft)} maxLength={50} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Effective Academic Year<select aria-label="Edit Effective Academic Year" value={editDraft.academicYearId} onChange={(e) => setEditDraft((draft) => draft ? ({ ...draft, academicYearId: e.target.value }) : draft)} className="mt-1 w-full rounded-sm border p-2 text-sm"><option value="">Baseline</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
              <label className="text-xs font-semibold md:col-span-2">Change Notes<textarea aria-label="Edit Change Notes" value={editDraft.changeNotes} onChange={(e) => setEditDraft((draft) => draft ? ({ ...draft, changeNotes: e.target.value }) : draft)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Internal Note<input aria-label="Edit Internal Note" value={editDraft.internalNote} onChange={(e) => setEditDraft((draft) => draft ? ({ ...draft, internalNote: e.target.value }) : draft)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <div className="flex items-end gap-2"><button type="submit" disabled={isSaving} className="rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white">Save Details</button><button type="button" onClick={cancelEdit} className="rounded-sm border px-3 py-2 text-xs font-semibold">Cancel</button></div>
            </form>
          )}
          {!isVersionsLoading && versions.length === 0 && (
            <div className="mt-4 rounded-sm border border-dashed border-slate-300 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">No template revisions have been uploaded for this form.</p>
              <p className="mt-1">Upload an official DOCX revision to make the template available to private School Heads.</p>
            </div>
          )}
          {!isVersionsLoading && versions.length > 0 && !versions.some((version) => version.status === "active") && (
            <div className="mt-4 rounded-sm border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <p className="font-semibold">Template revisions exist, but none is active.</p>
              <p className="mt-1">Activate a draft or archived revision to make the form available.</p>
            </div>
          )}
          <div className="mt-4 space-y-2">{versions.map((version) => (
            <article key={version.id} className="rounded-sm border p-3">
              <div className="flex flex-wrap justify-between gap-3">
                <div><p className="font-bold">{version.revisionLabel} <span className="ml-2 text-xs uppercase text-slate-500">{version.status}</span></p><p className="text-xs text-slate-600">Academic Year: {version.academicYearLabel ?? "Baseline"} · {version.originalFilename} · {(version.sizeBytes / 1024).toFixed(1)} KB</p><p className="mt-1 text-xs">{version.changeNotes}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void downloadFmQadVersion(apiToken, version)} className="inline-flex items-center gap-1 text-xs font-semibold"><Download className="h-3.5 w-3.5" /> Download</button>
                  {version.status === "draft" && <button type="button" onClick={() => openEdit(version)} className="inline-flex items-center gap-1 text-xs font-semibold"><Pencil className="h-3.5 w-3.5" /> Edit Details</button>}
                  {version.status !== "active" && <button type="button" onClick={() => void performAction(version, "activate")} className="text-xs font-semibold text-primary-700">Activate</button>}
                  {version.status === "draft" && <button type="button" onClick={() => void performAction(version, "archive")} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><Archive className="h-3.5 w-3.5" /> Archive</button>}
                  {version.status === "active" && <span className="text-xs font-semibold text-emerald-700">Current Effective Revision</span>}
                </div>
              </div>
            </article>
          ))}</div>
        </div>
      )}
    </section>
  );
}
