import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { useMonitorSchoolActionRouter } from "@/pages/monitor/useMonitorSchoolActionRouter";
import type { SchoolRecord } from "@/types";

function makeRouter(sendReminder = vi.fn()) {
  const record = {
    id: "school-record-1",
    schoolId: "401777",
    schoolCode: "401777",
    schoolName: "AMA Computer College - Santiago",
  } as SchoolRecord;
  const recordMap = new Map<string, SchoolRecord>([["401777", record]]);
  const pushToast = vi.fn();

  const { result } = renderHook(() => useMonitorSchoolActionRouter({
    scopedRecordBySchoolKey: recordMap,
    recordBySchoolKey: recordMap,
    schoolRequirementByKey: new Map(),
    setActiveTopNavigator: vi.fn(),
    openSchoolDrawer: vi.fn(),
    focusAndScrollTo: vi.fn(),
    pushToast,
    sendReminder,
  }));

  return { result, pushToast, sendReminder };
}

describe("useMonitorSchoolActionRouter", () => {
  it("shows safe service-unavailable copy when reminder delivery receives a raw 503 ApiError", async () => {
    const sendReminder = vi.fn().mockRejectedValue(
      new ApiError("Request failed with status 503.", 503, null),
    );
    const { result, pushToast } = makeRouter(sendReminder);

    await act(async () => {
      await result.current.handleSendReminder({
        schoolKey: "401777",
        schoolName: "AMA Computer College - Santiago",
      });
    });

    expect(pushToast).toHaveBeenCalledWith(SERVICE_UNAVAILABLE_MESSAGE, "warning");
    expect(pushToast).not.toHaveBeenCalledWith("Request failed with status 503.", "warning");
  });
});
