export type FmQadTemplateVersionStatus = "draft" | "active" | "archived";

export interface FmQadTemplateVersion {
  id: string;
  formId: string;
  scopeId: string;
  code: string;
  formName: string;
  revisionLabel: string;
  status: FmQadTemplateVersionStatus;
  academicYearId: string | null;
  academicYearLabel: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  changeNotes: string;
  internalNote?: string | null;
  uploadedBy: { id: string; name: string } | null;
  activatedBy: { id: string; name: string } | null;
  activatedAt: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isUsedBySubmission?: boolean | null;
  downloadUrl: string;
}

export interface FmQadTemplateForm {
  id: string;
  scopeId: string;
  code: string;
  name: string;
  activeVersion: FmQadTemplateVersion | null;
  activeVersions?: FmQadTemplateVersion[];
}

export interface FmQadDownloadedVersionGrant {
  grantId: string;
  schoolId: string;
  academicYearId: string;
  scopeId: string;
  versionId: string;
  revisionLabel: string;
  downloadedAt: string;
}
