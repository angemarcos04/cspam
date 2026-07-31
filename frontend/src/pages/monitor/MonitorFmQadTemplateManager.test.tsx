import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorFmQadTemplateManager } from "@/pages/monitor/MonitorFmQadTemplateManager";
import {
  fetchFmQadVersions,
  fetchMonitorFmQadForms,
  updateFmQadVersionMetadata,
  uploadFmQadVersion,
} from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm } from "@/types/fmQadTemplates";
import type { FmQadTemplateVersion } from "@/types/fmQadTemplates";

vi.mock("@/context/Auth", () => ({ useAuth: () => ({ apiToken: "monitor-token" }) }));
vi.mock("@/lib/fmQadTemplatesApi", () => ({
  fetchMonitorFmQadForms: vi.fn(),
  fetchFmQadVersions: vi.fn(),
  uploadFmQadVersion: vi.fn(),
  mutateFmQadVersion: vi.fn(),
  downloadFmQadVersion: vi.fn(),
  updateFmQadVersionMetadata: vi.fn(),
}));

const forms: FmQadTemplateForm[] = ["001", "002", "003", "004", "008", "009", "010", "011", "034", "041"].map((code, index) => {
  return {
    id: `form-${index + 1}`,
    scopeId: `fm_qad_${code}`,
    code: `FM-QAD-${code}`,
    name: `Form ${index + 1}`,
    activeVersion: null,
    activeVersions: [],
  };
});

const draftVersion: FmQadTemplateVersion = {
  id: "v3",
  formId: "form-1",
  scopeId: "fm_qad_001",
  code: "FM-QAD-001",
  formName: "Form 1",
  revisionLabel: "Rev. 03",
  status: "draft",
  academicYearId: "year-1",
  academicYearLabel: "20262027",
  originalFilename: "v3.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 1,
  sha256Hash: "3",
  changeNotes: "Rev. 03 notes",
  internalNote: "Rev. 03 internal",
  activatedAt: null,
  archivedAt: null,
  createdAt: null,
  updatedAt: null,
  uploadedBy: null,
  activatedBy: null,
  downloadUrl: "/v3",
};

describe("MonitorFmQadTemplateManager", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMonitorFmQadForms).mockResolvedValue({
      data: forms,
      academicYears: [{ id: "year-1", name: "20262027", isCurrent: true }],
    });
    vi.mocked(fetchFmQadVersions).mockResolvedValue([]);
    vi.mocked(uploadFmQadVersion).mockResolvedValue({} as never);
    vi.mocked(updateFmQadVersionMetadata).mockResolvedValue(draftVersion);
  });

  it("lists the fixed catalog and opens version history", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    expect(await screen.findByText("FM-QAD-001")).toBeTruthy();
    expect(screen.getByText("FM-QAD-010")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    await waitFor(() => expect(fetchFmQadVersions).toHaveBeenCalledWith("monitor-token", "form-1", expect.any(AbortSignal)));
    expect(screen.getByText(/Newest revisions first/i)).toBeTruthy();
  });

  it("uploads a required DOCX revision as a draft", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Upload New Version/i }));
    fireEvent.change(screen.getByLabelText("Revision Label"), { target: { value: "Rev. 03" } });
    fireEvent.change(screen.getByLabelText("Effective Academic Year"), { target: { value: "year-1" } });
    fireEvent.change(screen.getByLabelText("Change Notes"), { target: { value: "Updated signature section" } });
    const file = new File(["docx"], "FM-QAD-001-Rev-03.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByLabelText("Template File"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(uploadFmQadVersion).toHaveBeenCalledWith(
      "monitor-token",
      "form-1",
      expect.objectContaining({
        revisionLabel: "Rev. 03",
        academicYearId: "year-1",
        changeNotes: "Updated signature section",
        file,
        activate: false,
      }),
    ));
  });

  it("ignores stale history and aborts pending requests when the manager closes", async () => {
    let resolveFirst!: (versions: FmQadTemplateVersion[]) => void;
    let resolveSecond!: (versions: FmQadTemplateVersion[]) => void;
    const first = new Promise<FmQadTemplateVersion[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<FmQadTemplateVersion[]>((resolve) => { resolveSecond = resolve; });
    vi.mocked(fetchFmQadVersions)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const onClose = vi.fn();
    render(<MonitorFmQadTemplateManager onClose={onClose} />);
    await screen.findByText("FM-QAD-001");
    const manage = screen.getAllByRole("button", { name: "Manage" });
    fireEvent.click(manage[0]);
    fireEvent.click(manage[1]);
    const firstSignal = vi.mocked(fetchFmQadVersions).mock.calls[0][2] as AbortSignal;
    expect(firstSignal.aborted).toBe(true);
    resolveSecond([{ id: "v2", formId: "form-2", scopeId: "fm_qad_002", code: "FM-QAD-002", formName: "Form 2", revisionLabel: "Rev. 22", status: "draft", academicYearId: "year-1", academicYearLabel: "20262027", originalFilename: "v2.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 1, sha256Hash: "2", changeNotes: "new", activatedAt: null, archivedAt: null, createdAt: null, updatedAt: null, uploadedBy: null, activatedBy: null, downloadUrl: "/v2" }]);
    expect(await screen.findByText("Rev. 22")).toBeTruthy();
    resolveFirst([{ id: "v1", formId: "form-1", scopeId: "fm_qad_001", code: "FM-QAD-001", formName: "Form 1", revisionLabel: "STALE REVISION", status: "draft", academicYearId: "year-1", academicYearLabel: "20262027", originalFilename: "v1.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 1, sha256Hash: "1", changeNotes: "old", activatedAt: null, archivedAt: null, createdAt: null, updatedAt: null, uploadedBy: null, activatedBy: null, downloadUrl: "/v1" }]);
    await Promise.resolve();
    expect(screen.queryByText("STALE REVISION")).toBeNull();
    const secondSignal = vi.mocked(fetchFmQadVersions).mock.calls[1][2] as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Close FM-QAD Template Management" }));
    expect(secondSignal.aborted).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores AbortError and superseded failures without replacing the current history", async () => {
    let rejectFirst!: (cause: unknown) => void;
    const first = new Promise<FmQadTemplateVersion[]>((_resolve, reject) => { rejectFirst = reject; });
    vi.mocked(fetchFmQadVersions)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce([{ ...draftVersion, id: "current", formId: "form-2", revisionLabel: "Current Rev." }]);

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    const manage = screen.getAllByRole("button", { name: "Manage" });
    fireEvent.click(manage[0]);
    fireEvent.click(manage[1]);
    rejectFirst(new DOMException("Aborted", "AbortError"));

    expect(await screen.findByText("Current Rev.")).toBeTruthy();
    await Promise.resolve();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText(/FM-QAD-002/).length).toBeGreaterThan(1);
  });

  it("ignores a superseded non-abort error but displays the current request error", async () => {
    let rejectFirst!: (cause: unknown) => void;
    const first = new Promise<FmQadTemplateVersion[]>((_resolve, reject) => { rejectFirst = reject; });
    vi.mocked(fetchFmQadVersions)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce([draftVersion]);

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    const manage = screen.getAllByRole("button", { name: "Manage" });
    fireEvent.click(manage[0]);
    fireEvent.click(manage[1]);
    rejectFirst(new Error("Old request failed"));
    expect(await screen.findByText("Rev. 03")).toBeTruthy();
    expect(screen.queryByText("Old request failed")).toBeNull();

    vi.mocked(fetchFmQadVersions).mockRejectedValueOnce(new Error("Current request failed"));
    fireEvent.click(manage[2]);
    expect((await screen.findByRole("alert")).textContent).toContain("Current request failed");
  });

  it("keeps upload and edit drafts mutually exclusive and isolated", async () => {
    vi.mocked(fetchFmQadVersions).mockResolvedValue([draftVersion]);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    expect(await screen.findByText("Rev. 03")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Upload New Version/i }));
    fireEvent.change(screen.getByLabelText("Revision Label"), { target: { value: "Rev. 04" } });
    fireEvent.click(screen.getByRole("button", { name: /Edit Details/i }));

    expect(document.querySelector('[aria-label="Revision Label"]')).toBeNull();
    expect((screen.getByLabelText("Edit Revision Label") as HTMLInputElement).value).toBe("Rev. 03");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Upload New Version/i }));
    expect((screen.getByLabelText("Revision Label") as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("Edit Revision Label")).toBeNull();
  });

  it("saving edit metadata does not populate the next upload draft", async () => {
    vi.mocked(fetchFmQadVersions).mockResolvedValue([draftVersion]);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Edit Details/i }));
    fireEvent.change(screen.getByLabelText("Edit Revision Label"), { target: { value: "Rev. 03A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Details" }));
    await waitFor(() => expect(updateFmQadVersionMetadata).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /Upload New Version/i }));
    expect((screen.getByLabelText("Revision Label") as HTMLInputElement).value).toBe("");
  });
});
