import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorFmQadTemplateManager } from "@/pages/monitor/MonitorFmQadTemplateManager";
import {
  fetchFmQadVersions,
  fetchMonitorFmQadForms,
  updateFmQadVersion,
  uploadFmQadVersion,
} from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm, FmQadTemplateVersion } from "@/types/fmQadTemplates";

vi.mock("@/context/Auth", () => ({ useAuth: () => ({ apiToken: "monitor-token" }) }));
vi.mock("@/lib/fmQadTemplatesApi", () => ({
  fetchMonitorFmQadForms: vi.fn(),
  fetchFmQadVersions: vi.fn(),
  uploadFmQadVersion: vi.fn(),
  mutateFmQadVersion: vi.fn(),
  updateFmQadVersion: vi.fn(),
  downloadFmQadVersion: vi.fn(),
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

function version(id: string, form: FmQadTemplateForm, status: FmQadTemplateVersion["status"] = "draft"): FmQadTemplateVersion {
  return {
    id,
    formId: form.id,
    scopeId: form.scopeId,
    code: form.code,
    formName: form.name,
    revisionLabel: id,
    status,
    academicYearId: "year-1",
    academicYearLabel: "20262027",
    originalFilename: `${id}.docx`,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 100,
    sha256Hash: "hash",
    changeNotes: `${id} notes`,
    internalNote: null,
    uploadedBy: null,
    activatedBy: null,
    activatedAt: status === "active" ? "2026-07-29T00:00:00Z" : null,
    archivedAt: status === "archived" ? "2026-07-29T00:00:00Z" : null,
    createdAt: "2026-07-29T00:00:00Z",
    updatedAt: "2026-07-29T00:00:00Z",
    downloadUrl: `/api/fm-qad/template-versions/${id}/download`,
  };
}

describe("MonitorFmQadTemplateManager", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMonitorFmQadForms).mockResolvedValue({
      data: forms,
      academicYears: [{ id: "year-1", name: "20262027", isCurrent: true }],
    });
    vi.mocked(fetchFmQadVersions).mockResolvedValue([]);
    vi.mocked(uploadFmQadVersion).mockResolvedValue({} as never);
    vi.mocked(updateFmQadVersion).mockResolvedValue({} as never);
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

  it("ignores stale version history after rapid form switching", async () => {
    let resolveFirst!: (value: FmQadTemplateVersion[]) => void;
    let resolveSecond!: (value: FmQadTemplateVersion[]) => void;
    vi.mocked(fetchFmQadVersions)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[2]);
    resolveSecond([version("Rev. 03", forms[2])]);
    expect(await screen.findByText("Rev. 03")).toBeTruthy();
    resolveFirst([version("Rev. 01", forms[0])]);
    await waitFor(() => expect(screen.queryByText("Rev. 01")).toBeNull());
    expect(screen.getAllByText(/FM-QAD-003/).length).toBeGreaterThanOrEqual(2);
  });

  it("aborts active history when closed", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(fetchFmQadVersions).mockImplementation((_token, _formId, requestSignal) => {
      signal = requestSignal;
      return new Promise(() => undefined);
    });
    const onClose = vi.fn();
    render(<MonitorFmQadTemplateManager onClose={onClose} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    await waitFor(() => expect(signal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Close FM-QAD Template Management" }));
    expect(signal?.aborted).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it("edits draft metadata and does not offer archive for active versions", async () => {
    vi.mocked(fetchFmQadVersions).mockResolvedValue([
      version("Rev. 04", forms[0], "draft"),
      version("Rev. 03", forms[0], "active"),
    ]);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    await screen.findByText("Rev. 04");
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(1);
    expect(screen.getByText("Current Effective Revision")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit Details/i }));
    fireEvent.change(screen.getByLabelText("Edit Revision Label"), { target: { value: "Rev. 04a" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Details" }));
    await waitFor(() => expect(updateFmQadVersion).toHaveBeenCalledWith(
      "monitor-token",
      "Rev. 04",
      expect.objectContaining({ revisionLabel: "Rev. 04a", academicYearId: "year-1" }),
    ));
  });

  it("coalesces duplicate realtime events and refreshes only the selected form", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[2]);
    await waitFor(() => expect(fetchFmQadVersions).toHaveBeenCalled());
    const formCallsBefore = vi.mocked(fetchMonitorFmQadForms).mock.calls.length;
    const versionCallsBefore = vi.mocked(fetchFmQadVersions).mock.calls.length;

    window.dispatchEvent(new CustomEvent("cspams:update", { detail: { entity: "fm_qad_template" } }));
    window.dispatchEvent(new CustomEvent("cspams:update", { detail: { entity: "fm_qad_template" } }));

    await waitFor(() => {
      expect(fetchMonitorFmQadForms).toHaveBeenCalledTimes(formCallsBefore + 1);
      expect(fetchFmQadVersions).toHaveBeenCalledTimes(versionCallsBefore + 1);
    });
    const versionCalls = vi.mocked(fetchFmQadVersions).mock.calls;
    expect(versionCalls[versionCalls.length - 1]?.[1]).toBe("form-3");
  });
});
