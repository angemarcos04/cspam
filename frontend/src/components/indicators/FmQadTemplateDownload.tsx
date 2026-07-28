import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/Auth";
import { useFmQadTemplates } from "@/hooks/useFmQadTemplates";
import { downloadFmQadVersion } from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm } from "@/types/fmQadTemplates";

export function FmQadTemplateDownload({
  academicYearId,
  onTemplatesChange,
}: {
  academicYearId: string;
  onTemplatesChange?: (templates: FmQadTemplateForm[]) => void;
}) {
  const { apiToken } = useAuth();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const { templates, isLoading, error, refresh } = useFmQadTemplates({
    token: apiToken,
    academicYearId,
    enabled: Boolean(academicYearId),
  });
  useEffect(() => onTemplatesChange?.(templates), [onTemplatesChange, templates]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  const version = selectedTemplate?.activeVersion ?? null;

  const handleDownload = async () => {
    if (!version || isDownloading) return;
    setDownloadError("");
    setIsDownloading(true);
    try {
      await downloadFmQadVersion(apiToken, version);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Template download failed.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <section aria-labelledby="fm-qad-template-download-heading" className="rounded-sm border border-slate-200 bg-white p-3">
      <h2 id="fm-qad-template-download-heading" className="text-sm font-semibold text-slate-900">Download FM-QAD Template</h2>
      <p className="mt-1 text-xs text-slate-500">Select the effective official form for this Academic Year, complete it, then upload the accomplished file in its matching section.</p>
      {isLoading && <p className="mt-3 text-sm text-slate-600">Loading templates...</p>}
      {(error || downloadError) && (
        <div className="mt-3 flex items-center gap-2 text-sm text-rose-700">
          <span>{error || downloadError}</span>
          {error && <button type="button" onClick={() => void refresh()} className="font-semibold underline">Retry</button>}
        </div>
      )}
      {!isLoading && !error && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="fm-qad-template-select" className="mb-1 block text-[12px] font-medium text-slate-500">FM-QAD template</label>
            <select
              id="fm-qad-template-select"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="">Select a template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.code} - {template.name}</option>
              ))}
            </select>
            {selectedTemplate && !version && <p className="mt-2 text-xs text-amber-700">No active template is configured for this Academic Year.</p>}
            {version && (
              <dl className="mt-2 grid gap-1 text-xs text-slate-600">
                <div><dt className="inline font-semibold">Current revision: </dt><dd className="inline">{version.revisionLabel}</dd></div>
                <div><dt className="inline font-semibold">Effective Academic Year: </dt><dd className="inline">{version.academicYearLabel ?? "Baseline"}</dd></div>
                <div><dt className="inline font-semibold">Change notes: </dt><dd className="inline">{version.changeNotes}</dd></div>
              </dl>
            )}
          </div>
          <button type="button" onClick={() => void handleDownload()} disabled={!version || isDownloading} className="inline-flex shrink-0 items-center justify-center rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {isDownloading ? "Downloading..." : "Download Current Template"}
          </button>
        </div>
      )}
    </section>
  );
}
