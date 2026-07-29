import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Archive, Download, FileUp, Pencil, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/context/Auth";
import {
  downloadFmQadVersion,
  fetchFmQadVersions,
  fetchMonitorFmQadForms,
  mutateFmQadVersion,
  updateFmQadVersion,
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
  const [editRevisionLabel, setEditRevisionLabel] = useState("");
  const [editAcademicYearId, setEditAcademicYearId] = useState("");
  const [editChangeNotes, setEditChangeNotes] = useState("");
  const [editInternalNote, setEditInternalNote] = useState("");
  const selectedFormIdRef = useRef<string | null>(null);
  const historyControllerRef = useRef<AbortController | null>(null);
  const historySequenceRef = useRef(0);
  const realtimeRefreshTimerRef = useRef<number | null>(null);

  const loadVersions = useCallback(async (formId: string) => {
    const sequence = ++historySequenceRef.current;
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    try {
      const next = await fetchFmQadVersions(apiToken, formId, controller.signal);
      if (sequence === historySequenceRef.current && selectedFormIdRef.current === formId) {
        setVersions(next);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (sequence === historySequenceRef.current && selectedFormIdRef.current === formId) {
        setError(cause instanceof Error ? cause.message : "Unable to load version history.");
      }
    }
  }, [apiToken]);

  const refreshForms = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const result = await fetchMonitorFmQadForms(apiToken);
      setForms(result.data);
      setYears(result.academicYears);
      const selectedId = selectedFormIdRef.current;
      if (selectedId) {
        const updated = result.data.find((form) => form.id === selectedId) ?? null;
        setSelectedForm(updated);
        if (!updated) {
          selectedFormIdRef.current = null;
          historyControllerRef.current?.abort();
          setVersions([]);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load FM-QAD templates.");
    } finally {
      setIsLoading(false);
    }
  }, [apiToken]);

  const refresh = useCallback(async () => {
    await refreshForms();
    const selectedId = selectedFormIdRef.current;
    if (selectedId) await loadVersions(selectedId);
  }, [loadVersions, refreshForms]);

  useEffect(() => { void refreshForms(); }, [refreshForms]);
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<{ entity?: string }>).detail?.entity !== "fm_qad_template") return;
      if (realtimeRefreshTimerRef.current !== null) return;
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void refresh();
      }, 50);
    };
    window.addEventListener("cspams:update", listener);
    return () => {
      window.removeEventListener("cspams:update", listener);
      historySequenceRef.current += 1;
      historyControllerRef.current?.abort();
      if (realtimeRefreshTimerRef.current !== null) window.clearTimeout(realtimeRefreshTimerRef.current);
    };
  }, [refresh]);

  const openVersions = async (form: FmQadTemplateForm) => {
    selectedFormIdRef.current = form.id;
    setSelectedForm(form);
    setError("");
    setVersions([]);
    await loadVersions(form.id);
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

  const startEditing = (version: FmQadTemplateVersion) => {
    setEditingVersion(version);
    setEditRevisionLabel(version.revisionLabel);
    setEditAcademicYearId(version.academicYearId ?? "");
    setEditChangeNotes(version.changeNotes);
    setEditInternalNote(version.internalNote ?? "");
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingVersion || !editRevisionLabel.trim() || !editAcademicYearId || !editChangeNotes.trim()) {
      setError("Revision label, Academic Year, and change notes are required.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await updateFmQadVersion(apiToken, editingVersion.id, {
        revisionLabel: editRevisionLabel,
        academicYearId: editAcademicYearId,
        changeNotes: editChangeNotes,
        internalNote: editInternalNote,
      });
      setEditingVersion(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update draft details.");
    } finally {
      setIsSaving(false);
    }
  };

  const closeManager = () => {
    historySequenceRef.current += 1;
    historyControllerRef.current?.abort();
    onClose();
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
            <form className="mt-4 grid gap-3 rounded-sm border border-primary-200 bg-primary-50/40 p-4 md:grid-cols-2" onSubmit={(event) => void submitEdit(event)}>
              <h4 className="font-bold md:col-span-2">Edit {editingVersion.revisionLabel} Details</h4>
              <label className="text-xs font-semibold">Revision Label<input aria-label="Edit Revision Label" value={editRevisionLabel} onChange={(event) => setEditRevisionLabel(event.target.value)} maxLength={50} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold">Effective Academic Year<select aria-label="Edit Effective Academic Year" value={editAcademicYearId} onChange={(event) => setEditAcademicYearId(event.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm"><option value="">Select Academic Year</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
              <label className="text-xs font-semibold md:col-span-2">Change Notes<textarea aria-label="Edit Change Notes" value={editChangeNotes} onChange={(event) => setEditChangeNotes(event.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <label className="text-xs font-semibold md:col-span-2">Internal Note (optional)<input aria-label="Edit Internal Note" value={editInternalNote} onChange={(event) => setEditInternalNote(event.target.value)} className="mt-1 w-full rounded-sm border p-2 text-sm" /></label>
              <div className="flex gap-2 md:col-span-2"><button type="submit" disabled={isSaving} className="rounded-sm bg-primary px-3 py-2 text-xs font-semibold text-white">Save Details</button><button type="button" onClick={() => setEditingVersion(null)} className="rounded-sm border bg-white px-3 py-2 text-xs font-semibold">Cancel</button></div>
            </form>
          )}
          <div className="mt-4 space-y-2">{versions.map((version) => (
            <article key={version.id} className="rounded-sm border p-3">
              <div className="flex flex-wrap justify-between gap-3">
                <div><p className="font-bold">{version.revisionLabel} <span className="ml-2 text-xs uppercase text-slate-500">{version.status}</span></p><p className="text-xs text-slate-600">Academic Year: {version.academicYearLabel ?? "Baseline"} · {version.originalFilename} · {(version.sizeBytes / 1024).toFixed(1)} KB</p><p className="mt-1 text-xs">{version.changeNotes}</p></div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void downloadFmQadVersion(apiToken, version)} className="inline-flex items-center gap-1 text-xs font-semibold"><Download className="h-3.5 w-3.5" /> Download</button>
                  {version.status === "draft" && <button type="button" onClick={() => startEditing(version)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700"><Pencil className="h-3.5 w-3.5" /> Edit Details</button>}
                  {version.status !== "active" && <button type="button" onClick={() => void performAction(version, "activate")} className="text-xs font-semibold text-primary-700">Activate</button>}
                  {version.status === "draft" && <button type="button" onClick={() => void performAction(version, "archive")} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><Archive className="h-3.5 w-3.5" /> Archive</button>}
                  {version.status === "active" && <span className="text-xs font-semibold text-primary-700">Current Effective Revision</span>}
                </div>
              </div>
            </article>
          ))}</div>
        </div>
      )}
    </section>
  );
}
