import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSyncedCountsRefreshOutcome,
  buildSyncedCountsUnavailableMessage,
  deriveAvailableSchoolDrawerYears,
  isFreshSchoolDetailCountsCacheEntry,
  isMissingSchoolRecordError,
  matchesDrawerSchool,
  shouldForceSchoolSubmissionReload,
  useSchoolDrawer,
} from "@/pages/monitor/useSchoolDrawer";

describe("useSchoolDrawer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("matches monitor realtime updates by either strict school code or strict record id", () => {
    expect(matchesDrawerSchool("school-1", "401777", "school-1", "")).toBe(true);
    expect(matchesDrawerSchool("other-school", "401777", "school-1", "401777")).toBe(true);
    expect(matchesDrawerSchool("other-school", "DIFFERENT", "school-1", "401777")).toBe(false);
  });

  it("recognizes the archived school record error without surfacing it as a generic failure", () => {
    expect(
      isMissingSchoolRecordError(new Error("School record not found. It may have been archived or permanently deleted.")),
    ).toBe(true);
    expect(isMissingSchoolRecordError(new Error("Server Error"))).toBe(false);
  });

  it("builds the synced-count fallback warning per failed source", () => {
    expect(buildSyncedCountsUnavailableMessage(true, true)).toBe(
      "Unable to refresh synced student and teacher totals right now. Showing last available counts.",
    );
    expect(buildSyncedCountsUnavailableMessage(true, false)).toBe(
      "Unable to refresh synced student totals right now. Showing last available counts.",
    );
    expect(buildSyncedCountsUnavailableMessage(false, true)).toBe(
      "Unable to refresh synced teacher totals right now. Showing last available counts.",
    );
  });

  it("treats cached synced counts as stale only after the TTL window", () => {
    expect(
      isFreshSchoolDetailCountsCacheEntry({ students: 10, teachers: 2, fetchedAt: 1000 }, 1000 + 45_000),
    ).toBe(true);
    expect(
      isFreshSchoolDetailCountsCacheEntry({ students: 10, teachers: 2, fetchedAt: 1000 }, 1000 + 45_001),
    ).toBe(false);
  });

  it("builds partial synced-count refresh outcomes without dropping last known values", () => {
    const outcome = buildSyncedCountsRefreshOutcome(
      {
        status: "fulfilled",
        value: { data: [], meta: { total: 12, recordCount: 12 } },
      },
      {
        status: "rejected",
        reason: new Error("Server Error"),
      },
      { students: 9, teachers: 3 },
    );

    expect(outcome.nextCounts).toEqual({ students: 12, teachers: 3 });
    expect(outcome.error).toBe(
      "Unable to refresh synced teacher totals right now. Showing last available counts.",
    );
  });

  it("closes the stale drawer when the selected school has already been archived or deleted", async () => {
    const listSubmissionsForSchool = vi
      .fn()
      .mockRejectedValue(new Error("School record not found. It may have been archived or permanently deleted."));
    const queryStudents = vi.fn();
    const listTeachers = vi.fn();

    const { result } = renderHook(() =>
      useSchoolDrawer({
        authSessionKey: "monitor:1",
        isAuthenticated: true,
        latestRealtimeBatch: null,
        resolveRecordId: (schoolKey) => (schoolKey ? "school-record-1" : ""),
        resolveSchoolCode: () => "",
        listSubmissionsForSchool,
        queryStudents,
        listTeachers,
      }),
    );

    await act(async () => {
      result.current.openSchoolDrawer("school-1");
    });

    await waitFor(() => {
      expect(result.current.schoolDrawerKey).toBeNull();
    });

    expect(result.current.schoolDrawerSubmissionsError).toBe("");
    expect(listSubmissionsForSchool).toHaveBeenCalledWith(
      "school-record-1",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("derives available drawer years from the monitor-visible year window", () => {
    expect(deriveAvailableSchoolDrawerYears([
      {
        id: "sub-1",
        academicYear: { id: "1", name: "2024-2025" },
        submittedAt: null,
        updatedAt: null,
        createdAt: null,
      },
      {
        id: "sub-2",
        academicYear: { id: "2", name: "2025-2026" },
        submittedAt: null,
        updatedAt: null,
        createdAt: null,
      },
    ] as never)).toEqual(["2025-2026", "2026-2027", "2027-2028", "2028-2029", "2029-2030"]);
  });

  it("opens the drawer on the submissions tab by default", () => {
    const listSubmissionsForSchool = vi.fn();
    const queryStudents = vi.fn();
    const listTeachers = vi.fn();

    const { result } = renderHook(() =>
      useSchoolDrawer({
        authSessionKey: "monitor:1",
        isAuthenticated: true,
        latestRealtimeBatch: null,
        resolveRecordId: () => "",
        resolveSchoolCode: () => "",
        listSubmissionsForSchool,
        queryStudents,
        listTeachers,
      }),
    );

    act(() => {
      result.current.openSchoolDrawer("school-1");
    });

    expect(result.current.activeSchoolDrawerTab).toBe("submissions");
  });

  it("forces school submission reloads after realtime refresh ticks", () => {
    expect(shouldForceSchoolSubmissionReload(0)).toBe(false);
    expect(shouldForceSchoolSubmissionReload(1)).toBe(true);
  });
});
