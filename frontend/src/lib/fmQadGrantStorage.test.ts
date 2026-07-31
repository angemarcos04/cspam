import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fmQadGrantStorageKey,
  readStoredFmQadGrants,
  removeStoredFmQadGrant,
  storeFmQadGrant,
} from "@/lib/fmQadGrantStorage";
import type { FmQadDownloadedVersionGrant } from "@/types/fmQadTemplates";

const scope = {
  userId: "user-1",
  schoolId: "school-1",
  academicYearId: "year-1",
  scopeId: "fm_qad_003",
};
const grant: FmQadDownloadedVersionGrant = {
  grantId: "grant-1",
  schoolId: scope.schoolId,
  academicYearId: scope.academicYearId,
  scopeId: scope.scopeId,
  versionId: "version-2",
  revisionLabel: "Rev. 02",
  downloadedAt: "2026-07-31T00:00:00Z",
};

describe("FM-QAD grant storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("keys grants by user, school, Academic Year, and scope", () => {
    expect(fmQadGrantStorageKey(scope)).toBe(
      "cspams:fm-qad-grant:user-1:school-1:year-1:fm_qad_003",
    );
  });

  it("stores, restores, replaces, and removes only the matching grant", () => {
    storeFmQadGrant(scope, grant);
    storeFmQadGrant({ ...scope, scopeId: "fm_qad_004" }, { ...grant, scopeId: "fm_qad_004", grantId: "grant-4" });
    storeFmQadGrant({ ...scope, academicYearId: "year-2" }, { ...grant, academicYearId: "year-2", grantId: "grant-year-2" });

    expect(readStoredFmQadGrants(scope).get("fm_qad_003")?.grantId).toBe("grant-1");
    expect(readStoredFmQadGrants({ ...scope, academicYearId: "year-2" }).get("fm_qad_003")?.grantId).toBe("grant-year-2");

    const replacement = { ...grant, grantId: "grant-2", versionId: "version-3", revisionLabel: "Rev. 03" };
    storeFmQadGrant(scope, replacement);
    expect(readStoredFmQadGrants(scope).get("fm_qad_003")?.grantId).toBe("grant-2");

    removeStoredFmQadGrant(scope);
    const remaining = readStoredFmQadGrants(scope);
    expect(remaining.has("fm_qad_003")).toBe(false);
    expect(remaining.get("fm_qad_004")?.grantId).toBe("grant-4");
  });

  it("tolerates unavailable storage", () => {
    const getter = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => storeFmQadGrant(scope, grant)).not.toThrow();
    expect(() => removeStoredFmQadGrant(scope)).not.toThrow();
    expect(readStoredFmQadGrants(scope).size).toBe(0);
    getter.mockRestore();
  });
});
