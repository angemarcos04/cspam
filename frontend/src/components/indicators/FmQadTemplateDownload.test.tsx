import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmQadTemplateDownload } from "@/components/indicators/FmQadTemplateDownload";
import { useFmQadTemplates } from "@/hooks/useFmQadTemplates";
import { downloadFmQadVersion } from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm } from "@/types/fmQadTemplates";

vi.mock("@/context/Auth", () => ({ useAuth: () => ({ apiToken: "test-token" }) }));
vi.mock("@/hooks/useFmQadTemplates", () => ({ useFmQadTemplates: vi.fn() }));
vi.mock("@/lib/fmQadTemplatesApi", () => ({ downloadFmQadVersion: vi.fn() }));

const refresh = vi.fn();
const template: FmQadTemplateForm = {
  id: "form-3",
  scopeId: "fm_qad_003",
  code: "FM-QAD-003",
  name: "Renewal Permit",
  activeVersion: {
    id: "version-3",
    formId: "form-3",
    scopeId: "fm_qad_003",
    code: "FM-QAD-003",
    formName: "Renewal Permit",
    revisionLabel: "Rev. 03",
    status: "active",
    academicYearId: "year-1",
    academicYearLabel: "20262027",
    originalFilename: "FM-QAD-003-Rev-03.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 145280,
    sha256Hash: "abc",
    changeNotes: "Updated signature section",
    internalNote: null,
    uploadedBy: { id: "monitor-1", name: "Division Monitor" },
    activatedBy: { id: "monitor-1", name: "Division Monitor" },
    activatedAt: "2026-07-29T10:00:00Z",
    archivedAt: null,
    createdAt: "2026-07-29T09:00:00Z",
    updatedAt: "2026-07-29T10:00:00Z",
    isUsedBySubmission: false,
    downloadUrl: "/api/fm-qad/template-versions/version-3/download",
  },
};

beforeEach(() => {
  vi.mocked(downloadFmQadVersion).mockResolvedValue({
    grantId: "grant-3",
    versionId: "version-3",
    revisionLabel: "Rev. 03",
  });
  vi.mocked(useFmQadTemplates).mockReturnValue({
    templates: [template],
    isLoading: false,
    error: "",
    refresh,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FmQadTemplateDownload", () => {
  it("loads API templates and displays current version metadata", () => {
    render(<FmQadTemplateDownload academicYearId="year-1" />);
    fireEvent.change(screen.getByLabelText("FM-QAD template"), {
      target: { value: template.id },
    });
    expect(screen.getByText("Rev. 03")).toBeTruthy();
    expect(screen.getByText("20262027")).toBeTruthy();
    expect(screen.getByText("Updated signature section")).toBeTruthy();
  });

  it("downloads the authorized version without submitting a surrounding form", async () => {
    const submitHandler = vi.fn();
    render(
      <form onSubmit={(event) => {
        event.preventDefault();
        submitHandler();
      }}>
        <FmQadTemplateDownload academicYearId="year-1" />
      </form>,
    );
    fireEvent.change(screen.getByLabelText("FM-QAD template"), {
      target: { value: template.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Download Current Template" }));
    await waitFor(() => expect(downloadFmQadVersion).toHaveBeenCalledWith("test-token", template.activeVersion, "year-1"));
    expect(submitHandler).not.toHaveBeenCalled();
  });

  it("keeps download disabled when no active version exists", () => {
    vi.mocked(useFmQadTemplates).mockReturnValue({
      templates: [{ ...template, activeVersion: null }],
      isLoading: false,
      error: "",
      refresh,
    });
    render(<FmQadTemplateDownload academicYearId="year-1" />);
    fireEvent.change(screen.getByLabelText("FM-QAD template"), {
      target: { value: template.id },
    });
    expect(screen.getByText(/No active template is configured/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Download Current Template" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows loading and retry states", () => {
    vi.mocked(useFmQadTemplates).mockReturnValue({
      templates: [],
      isLoading: true,
      error: "",
      refresh,
    });
    const view = render(<FmQadTemplateDownload academicYearId="year-1" />);
    expect(screen.getByText("Loading templates...")).toBeTruthy();
    vi.mocked(useFmQadTemplates).mockReturnValue({
      templates: [],
      isLoading: false,
      error: "Template service is temporarily unavailable.",
      refresh,
    });
    view.rerender(<FmQadTemplateDownload academicYearId="year-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps a downloaded revision pinned when the active revision changes", async () => {
    const onDownloaded = vi.fn();
    render(
      <FmQadTemplateDownload
        academicYearId="year-1"
        grantsByScope={{
          fm_qad_003: {
            grantId: "grant-2",
            userId: "user-1",
            schoolId: "school-1",
            academicYearId: "year-1",
            scopeId: "fm_qad_003",
            versionId: "version-2",
            revisionLabel: "Rev. 02",
            downloadedAt: "2026-07-28T00:00:00Z",
          },
        }}
        onDownloaded={onDownloaded}
      />,
    );
    fireEvent.change(screen.getByLabelText("FM-QAD template"), { target: { value: template.id } });
    expect(screen.getByText(/Downloaded template:/)).toBeTruthy();
    expect(screen.getByText(/A newer revision is available/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download Rev. 03" }));
    await waitFor(() => expect(onDownloaded).toHaveBeenCalledWith(template.activeVersion, "grant-3"));
  });

  it("does not record a local grant when the download fails", async () => {
    const onDownloaded = vi.fn();
    vi.mocked(downloadFmQadVersion).mockRejectedValueOnce(new Error("Download failed."));
    render(<FmQadTemplateDownload academicYearId="year-1" onDownloaded={onDownloaded} />);
    fireEvent.change(screen.getByLabelText("FM-QAD template"), { target: { value: template.id } });
    fireEvent.click(screen.getByRole("button", { name: "Download Current Template" }));
    expect(await screen.findByText("Download failed.")).toBeTruthy();
    expect(onDownloaded).not.toHaveBeenCalled();
  });
});
