import { Download, Eye, Upload, X } from "lucide-react";

// NEW 2026 COMPLIANCE UI: BMEF tab replaces TARGETS-MET
// 4-tab layout (School Achievements | Key Performance | BMEF | SMEA)
// Monitor & School Head views updated for DepEd standards
interface UploadFileMetadata {
  filename: string | null;
  sizeBytes: number | null;
  uploadedAt: string | null;
}

interface PendingUploadFileMetadata {
  filename: string;
  sizeBytes: number;
}

interface FileUploadFieldProps {
  label: string;
  actionLabel?: string;
  description: string;
  file: UploadFileMetadata | null;
  pendingFile?: PendingUploadFileMetadata | null;
  submitted: boolean;
  canViewReport?: boolean;
  isUploading: boolean;
  disabled: boolean;
  mutationDisabled?: boolean;
  onUploadClick: () => void;
  onCancelPendingClick?: () => void;
  onViewClick?: () => void;
  onDownloadClick: () => void;
  error?: string;
}

function formatUploadedAt(value: string | null): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "N/A";
  return parsed.toLocaleString();
}

export function FileUploadField({
  label,
  actionLabel,
  description,
  file,
  pendingFile = null,
  submitted,
  canViewReport = false,
  isUploading,
  disabled,
  mutationDisabled = false,
  onUploadClick,
  onCancelPendingClick,
  onViewClick,
  onDownloadClick,
  error = "",
}: FileUploadFieldProps) {
  const isDownloadDisabled = disabled || !submitted;
  const isMutationDisabled = disabled || mutationDisabled;
  const conciseLabel = actionLabel ?? label;
  const hasPendingFile = Boolean(pendingFile);

  return (
    <article className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">{label}</h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            submitted
              ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
              : "border border-amber-300 bg-amber-50 text-amber-700"
          }`}
        >
          {hasPendingFile ? "Ready to Save" : submitted ? "Uploaded" : "Not Uploaded"}
        </span>
      </div>

      {submitted ? (
        <div className="rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/40 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {label} file is uploaded to this draft package. You can view or download it anytime.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {file?.filename || `${label} report`}
            {file?.uploadedAt ? ` | ${formatUploadedAt(file.uploadedAt)}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Final Submit sends the full package to the monitor for review.
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={onViewClick}
              disabled={isDownloadDisabled || !canViewReport}
              className="inline-flex items-center gap-1.5 rounded-sm border border-primary-300 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Eye className="h-3.5 w-3.5" />
              {`View ${label} File`}
            </button>
            <button
              type="button"
              onClick={onDownloadClick}
              disabled={isDownloadDisabled}
              className="inline-flex items-center gap-1.5 rounded-sm border border-primary-300 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Download ${label} report`}
              title={`Download ${label} report`}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </button>
          </div>
        </div>
      ) : null}

      {hasPendingFile ? (
        <div className="rounded-xl border-2 border-dashed border-primary-200 bg-primary-50/40 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {submitted ? "Replacement file selected. Click Save to update the saved report." : "File selected. Click Save to add it to this draft package."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {pendingFile?.filename}
            {typeof pendingFile?.sizeBytes === "number" ? ` | ${(pendingFile.sizeBytes / 1024).toFixed(1)} KB` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The Report View updates only after this file is saved.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onUploadClick}
              disabled={isMutationDisabled || isUploading}
              className="inline-flex items-center gap-1.5 rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-3.5 w-3.5" />
              Change file
            </button>
            <button
              type="button"
              onClick={onCancelPendingClick}
              disabled={isMutationDisabled || isUploading || !onCancelPendingClick}
              className="inline-flex items-center gap-1.5 rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
      ) : !submitted ? (
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-sm font-semibold text-slate-700">{conciseLabel} not uploaded yet.</p>
          <p className="mt-1 text-xs text-slate-500">Choose this file, then click Save. Final Submit sends the full package for review.</p>
          <button
            type="button"
            onClick={onUploadClick}
            disabled={isMutationDisabled}
            className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" />
            {`Choose ${conciseLabel}`}
          </button>
        </div>
      ) : null}

      {error && (
        <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </p>
      )}
    </article>
  );
}
