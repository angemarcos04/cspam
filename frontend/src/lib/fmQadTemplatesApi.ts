import { apiRequest, COOKIE_SESSION_TOKEN, getApiBaseUrl } from "@/lib/api";
import type { AcademicYearOption } from "@/types";
import type { FmQadDownloadedVersionGrant, FmQadTemplateForm, FmQadTemplateVersion } from "@/types/fmQadTemplates";

export async function fetchEffectiveFmQadTemplates(token: string, academicYearId: string, signal?: AbortSignal) {
  const response = await apiRequest<{ data: FmQadTemplateForm[] }>(
    `/api/fm-qad/templates?academic_year_id=${encodeURIComponent(academicYearId)}`,
    { token, signal },
  );
  return response.data;
}

export async function fetchMonitorFmQadForms(token: string, signal?: AbortSignal) {
  return apiRequest<{ data: FmQadTemplateForm[]; academicYears: AcademicYearOption[] }>(
    "/api/monitor/fm-qad/forms",
    { token, signal },
  );
}

export async function fetchFmQadVersions(token: string, formId: string, signal?: AbortSignal) {
  const response = await apiRequest<{ data: FmQadTemplateVersion[] }>(
    `/api/monitor/fm-qad/forms/${encodeURIComponent(formId)}/versions`,
    { token, signal },
  );
  return response.data;
}

export async function uploadFmQadVersion(token: string, formId: string, payload: {
  revisionLabel: string;
  academicYearId: string;
  changeNotes: string;
  internalNote?: string;
  file: File;
  activate: boolean;
}) {
  const body = new FormData();
  body.append("revisionLabel", payload.revisionLabel);
  body.append("academicYearId", payload.academicYearId);
  body.append("changeNotes", payload.changeNotes);
  if (payload.internalNote) body.append("internalNote", payload.internalNote);
  body.append("file", payload.file);
  body.append("activate", payload.activate ? "1" : "0");
  const response = await apiRequest<{ data: FmQadTemplateVersion }>(
    `/api/monitor/fm-qad/forms/${encodeURIComponent(formId)}/versions`,
    { method: "POST", token, body, timeoutMs: 120_000 },
  );
  return response.data;
}

export async function mutateFmQadVersion(token: string, versionId: string, action: "activate" | "archive") {
  const response = await apiRequest<{ data: FmQadTemplateVersion }>(
    `/api/monitor/fm-qad/template-versions/${encodeURIComponent(versionId)}/${action}`,
    { method: "POST", token },
  );
  return response.data;
}

export async function updateFmQadVersionMetadata(token: string, versionId: string, payload: {
  revisionLabel: string;
  academicYearId: string | null;
  changeNotes: string;
  internalNote: string | null;
}, signal?: AbortSignal) {
  const response = await apiRequest<{ data: FmQadTemplateVersion }>(
    `/api/monitor/fm-qad/template-versions/${encodeURIComponent(versionId)}`,
    { method: "PATCH", token, body: payload, signal },
  );
  return response.data;
}

export async function downloadFmQadVersion(
  token: string,
  version: FmQadTemplateVersion,
  options?: { academicYearId?: string; schoolId?: string },
): Promise<FmQadDownloadedVersionGrant | null> {
  const headers = new Headers({ Accept: "*/*" });
  if (token !== COOKIE_SESSION_TOKEN) headers.set("Authorization", `Bearer ${token}`);
  const query = options?.academicYearId
    ? `${version.downloadUrl.includes("?") ? "&" : "?"}academic_year_id=${encodeURIComponent(options.academicYearId)}`
    : "";
  const response = await fetch(`${getApiBaseUrl()}${version.downloadUrl}${query}`, {
    credentials: token === COOKIE_SESSION_TOKEN ? "include" : "omit",
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message || "Template download failed.");
  }
  const grantId = response.headers.get("X-CSPAMS-FM-QAD-Download-Grant-Id");
  const versionId = response.headers.get("X-CSPAMS-FM-QAD-Version-Id");
  const revisionLabel = response.headers.get("X-CSPAMS-FM-QAD-Revision");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = version.originalFilename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  if (!grantId || !versionId || !revisionLabel || !options?.academicYearId || !options.schoolId) return null;
  return {
    grantId,
    schoolId: options.schoolId,
    academicYearId: options.academicYearId,
    scopeId: version.scopeId,
    versionId,
    revisionLabel,
    downloadedAt: new Date().toISOString(),
  };
}
