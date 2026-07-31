import { apiRequest, COOKIE_SESSION_TOKEN, getApiBaseUrl } from "@/lib/api";
import type {
  FmQadDownloadedVersionGrant,
  FmQadTemplateForm,
  FmQadTemplateVersion,
  MonitorFmQadCatalogMeta,
  MonitorFmQadCatalogResponse,
} from "@/types/fmQadTemplates";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCatalogForm(value: unknown): value is FmQadTemplateForm {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.scopeId === "string"
    && typeof value.code === "string"
    && typeof value.name === "string"
    && (value.activeVersions === undefined || Array.isArray(value.activeVersions));
}

function isAcademicYear(value: unknown): value is MonitorFmQadCatalogResponse["academicYears"][number] {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.isCurrent === "boolean";
}

function parseCatalogMeta(value: unknown): MonitorFmQadCatalogMeta | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value)
    || typeof value.configuredFormCount !== "number"
    || typeof value.catalogCount !== "number"
    || typeof value.enabledCatalogCount !== "number"
    || typeof value.initializationRequired !== "boolean"
    || !Array.isArray(value.missingScopeIds)
    || !value.missingScopeIds.every((scopeId) => typeof scopeId === "string")
  ) {
    throw new Error("The FM-QAD catalog metadata response is invalid.");
  }

  return {
    configuredFormCount: value.configuredFormCount,
    catalogCount: value.catalogCount,
    enabledCatalogCount: value.enabledCatalogCount,
    initializationRequired: value.initializationRequired,
    missingScopeIds: value.missingScopeIds,
  };
}

export function parseMonitorFmQadCatalog(payload: unknown): MonitorFmQadCatalogResponse {
  if (!isRecord(payload)) {
    throw new Error("The FM-QAD catalog response is invalid.");
  }
  if (!Array.isArray(payload.data)) {
    throw new Error("The FM-QAD catalog response does not contain a valid form list.");
  }
  if (!payload.data.every(isCatalogForm)) {
    throw new Error("The FM-QAD catalog response contains an invalid form entry.");
  }

  const academicYears = payload.academicYears ?? [];
  if (!Array.isArray(academicYears) || !academicYears.every(isAcademicYear)) {
    throw new Error("The FM-QAD Academic Year response is invalid.");
  }

  return {
    data: payload.data,
    academicYears,
    meta: parseCatalogMeta(payload.meta),
  };
}

export async function fetchEffectiveFmQadTemplates(token: string, academicYearId: string, signal?: AbortSignal) {
  const response = await apiRequest<{ data: FmQadTemplateForm[] }>(
    `/api/fm-qad/templates?academic_year_id=${encodeURIComponent(academicYearId)}`,
    { token, signal },
  );
  return response.data;
}

export async function fetchMonitorFmQadForms(token: string, signal?: AbortSignal): Promise<MonitorFmQadCatalogResponse> {
  const payload = await apiRequest<unknown>(
    "/api/monitor/fm-qad/forms",
    { token, signal },
  );

  return parseMonitorFmQadCatalog(payload);
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
