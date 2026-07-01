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
  const setActiveTopNavigator = vi.fn();
  const openSchoolDrawer = vi.fn();

  const { result } = renderHook(() => useMonitorSchoolActionRouter({
    scopedRecordBySchoolKey: recordMap,
    recordBySchoolKey: recordMap,
    schoolRequirementByKey: new Map(),
    setActiveTopNavigator,
    openSchoolDrawer,
    pushToast,
    sendReminder,
  }));

  return { result, pushToast, sendReminder, setActiveTopNavigator, openSchoolDrawer, record };
}

describe("useMonitorSchoolActionRouter", () => {
  it("shows dashboard sent and email queued reminder feedback", async () => {
    const sendReminder = vi.fn().mockResolvedValue({
      schoolId: "401777",
      schoolName: "AMA Computer College - Santiago",
      recipientCount: 1,
      recipientEmails: ["head@example.com"],
      remindedAt: "2026-06-30T00:00:00.000Z",
      deliveryMode: "queued",
      deliveryStatus: "queued",
      dashboardStatus: "sent",
      emailStatus: "queued",
    });
    const { result, pushToast } = makeRouter(sendReminder);

    await act(async () => {
      await result.current.handleSendReminder({
        schoolKey: "401777",
        schoolName: "AMA Computer College - Santiago",
      });
    });

    expect(pushToast).toHaveBeenCalledWith("Dashboard reminder sent to AMA Computer College - Santiago. Email queued.", "success");
    expect(result.current.remindingSchoolKey).toBeNull();
  });

  it("shows warning when dashboard reminder succeeds but email fails", async () => {
    const sendReminder = vi.fn().mockResolvedValue({
      schoolId: "401777",
      schoolName: "AMA Computer College - Santiago",
      recipientCount: 1,
      recipientEmails: ["head@example.com"],
      remindedAt: "2026-06-30T00:00:00.000Z",
      deliveryMode: "sync",
      deliveryStatus: "partial",
      dashboardStatus: "sent",
      emailStatus: "failed",
    });
    const { result, pushToast } = makeRouter(sendReminder);

    await act(async () => {
      await result.current.handleSendReminder({
        schoolKey: "401777",
        schoolName: "AMA Computer College - Santiago",
      });
    });

    expect(pushToast).toHaveBeenCalledWith("Dashboard reminder sent to AMA Computer College - Santiago, but email delivery failed.", "warning");
    expect(result.current.remindingSchoolKey).toBeNull();
  });

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
    expect(result.current.remindingSchoolKey).toBeNull();
  });

  it("opens account-management school records under Reviews without scrolling to Schools", () => {
    const { result, setActiveTopNavigator, openSchoolDrawer, pushToast, record } = makeRouter();

    act(() => {
      result.current.handleOpenSchoolRecord(record);
    });

    expect(setActiveTopNavigator).toHaveBeenCalledWith("reviews");
    expect(openSchoolDrawer).toHaveBeenCalledWith("code:401777");
    expect(pushToast).toHaveBeenCalledWith("Opened school details for AMA Computer College - Santiago.", "info");
  });
});
