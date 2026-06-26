import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IndicatorSubmission } from "@/types";
import {
  buildSyncedCountsRefreshOutcome,
  buildSyncedCountsUnavailableMessage,
  deriveAvailableSchoolDrawerYears,
  isFreshSchoolDetailCountsCacheEntry,
  isMissingSchoolRecordError,
  matchesDrawerSchool,
  matchesDrawerSubmission,
  mergeLatestSchoolDrawerSubmission,
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

  it("matches monitor realtime updates by the active drawer submission id", () => {
    expect(matchesDrawerSubmission("submission-1", "submission-1", new Set())).toBe(true);
    expect(matchesDrawerSubmission("submission-2", "", new Set(["submission-2"]))).toBe(true);
    expect(matchesDrawerSubmission("submission-3", "submission-1", new Set(["submission-2"]))).toBe(false);
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
    const fetchSubmission = vi.fn();
    const queryStudents = vi.fn();
    const listTeachers = vi.fn();

    const { result } = renderHook(() =>
      useSchoolDrawer({
        authSessionKey: "monitor:1",
        isAuthenticated: true,
        latestRealtimeBatch: null,
        resolveRecordId: (schoolKey) => (schoolKey ? "school-record-1" : ""),
        resolveSchoolCode: () => "",
        resolveLatestIndicatorSubmissionId: () => "",
        fetchSubmission,
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

  it("derives available drawer years from submission academic-year ids", () => {
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
    ] as never)).toEqual([
      { id: "2", label: "2025-2026" },
      { id: "1", label: "2024-2025" },
    ]);
  });

  it("opens the drawer on the submissions tab by default", () => {
    const listSubmissionsForSchool = vi.fn();
    const fetchSubmission = vi.fn();
    const queryStudents = vi.fn();
    const listTeachers = vi.fn();

    const { result } = renderHook(() =>
      useSchoolDrawer({
        authSessionKey: "monitor:1",
        isAuthenticated: true,
        latestRealtimeBatch: null,
        resolveRecordId: () => "",
        resolveSchoolCode: () => "",
        resolveLatestIndicatorSubmissionId: () => "",
        fetchSubmission,
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

  it("loads drawer submissions by school code when the school record id is not available yet", async () => {
    const listSubmissionsForSchool = vi.fn().mockResolvedValue([]);
    const fetchSubmission = vi.fn();
    const queryStudents = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });
    const listTeachers = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });

    const { result } = renderHook(() =>
      useSchoolDrawer({
        authSessionKey: "monitor:1",
        isAuthenticated: true,
        latestRealtimeBatch: null,
        resolveRecordId: () => "",
        resolveSchoolCode: () => "401777",
        resolveLatestIndicatorSubmissionId: () => "",
        fetchSubmission,
        listSubmissionsForSchool,
        queryStudents,
        listTeachers,
      }),
    );

    act(() => {
      result.current.openSchoolDrawer("school-1");
    });

    await waitFor(() => {
      expect(listSubmissionsForSchool).toHaveBeenCalledWith(
        "401777",
        expect.objectContaining({
          schoolCode: "401777",
          signal: expect.any(AbortSignal),
        }),
      );
    });
  });

  it("forces school submission reloads after realtime refresh ticks", () => {
    expect(shouldForceSchoolSubmissionReload(0)).toBe(false);
    expect(shouldForceSchoolSubmissionReload(1)).toBe(true);
  });

  it("hydrates latest drawer detail and still loads the full school submission list", async () => {
    const latestSubmission = {
      id: "submission-latest",
      status: "draft",
      school: { schoolCode: "401777" },
      academicYear: { id: "ay-1", name: "2025-2026" },
      submittedAt: null,
      updatedAt: "2026-06-14T06:39:00.000Z",
      createdAt: "2026-06-14T06:39:00.000Z",
    } as unknown as IndicatorSubmission;
    const listSubmissionsForSchool = vi.fn().mockResolvedValue([]);
    const fetchSubmission = vi.fn().mockResolvedValue(latestSubmission);
    const queryStudents = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });
    const listTeachers = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });

    const { result } = renderHook(() =>
      useSchoolDrawer({
        authSessionKey: "monitor:1",
        isAuthenticated: true,
        latestRealtimeBatch: null,
        resolveRecordId: () => "",
        resolveSchoolCode: () => "401777",
        resolveLatestIndicatorSubmissionId: () => "submission-latest",
        fetchSubmission,
        listSubmissionsForSchool,
        queryStudents,
        listTeachers,
      }),
    );

    act(() => {
      result.current.openSchoolDrawer("school-1");
    });

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("submission-latest");
      expect(result.current.schoolDrawerSubmissions).toEqual([latestSubmission]);
      expect(result.current.selectedSchoolDrawerYear).toBe("ay-1");
      expect(result.current.isSchoolDrawerSubmissionsLoading).toBe(false);
    });

    expect(listSubmissionsForSchool).toHaveBeenCalledWith(
      "401777",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("hydrates a matching sent-scope realtime submission before stale list rows", async () => {
    const realtimeSubmission = {
      id: "submission-sent",
      status: "draft",
      school: { schoolCode: "401777" },
      academicYear: { id: "ay-1", name: "2025-2026" },
      scopeProgress: { submittedScopeIds: ["fm_qad_001"] },
      files: {
        fm_qad_001: {
          type: "fm_qad_001",
          uploaded: true,
          originalFilename: "Profile-1.pdf",
        },
      },
      submittedAt: null,
      updatedAt: "2026-06-14T06:39:00.000Z",
      createdAt: "2026-06-14T06:39:00.000Z",
    } as unknown as IndicatorSubmission;
    const staleListRow = {
      id: "submission-sent",
      status: "draft",
      school: { schoolCode: "401777" },
      academicYear: { id: "ay-1", name: "2025-2026" },
      scopeProgress: { submittedScopeIds: [] },
      files: {},
      submittedAt: null,
      updatedAt: "2026-06-14T06:30:00.000Z",
      createdAt: "2026-06-14T06:30:00.000Z",
    } as unknown as IndicatorSubmission;
    const listSubmissionsForSchool = vi.fn().mockResolvedValue([staleListRow]);
    const fetchSubmission = vi.fn().mockResolvedValue(realtimeSubmission);
    const queryStudents = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });
    const listTeachers = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });

    const { result, rerender } = renderHook(
      ({ latestRealtimeBatch }) =>
        useSchoolDrawer({
          authSessionKey: "monitor:1",
          isAuthenticated: true,
          latestRealtimeBatch,
          resolveRecordId: () => "",
          resolveSchoolCode: () => "401777",
          resolveLatestIndicatorSubmissionId: () => "",
          fetchSubmission,
          listSubmissionsForSchool,
          queryStudents,
          listTeachers,
        }),
      {
        initialProps: { latestRealtimeBatch: null as Parameters<typeof useSchoolDrawer>[0]["latestRealtimeBatch"] },
      },
    );

    act(() => {
      result.current.openSchoolDrawer("school-1");
    });

    await waitFor(() => {
      expect(listSubmissionsForSchool).toHaveBeenCalled();
    });

    rerender({
      latestRealtimeBatch: {
        updates: [
          {
            entity: "indicators",
            eventType: "indicators.scopes_submitted",
            submissionId: "submission-sent",
            schoolId: "12",
            schoolCode: "401777",
            academicYearId: "ay-1",
            touchedScopes: ["fm_qad_001"],
          },
        ],
        entities: ["indicators"],
        schoolIds: ["12"],
        schoolCodes: ["401777"],
        occurredAt: Date.now(),
      },
    });

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("submission-sent");
      expect(result.current.schoolDrawerSubmissions[0]).toEqual(realtimeSubmission);
    });
  });

  it("hydrates an open drawer after a scope unverified realtime event", async () => {
    const realtimeSubmission = {
      id: "submission-sent",
      status: "draft",
      school: { schoolCode: "401777" },
      academicYear: { id: "ay-1", name: "2025-2026" },
      scopeReviews: [{ scopeId: "fm_qad_001", decision: "unverified" }],
    } as unknown as IndicatorSubmission;
    const listSubmissionsForSchool = vi.fn().mockResolvedValue([]);
    const fetchSubmission = vi.fn().mockResolvedValue(realtimeSubmission);
    const queryStudents = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });
    const listTeachers = vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } });

    const { result, rerender } = renderHook(
      ({ latestRealtimeBatch }) =>
        useSchoolDrawer({
          authSessionKey: "monitor:1",
          isAuthenticated: true,
          latestRealtimeBatch,
          resolveRecordId: () => "",
          resolveSchoolCode: () => "401777",
          resolveLatestIndicatorSubmissionId: () => "",
          fetchSubmission,
          listSubmissionsForSchool,
          queryStudents,
          listTeachers,
        }),
      {
        initialProps: { latestRealtimeBatch: null as Parameters<typeof useSchoolDrawer>[0]["latestRealtimeBatch"] },
      },
    );

    act(() => {
      result.current.openSchoolDrawer("school-1");
    });

    rerender({
      latestRealtimeBatch: {
        updates: [
          {
            entity: "indicators",
            eventType: "indicators.scope_unverified",
            submissionId: "submission-sent",
            schoolId: "12",
            schoolCode: "401777",
            academicYearId: "ay-1",
            touchedScopes: ["fm_qad_001"],
          },
        ],
        entities: ["indicators"],
        schoolIds: ["12"],
        schoolCodes: ["401777"],
        occurredAt: Date.now(),
      },
    });

    await waitFor(() => {
      expect(fetchSubmission).toHaveBeenCalledWith("submission-sent");
      expect(result.current.schoolDrawerSubmissions[0]).toEqual(realtimeSubmission);
    });
  });

  it("merges latest drawer detail ahead of duplicate list rows", () => {
    const latestSubmission = { id: "submission-latest" } as IndicatorSubmission;
    const listRows = [
      { id: "submission-older" },
      { id: "submission-latest" },
    ] as IndicatorSubmission[];

    expect(mergeLatestSchoolDrawerSubmission(latestSubmission, listRows).map((submission) => submission.id)).toEqual([
      "submission-latest",
      "submission-older",
    ]);
  });
});
