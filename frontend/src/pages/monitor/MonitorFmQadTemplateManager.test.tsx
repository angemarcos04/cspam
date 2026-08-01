import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MonitorFmQadTemplateManager,
  selectMonitorDisplayVersion,
} from "@/pages/monitor/MonitorFmQadTemplateManager";
import {
  fetchFmQadVersions,
  fetchMonitorFmQadForms,
  mutateFmQadVersion,
  updateFmQadVersionMetadata,
  uploadFmQadVersion,
} from "@/lib/fmQadTemplatesApi";
import { ApiError } from "@/lib/api";
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

const activeVersion = (
  id: string,
  revisionLabel: string,
  academicYearId: string | null,
): FmQadTemplateVersion => ({
  ...draftVersion,
  id,
  revisionLabel,
  status: "active",
  academicYearId,
  academicYearLabel: academicYearId,
  activatedAt: "2026-07-31T00:00:00.000Z",
});

describe("selectMonitorDisplayVersion", () => {
  const academicYears = [
    { id: "year-current", name: "20262027", isCurrent: true },
    { id: "year-previous", name: "20252026", isCurrent: false },
  ];

  it("prefers the exact active revision for the current Academic Year", () => {
    const baseline = activeVersion("baseline", "Baseline", null);
    const exact = activeVersion("exact", "Current Year", "year-current");
    const form = { ...forms[0], activeVersions: [baseline, exact] };

    expect(selectMonitorDisplayVersion(form, academicYears)?.id).toBe("exact");
  });

  it("uses the active baseline when the current Academic Year has no exact revision", () => {
    const previous = activeVersion("previous", "Previous Year", "year-previous");
    const baseline = activeVersion("baseline", "Baseline", null);
    const form = { ...forms[0], activeVersions: [previous, baseline] };

    expect(selectMonitorDisplayVersion(form, academicYears)?.id).toBe("baseline");
  });

  it("uses the first active fallback only without an exact or baseline revision", () => {
    const fallback = activeVersion("fallback", "Most Recent Active", "year-previous");
    const form = {
      ...forms[0],
      activeVersions: [
        { ...draftVersion, id: "archived", status: "archived" as const },
        draftVersion,
        fallback,
      ],
    };

    expect(selectMonitorDisplayVersion(form, [])?.id).toBe("fallback");
  });

  it("returns null when no active revision exists", () => {
    const form = {
      ...forms[0],
      activeVersions: [
        draftVersion,
        { ...draftVersion, id: "archived", status: "archived" as const },
      ],
    };

    expect(selectMonitorDisplayVersion(form, academicYears)).toBeNull();
  });
});

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
    vi.mocked(mutateFmQadVersion).mockResolvedValue({} as never);
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

  it("uses the requested heading, accessible close name, and non-wrapping table layout", async () => {
    const onClose = vi.fn();
    render(<MonitorFmQadTemplateManager onClose={onClose} />);

    expect(await screen.findByRole("heading", { name: "Template Management" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "FM-QAD Template Management" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Code" }).className).toContain("whitespace-nowrap");
    expect(screen.getByRole("columnheader", { name: "Form name" }).className).toContain("min-w-72");
    expect(screen.getByText("FM-QAD-001").closest("td")?.className).toContain("whitespace-nowrap");
    expect(screen.getByText("FM-QAD-001").closest(".overflow-x-auto")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Manage" })[0].closest("div")?.className).toContain("min-w-max");

    fireEvent.click(screen.getByRole("button", { name: "Close Template Management" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders a semantic loading row instead of a blank table body", () => {
    vi.mocked(fetchMonitorFmQadForms).mockReturnValue(new Promise(() => undefined));

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);

    expect(screen.getByText("Loading FM-QAD forms").closest("td")?.getAttribute("colspan")).toBe("8");
    expect(screen.getByRole("columnheader", { name: "Code" })).toBeTruthy();
  });

  it("shows uninitialized catalog guidance and retries successfully", async () => {
    vi.mocked(fetchMonitorFmQadForms)
      .mockResolvedValueOnce({
        data: [],
        academicYears: [],
        meta: {
          configuredFormCount: 10,
          catalogCount: 0,
          enabledCatalogCount: 0,
          initializationRequired: true,
          missingScopeIds: forms.map((form) => form.scopeId),
        },
      })
      .mockResolvedValueOnce({ data: forms, academicYears: [] });

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);

    expect(await screen.findByText("No FM-QAD forms are configured.")).toBeTruthy();
    expect(screen.getByText(/Expected permanent forms: 10. Missing: 10./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry catalog request" }));
    expect(await screen.findByText("FM-QAD-001")).toBeTruthy();
    expect(fetchMonitorFmQadForms).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a valid legacy empty response from initialization failure", async () => {
    vi.mocked(fetchMonitorFmQadForms).mockResolvedValue({ data: [], academicYears: [] });

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);

    expect(await screen.findByText("No FM-QAD forms are available.")).toBeTruthy();
    expect(screen.queryByText(/has not been initialized/i)).toBeNull();
  });

  it("renders available rows with a partial-catalog warning", async () => {
    vi.mocked(fetchMonitorFmQadForms).mockResolvedValue({
      data: forms.slice(0, 7),
      academicYears: [],
      meta: {
        configuredFormCount: 10,
        catalogCount: 7,
        enabledCatalogCount: 7,
        initializationRequired: true,
        missingScopeIds: ["fm_qad_011", "fm_qad_034", "fm_qad_041"],
      },
    });

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);

    expect(await screen.findByText("The FM-QAD catalog is incomplete.")).toBeTruthy();
    expect(screen.getByText("7 of 10 permanent forms are configured.")).toBeTruthy();
    expect(screen.getByText("FM-QAD-001")).toBeTruthy();
    expect(screen.queryByText("FM-QAD-041")).toBeNull();
  });

  it("renders all forms without versions and labels their active state clearly", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);

    await screen.findByText("FM-QAD-001");
    expect(screen.getAllByText("Not configured")).toHaveLength(10);
    expect(screen.getAllByText("No active revision")).toHaveLength(10);
    expect(screen.getAllByRole("button", { name: "Manage" })).toHaveLength(10);
  });

  it("explains forms with no revisions while keeping upload available", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");

    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);

    expect(await screen.findByText("No template revisions have been uploaded for this form.")).toBeTruthy();
    expect(screen.getByText(/Upload an official DOCX revision/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Upload New Version/i })).toBeTruthy();
  });

  it("explains forms whose existing revisions are inactive", async () => {
    vi.mocked(fetchFmQadVersions).mockResolvedValue([draftVersion]);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");

    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);

    expect(await screen.findByText("Template revisions exist, but none is active.")).toBeTruthy();
    expect(screen.getByText(/Activate a draft or archived revision/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Activate" })).toBeTruthy();
  });

  it("renders the current-year active revision instead of the first active response row", async () => {
    const baseline = activeVersion("baseline", "Baseline Revision", null);
    const exact = activeVersion("exact", "Current Year Revision", "year-1");
    vi.mocked(fetchMonitorFmQadForms).mockResolvedValue({
      data: [{ ...forms[0], activeVersions: [baseline, exact] }],
      academicYears: [{ id: "year-1", name: "20262027", isCurrent: true }],
    });

    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);

    expect(await screen.findByText("Current Year Revision")).toBeTruthy();
    expect(screen.queryByText("Baseline Revision")).toBeNull();
    expect(screen.getByText("Active")).toBeTruthy();
  });

  it("shows request and deployment mismatch errors with retry actions", async () => {
    vi.mocked(fetchMonitorFmQadForms).mockRejectedValueOnce(new Error("The FM-QAD catalog response is invalid."));
    const { unmount } = render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("catalog response is invalid");
    expect(screen.getByRole("button", { name: "Retry catalog request" })).toBeTruthy();
    expect(screen.queryByText("No FM-QAD forms are available.")).toBeNull();
    unmount();

    vi.mocked(fetchMonitorFmQadForms).mockRejectedValueOnce(
      new ApiError("Request failed with status 404.", 404, null),
    );
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("backend deployment may be outdated");
  });

  it("uploads a required DOCX revision as a draft", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Upload New Version/i }));
    fireEvent.change(screen.getByLabelText("Revision Label"), { target: { value: "Rev. 03" } });
    fireEvent.change(screen.getByLabelText("Effective period"), { target: { value: "year-1" } });
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

  it("requires a deliberate effective period and resets it when reopened", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Upload New Version/i }));

    const period = screen.getByLabelText("Effective period") as HTMLSelectElement;
    expect(period.options[0].textContent).toBe("Select effective period");
    expect(period.options[1].textContent).toContain("Baseline");
    expect(period.options[1].textContent).toContain("no Academic-Year-specific revision exists");
    expect(period.value).toBe("");
    fireEvent.change(screen.getByLabelText("Revision Label"), { target: { value: "Baseline Rev." } });
    fireEvent.change(screen.getByLabelText("Change Notes"), { target: { value: "Baseline coverage" } });
    const file = new File(["docx"], "baseline.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(screen.getByLabelText("Template File"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Select Baseline or an Academic Year.")).toBeTruthy();
    expect(uploadFmQadVersion).not.toHaveBeenCalled();
    fireEvent.change(period, { target: { value: "__baseline__" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => expect(uploadFmQadVersion).toHaveBeenCalledWith(
      "monitor-token",
      "form-1",
      expect.objectContaining({
        revisionLabel: "Baseline Rev.",
        academicYearId: null,
        file,
        activate: false,
      }),
    ));
    fireEvent.click(screen.getByRole("button", { name: /Upload New Version/i }));
    expect((screen.getByLabelText("Effective period") as HTMLSelectElement).value).toBe("");
  });

  it("uses baseline-specific activation confirmation and sends null", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Upload New Version/i }));
    fireEvent.change(screen.getByLabelText("Revision Label"), { target: { value: "Rev. 04" } });
    fireEvent.change(screen.getByLabelText("Effective period"), { target: { value: "__baseline__" } });
    fireEvent.change(screen.getByLabelText("Change Notes"), { target: { value: "Baseline activation" } });
    fireEvent.change(screen.getByLabelText("Template File"), { target: { files: [new File(["docx"], "baseline.docx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and Activate" }));

    await waitFor(() => expect(uploadFmQadVersion).toHaveBeenCalledWith(
      "monitor-token",
      "form-1",
      expect.objectContaining({ academicYearId: null, activate: true }),
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("as the baseline template"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("only when no Academic-Year-specific active revision exists"));
    confirm.mockRestore();
  });

  it("keeps the Academic-Year-specific activation confirmation and payload", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Upload New Version/i }));
    fireEvent.change(screen.getByLabelText("Revision Label"), { target: { value: "Rev. 05" } });
    fireEvent.change(screen.getByLabelText("Effective period"), { target: { value: "year-1" } });
    fireEvent.change(screen.getByLabelText("Change Notes"), { target: { value: "Year activation" } });
    fireEvent.change(screen.getByLabelText("Template File"), { target: { files: [new File(["docx"], "year.docx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and Activate" }));

    await waitFor(() => expect(uploadFmQadVersion).toHaveBeenCalledWith(
      "monitor-token",
      "form-1",
      expect.objectContaining({ academicYearId: "year-1", activate: true }),
    ));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("selected Academic Year"));
    confirm.mockRestore();
  });

  it("uses baseline wording for an existing baseline draft and honors cancellation", async () => {
    vi.mocked(fetchFmQadVersions).mockResolvedValue([{
      ...draftVersion,
      id: "baseline-draft",
      academicYearId: null,
      academicYearLabel: null,
    }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /Edit Details/i }));
    expect((screen.getByLabelText("Edit Effective Academic Year") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const activate = await screen.findByRole("button", { name: "Activate" });

    fireEvent.click(activate);
    expect(mutateFmQadVersion).not.toHaveBeenCalled();
    expect(confirm.mock.calls[0][0]).toContain("as the baseline template");
    expect(confirm.mock.calls[0][0]).toContain("only when no Academic-Year-specific active revision exists");
    expect(confirm.mock.calls[0][0]).not.toContain("for this Academic Year");

    fireEvent.click(activate);
    await waitFor(() => expect(mutateFmQadVersion).toHaveBeenCalledWith("monitor-token", "baseline-draft", "activate"));
    await waitFor(() => expect(fetchMonitorFmQadForms).toHaveBeenCalledTimes(2));
    confirm.mockRestore();
  });

  it("uses Academic-Year wording for an existing year-specific draft", async () => {
    vi.mocked(fetchFmQadVersions).mockResolvedValue([draftVersion]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    await screen.findByText("FM-QAD-001");
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Activate" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("selected Academic Year"));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("for that Academic Year"));
    expect(mutateFmQadVersion).not.toHaveBeenCalled();
    confirm.mockRestore();
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
    fireEvent.click(screen.getByRole("button", { name: "Close Template Management" }));
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
