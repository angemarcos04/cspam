import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorFmQadTemplateManager } from "@/pages/monitor/MonitorFmQadTemplateManager";
import {
  fetchFmQadVersions,
  fetchMonitorFmQadForms,
  uploadFmQadVersion,
} from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm } from "@/types/fmQadTemplates";

vi.mock("@/context/Auth", () => ({ useAuth: () => ({ apiToken: "monitor-token" }) }));
vi.mock("@/lib/fmQadTemplatesApi", () => ({
  fetchMonitorFmQadForms: vi.fn(),
  fetchFmQadVersions: vi.fn(),
  uploadFmQadVersion: vi.fn(),
  mutateFmQadVersion: vi.fn(),
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

describe("MonitorFmQadTemplateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMonitorFmQadForms).mockResolvedValue({
      data: forms,
      academicYears: [{ id: "year-1", name: "20262027", isCurrent: true }],
    });
    vi.mocked(fetchFmQadVersions).mockResolvedValue([]);
    vi.mocked(uploadFmQadVersion).mockResolvedValue({} as never);
  });

  it("lists the fixed catalog and opens version history", async () => {
    render(<MonitorFmQadTemplateManager onClose={vi.fn()} />);
    expect(await screen.findByText("FM-QAD-001")).toBeTruthy();
    expect(screen.getByText("FM-QAD-010")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Manage" })[0]);
    await waitFor(() => expect(fetchFmQadVersions).toHaveBeenCalledWith("monitor-token", "form-1"));
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
});
