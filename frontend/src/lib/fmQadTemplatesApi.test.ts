import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest } from "@/lib/api";
import {
  fetchMonitorFmQadForms,
  parseMonitorFmQadCatalog,
  uploadFmQadVersion,
} from "@/lib/fmQadTemplatesApi";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

const form = {
  id: "1",
  scopeId: "fm_qad_001",
  code: "FM-QAD-001",
  name: "Form 1",
  activeVersions: [],
};

describe("FM-QAD Monitor catalog API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a valid catalog and optional initialization metadata", () => {
    expect(parseMonitorFmQadCatalog({
      data: [form],
      academicYears: [{ id: "1", name: "20262027", isCurrent: true }],
      meta: {
        configuredFormCount: 10,
        catalogCount: 1,
        enabledCatalogCount: 1,
        initializationRequired: true,
        missingScopeIds: ["fm_qad_002"],
      },
    })).toEqual({
      data: [form],
      academicYears: [{ id: "1", name: "20262027", isCurrent: true }],
      meta: {
        configuredFormCount: 10,
        catalogCount: 1,
        enabledCatalogCount: 1,
        initializationRequired: true,
        missingScopeIds: ["fm_qad_002"],
      },
    });
  });

  it("accepts valid empty and legacy responses without optional metadata", () => {
    expect(parseMonitorFmQadCatalog({ data: [], academicYears: [] })).toEqual({
      data: [],
      academicYears: [],
      meta: undefined,
    });
    expect(parseMonitorFmQadCatalog({ data: [] })).toEqual({
      data: [],
      academicYears: [],
      meta: undefined,
    });
  });

  it.each([
    [null, "catalog response is invalid"],
    [{ academicYears: [] }, "does not contain a valid form list"],
    [{ data: "invalid" }, "does not contain a valid form list"],
    [{ data: [{}] }, "contains an invalid form entry"],
    [{ data: [], academicYears: {} }, "Academic Year response is invalid"],
    [{ data: [], meta: {} }, "metadata response is invalid"],
  ])("rejects malformed catalog payload %#", (payload, message) => {
    expect(() => parseMonitorFmQadCatalog(payload)).toThrow(message);
  });

  it("validates the payload returned by the request helper", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: [form], academicYears: [] });

    await expect(fetchMonitorFmQadForms("monitor-token")).resolves.toEqual({
      data: [form],
      academicYears: [],
      meta: undefined,
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/monitor/fm-qad/forms",
      { token: "monitor-token", signal: undefined },
    );
  });

  it.each([401, 403, 404, 500])("preserves HTTP %s errors", async (status) => {
    const error = new ApiError(`HTTP ${status}`, status, null);
    vi.mocked(apiRequest).mockRejectedValue(error);

    await expect(fetchMonitorFmQadForms("monitor-token")).rejects.toBe(error);
  });

  it("preserves AbortError for component cancellation handling", async () => {
    const error = new DOMException("Aborted", "AbortError");
    vi.mocked(apiRequest).mockRejectedValue(error);

    await expect(fetchMonitorFmQadForms("monitor-token")).rejects.toBe(error);
  });

  it("omits Academic Year for baseline uploads and includes a selected year", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: {} });
    const file = new File(["docx"], "template.docx");

    await uploadFmQadVersion("monitor-token", "form-1", {
      revisionLabel: "Baseline",
      academicYearId: null,
      changeNotes: "Baseline notes",
      file,
      activate: false,
    });
    const baselineBody = vi.mocked(apiRequest).mock.calls[0][1]?.body as FormData;
    expect(baselineBody.has("academicYearId")).toBe(false);

    await uploadFmQadVersion("monitor-token", "form-1", {
      revisionLabel: "Year-specific",
      academicYearId: "year-1",
      changeNotes: "Year notes",
      file,
      activate: true,
    });
    const yearBody = vi.mocked(apiRequest).mock.calls[1][1]?.body as FormData;
    expect(yearBody.get("academicYearId")).toBe("year-1");
  });
});
