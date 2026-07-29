import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFmQadVersion } from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateVersion } from "@/types/fmQadTemplates";

const version: FmQadTemplateVersion = {
  id: "version-3",
  formId: "form-3",
  scopeId: "fm_qad_003",
  code: "FM-QAD-003",
  formName: "Renewal Permit",
  revisionLabel: "Rev. 03",
  status: "active",
  academicYearId: "year-1",
  academicYearLabel: "20262027",
  originalFilename: "FM-QAD-003.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 100,
  sha256Hash: "hash",
  changeNotes: "Revision three.",
  uploadedBy: null,
  activatedBy: null,
  activatedAt: null,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
  downloadUrl: "/api/fm-qad/template-versions/version-3/download",
};

describe("downloadFmQadVersion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fm-qad"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the workspace Academic Year and returns the authoritative grant headers", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("docx", {
      status: 200,
      headers: {
        "Content-Type": version.mimeType,
        "X-CSPAMS-FM-QAD-Version-Id": version.id,
        "X-CSPAMS-FM-QAD-Revision": version.revisionLabel,
        "X-CSPAMS-FM-QAD-Download-Grant-Id": "grant-3",
      },
    }));

    await expect(downloadFmQadVersion("token", version, "year-1")).resolves.toEqual({
      grantId: "grant-3",
      versionId: version.id,
      revisionLabel: version.revisionLabel,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("academic_year_id=year-1"),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });

  it("rejects a School Head download when grant headers are missing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("docx", {
      status: 200,
      headers: { "Content-Type": version.mimeType },
    }));

    await expect(downloadFmQadVersion("token", version, "year-1"))
      .rejects.toThrow(/grant could not be verified/i);
  });
});
