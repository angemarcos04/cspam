import { useState } from "react";
import { FM_QAD_TEMPLATE_OPTIONS } from "@/constants/fmQadTemplates";

export function buildFmQadTemplateUrl(filename: string): string {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  return `${normalizedBaseUrl}templates/fm-qad/${encodeURIComponent(filename)}`;
}

export function downloadFmQadTemplate(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function FmQadTemplateDownload() {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const selectedTemplate =
    FM_QAD_TEMPLATE_OPTIONS.find((template) => template.id === selectedTemplateId) ?? null;

  const handleDownload = () => {
    if (!selectedTemplate) {
      return;
    }

    downloadFmQadTemplate(
      buildFmQadTemplateUrl(selectedTemplate.filename),
      selectedTemplate.filename,
    );
  };

  return (
    <section
      aria-labelledby="fm-qad-template-download-heading"
      className="rounded-sm border border-slate-200 bg-white p-3"
    >
      <h2
        id="fm-qad-template-download-heading"
        className="text-sm font-semibold text-slate-900"
      >
        Download FM-QAD Template
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Select and download a blank form, complete it on your computer, then upload the
        accomplished file in the corresponding FM-QAD section.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="fm-qad-template-select"
            className="mb-1 block text-[12px] font-medium tracking-normal text-slate-500"
          >
            FM-QAD template
          </label>
          <select
            id="fm-qad-template-select"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="w-full rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-100"
          >
            <option value="">Select a template</option>
            {FM_QAD_TEMPLATE_OPTIONS.map((template) => (
              <option key={template.id} value={template.id}>
                {template.code} - {template.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          disabled={!selectedTemplate}
          className="inline-flex shrink-0 items-center justify-center rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Download
        </button>
      </div>
    </section>
  );
}
