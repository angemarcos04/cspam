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
import type { AcademicYearOption } from "@/types";
import type { FmQadTemplateForm, FmQadTemplateVersion } from "@/types/fmQadTemplates";

export function MonitorFmQadTemplateManager({ onClose }: { onClose: () => void }) {
  const { apiToken } = useAuth();
  const [forms, setForms] = useState<FmQadTemplateForm[]>([]);
  const [years, setYears] = useState<AcademicYearOption[]>([]);
  const [selectedForm, setSelectedForm] = useState<FmQadTemplateForm | null>(null);
  const [versions, setVersions] = useState<FmQadTemplateVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [revisionLabel, setRevisionLabel] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [changeNotes, setChangeNotes] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editingVersion, setEditingVersion] = useState<FmQadTemplateVersion | null>(null);
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
    const result = await fetchFmQadVersions(apiToken, formId, controller.signal);
    if (sequence === versionRequestSequenceRef.current && selectedFormIdRef.current === formId) {
      setVersions(result);
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
      const selectedId = selectedFormIdRef.current;
      if (selectedId) {
        const updated = result.data.find((form) => form.id === selectedId) ?? null;
        setSelectedForm(updated);
        if (updated) await loadVersions(updated.id);
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError") && sequence === formRequestSequenceRef.current) {
        setError(cause instanceof Error ? cause.message : "Unable to load FM-QAD templates.");
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
      setError(cause instanceof Error ? cause.message : "Unable to load version history.");
    }
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
    if (!editingVersion) return;
    setIsSaving(true);
    setError("");
    try {
      await updateFmQadVersionMetadata(apiToken, editingVersion.id, {
        revisionLabel, academicYearId: academicYearId || null, changeNotes, internalNote: internalNote || null,
      });
      setEditingVersion(null);
      await loadVersions(editingVersion.formId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update template details.");
    } finally {
      setIsSaving(false);
    }
  };

  const submitUpload = async (event: FormEvent, activate: boolean) => {
    event.preventDefault();
    if (!selectedForm || !file || !revisionLabel.trim() || !academicYearId || !changeNotes.trim()) {
      setError("Form, revision label, Academic Year, change notes, and a DOCX file are required.");
      return;
    }
    if (activate && !window.confirm(
      `Activate ${selectedForm.code} ${revisionLabel.trim()}?\n\nThis will make it the current template for the selected Academic Year. Existing uploaded, submitted, returned, and verified files will not be changed.`,
    )) return;
    setIsSaving(true);
    setError("");
    try {
      await uploadFmQadVersion(apiToken, selectedForm.id, {
        revisionLabel, academicYearId, changeNotes, internalNote, file, activate,
      });
      setRevisionLabel(""); setChangeNotes(""); setInternalNote(""); setFile(null); setShowUpload(false);
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

  return (
    <section aria-labelledby="fm-qad-manager-title" className="border-b border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="fm-qad-manager-title" className="text-base font-bold text-slate-900">FM-QAD Template Management</h2>
          <p className="mt-1 text-xs text-slate-500">Manage official DOCX revisions without changing permanent FM-QAD submission scopes.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-1 rounded-sm border px-3 py-2 text-xs font-semibold"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
          <button type="button" onClick={closeManager} aria-label="Close FM-QAD Template Management" className="rounded-sm border p-2"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-sm bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {isLoading ? <p className="mt-4 text-sm text-slate-600">Loading template library...</p> : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-2">Code</th><th className="p-2">Form name</th><th className="p-2">Active revision</th><th className="p-2">Academic Year</th><th className="p-2">File</th><th className="p-2">Status</th><th className="p-2">Activated</th><th className="p-2">Actions</th></tr></thead>
            <tbody>{forms.map((form) => {
              const current = form.activeVersions?.[0] ?? null;
              return <tr key={form.id} className="border-b align-top"><td className="p-2 font-bold">{form.code}</td><td className="p-2">{form.name}</td><td className="p-2">{current?.revisionLabel ?? "Not configured"}</td><td className="p-2">{current?.academicYearLabel ?? (current ? "Baseline" : "—")}</td><td className="p-2"><span className="block max-w-48 break-words">{current?.originalFilename ?? "—"}</span>{current && <span className="text-xs text-slate-500">{(current.sizeBytes / 1024).toFixed(1)} KB</span>}</td><td className="p-2 capitalize">{current?.status ?? "Unavailable"}</td><td className="p-2">{current?.activatedAt ? new Date(current.activatedAt).toLocaleDateString() : "—"}</td><td className="p-2"><div className="flex flex-col items-start gap-1"><button type="button" onClick={() => void openVersions(form)} className="font-semibold text-primary-700 underline">Manage</button>{current && <button type="button" onClick={() => void downloadFmQadVersion(apiToken, current)} className="font-semibold text-slate-700 underline">Download active</button>}</div></td></tr>;
            })}</tbody>
          </table>
        </div>
      )}
      {selectedForm && (
        <div className="mt-5 rounded-sm border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold">{selectedForm.code} · {selectedForm.name}</h3><p className="text-xs text-slate-500">Newest revisions first</p></div>
            <button type="button" onClick={() => setShowUpload((value) => !value)} className="inline-flex items-center gap-1 rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white"><FileUp className="h-3.5 w-3.5" /> Upload New Version</button>
          </div>
          {showUpload && (
            <form className="mt-4 grid gap-3 rounded-sm bg-slate-50 p-4 md:grid-cols-2" onSubmit={(event) => void submitUpload(event, false)}>
              <label className="text-xs font-semibold">Revision Label<input aria-label="Revision Label" value={revisionLabel} onChange={(e) => setRevisionLabel(e.target.value)} maxLength={50} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Effective Academic Year<select aria-label="Effective Academic Year" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm"><option value="">Select Academic Year</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
              <label className="text-xs font-semibold md:col-span-2">Change Notes<textarea aria-label="Change Notes" value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Internal Note (optional)<input aria-label="Internal Note" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Template File<input aria-label="Template File" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-sm" /></label>
              <div className="flex gap-2 md:col-span-2"><button type="submit" disabled={isSaving} className="rounded-sm border bg-white px-3 py-2 text-xs font-semibold">Save Draft</button><button type="button" disabled={isSaving} onClick={(event) => void submitUpload(event as unknown as FormEvent, true)} className="rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white">Upload and Activate</button></div>
            </form>
          )}
          {editingVersion && (
            <form className="mt-4 grid gap-3 rounded-sm bg-blue-50 p-4 md:grid-cols-2" onSubmit={(event) => void submitEdit(event)}>
              <label className="text-xs font-semibold">Revision Label<input aria-label="Edit Revision Label" value={revisionLabel} onChange={(e) => setRevisionLabel(e.target.value)} maxLength={50} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Effective Academic Year<select aria-label="Edit Effective Academic Year" value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm"><option value="">Baseline</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
              <label className="text-xs font-semibold md:col-span-2">Change Notes<textarea aria-label="Edit Change Notes" value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Internal Note<input aria-label="Edit Internal Note" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <div className="flex items-end gap-2"><button type="submit" disabled={isSaving} className="rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white">Save Details</button><button type="button" onClick={() => setEditingVersion(null)} className="rounded-sm border px-3 py-2 text-xs font-semibold">Cancel</button></div>
            </form>
          )}
          <div className="mt-4 space-y-2">{versions.map((version) => (
            <article key={version.id} className="rounded-sm border p-3">
              <div className="flex flex-wrap justify-between gap-3">
                <div><p className="font-bold">{version.revisionLabel} <span className="ml-2 text-xs uppercase text-slate-500">{version.status}</span></p><p className="text-xs text-slate-600">Academic Year: {version.academicYearLabel ?? "Baseline"} · {version.originalFilename} · {(version.sizeBytes / 1024).toFixed(1)} KB</p><p className="mt-1 text-xs">{version.changeNotes}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void downloadFmQadVersion(apiToken, version)} className="inline-flex items-center gap-1 text-xs font-semibold"><Download className="h-3.5 w-3.5" /> Download</button>
                  {version.status === "draft" && <button type="button" onClick={() => { setEditingVersion(version); setRevisionLabel(version.revisionLabel); setAcademicYearId(version.academicYearId ?? ""); setChangeNotes(version.changeNotes); setInternalNote(version.internalNote ?? ""); }} className="inline-flex items-center gap-1 text-xs font-semibold"><Pencil className="h-3.5 w-3.5" /> Edit Details</button>}
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
