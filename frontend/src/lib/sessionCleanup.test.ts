import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearClientSessionArtifacts } from "@/lib/sessionCleanup";

describe("clearClientSessionArtifacts", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes every FM-QAD grant and preserves unrelated storage", () => {
    sessionStorage.setItem("cspams:fm-qad-grant:user-1:school-1:year-1:fm_qad_001", "{}");
    sessionStorage.setItem("cspams:fm-qad-grant:user-1:school-1:year-1:fm_qad_003", "{}");
    sessionStorage.setItem("unrelated:key", "keep");

    clearClientSessionArtifacts();

    expect(sessionStorage.getItem("cspams:fm-qad-grant:user-1:school-1:year-1:fm_qad_001")).toBeNull();
    expect(sessionStorage.getItem("cspams:fm-qad-grant:user-1:school-1:year-1:fm_qad_003")).toBeNull();
    expect(sessionStorage.getItem("unrelated:key")).toBe("keep");
  });

  it("tolerates restricted browser storage", () => {
    const getter = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => clearClientSessionArtifacts()).not.toThrow();
    getter.mockRestore();
  });
});
