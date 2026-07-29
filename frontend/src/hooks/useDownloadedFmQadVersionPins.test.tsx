import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDownloadedFmQadVersionPins } from "@/hooks/useDownloadedFmQadVersionPins";
import type { FmQadTemplateVersion } from "@/types/fmQadTemplates";

const version: FmQadTemplateVersion = {
  id: "version-2",
  formId: "form-3",
  scopeId: "fm_qad_003",
  code: "FM-QAD-003",
  formName: "Renewal Permit",
  revisionLabel: "Rev. 02",
  status: "active",
  academicYearId: "year-1",
  academicYearLabel: "2025-2026",
  originalFilename: "FM-QAD-003.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 100,
  sha256Hash: "hash",
  changeNotes: "Revision two.",
  uploadedBy: null,
  activatedBy: null,
  activatedAt: null,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
  downloadUrl: "/api/fm-qad/template-versions/version-2/download",
};

describe("useDownloadedFmQadVersionPins", () => {
  beforeEach(() => localStorage.clear());

  it("persists pins by school, Academic Year, and scope without cross-context reuse", async () => {
    const view = renderHook(
      ({ schoolId, yearId }) => useDownloadedFmQadVersionPins(schoolId, yearId),
      { initialProps: { schoolId: "school-1", yearId: "year-1" } },
    );
    act(() => view.result.current.recordDownload(version));
    expect(view.result.current.pinsByScope.fm_qad_003?.versionId).toBe("version-2");

    view.rerender({ schoolId: "school-2", yearId: "year-1" });
    await waitFor(() => expect(view.result.current.pinsByScope.fm_qad_003).toBeUndefined());

    view.rerender({ schoolId: "school-1", yearId: "year-2" });
    await waitFor(() => expect(view.result.current.pinsByScope.fm_qad_003).toBeUndefined());

    view.rerender({ schoolId: "school-1", yearId: "year-1" });
    await waitFor(() => expect(view.result.current.pinsByScope.fm_qad_003?.revisionLabel).toBe("Rev. 02"));
  });
});
