import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMonitorUiRefresh } from "@/pages/monitor/useMonitorUiRefresh";

const UI_REFRESH_DEBOUNCE_MS = 120;

function dispatchRealtimeUpdate(detail: {
  entity?: string;
  eventType?: string;
  submissionId?: string;
  schoolId?: string;
  schoolCode?: string;
  academicYearId?: string;
  touchedScopes?: string[];
}) {
  window.dispatchEvent(new CustomEvent("cspams:update", { detail }));
}

describe("useMonitorUiRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("increments student lookup and radar ticks for student updates", () => {
    const { result } = renderHook(() => useMonitorUiRefresh());

    act(() => {
      dispatchRealtimeUpdate({ entity: "students", schoolId: "42", schoolCode: "sch-001" });
      vi.advanceTimersByTime(UI_REFRESH_DEBOUNCE_MS);
    });

    expect(result.current.studentLookupTick).toBe(1);
    expect(result.current.teacherLookupTick).toBe(0);
    expect(result.current.radarTotalsTick).toBe(1);
    expect(result.current.latestRealtimeBatch).toMatchObject({
      entities: ["students"],
      schoolIds: ["42"],
      schoolCodes: ["SCH-001"],
      updates: [
        {
          entity: "students",
          eventType: "",
          submissionId: "",
          schoolId: "42",
          schoolCode: "SCH-001",
          academicYearId: "",
          touchedScopes: [],
        },
      ],
    });
    expect(result.current.latestRealtimeBatch?.occurredAt).toEqual(expect.any(Number));
  });

  it("increments teacher lookup and radar ticks for teacher updates", () => {
    const { result } = renderHook(() => useMonitorUiRefresh());

    act(() => {
      dispatchRealtimeUpdate({ entity: "teachers", schoolId: "88", schoolCode: "T-900" });
      vi.advanceTimersByTime(UI_REFRESH_DEBOUNCE_MS);
    });

    expect(result.current.studentLookupTick).toBe(0);
    expect(result.current.teacherLookupTick).toBe(1);
    expect(result.current.radarTotalsTick).toBe(1);
    expect(result.current.latestRealtimeBatch).toMatchObject({
      entities: ["teachers"],
      schoolIds: ["88"],
      schoolCodes: ["T-900"],
    });
  });

  it("preserves batch metadata for non-lookup entities without incrementing ticks", () => {
    const { result } = renderHook(() => useMonitorUiRefresh());

    act(() => {
      dispatchRealtimeUpdate({ entity: "school_records", schoolId: "7", schoolCode: "REC-007" });
      dispatchRealtimeUpdate({ entity: "dashboard", schoolId: "", schoolCode: "" });
      vi.advanceTimersByTime(UI_REFRESH_DEBOUNCE_MS);
    });

    expect(result.current.studentLookupTick).toBe(0);
    expect(result.current.teacherLookupTick).toBe(0);
    expect(result.current.radarTotalsTick).toBe(0);
    expect(result.current.latestRealtimeBatch).toMatchObject({
      entities: ["school_records", "dashboard"],
      schoolIds: ["7"],
      schoolCodes: ["REC-007"],
      updates: [
        {
          entity: "school_records",
          eventType: "",
          submissionId: "",
          schoolId: "7",
          schoolCode: "REC-007",
          academicYearId: "",
          touchedScopes: [],
        },
        {
          entity: "dashboard",
          eventType: "",
          submissionId: "",
          schoolId: "",
          schoolCode: "",
          academicYearId: "",
          touchedScopes: [],
        },
      ],
    });
  });

  it("preserves indicator submission metadata for monitor drawer refreshes", () => {
    const { result } = renderHook(() => useMonitorUiRefresh());

    act(() => {
      dispatchRealtimeUpdate({
        entity: "indicators",
        eventType: "indicators.scopes_submitted",
        submissionId: "submission-77",
        schoolId: "12",
        schoolCode: "401777",
        academicYearId: "ay-2025",
        touchedScopes: ["fm_qad_001"],
      });
      vi.advanceTimersByTime(UI_REFRESH_DEBOUNCE_MS);
    });

    expect(result.current.latestRealtimeBatch).toMatchObject({
      entities: ["indicators"],
      schoolIds: ["12"],
      schoolCodes: ["401777"],
      updates: [
        {
          entity: "indicators",
          eventType: "indicators.scopes_submitted",
          submissionId: "submission-77",
          schoolId: "12",
          schoolCode: "401777",
          academicYearId: "ay-2025",
          touchedScopes: ["fm_qad_001"],
        },
      ],
    });
  });
});
