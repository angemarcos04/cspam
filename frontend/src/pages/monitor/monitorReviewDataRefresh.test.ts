import { describe, expect, it, vi } from "vitest";
import { refreshMonitorReviewData } from "@/pages/monitor/monitorReviewDataRefresh";

describe("refreshMonitorReviewData", () => {
  it("refreshes drawer submissions and school records after drawer review actions", async () => {
    const refreshSchoolDrawer = vi.fn();
    const refreshSubmissions = vi.fn().mockResolvedValue("submissions");
    const refreshRecords = vi.fn().mockResolvedValue("records");

    const results = await refreshMonitorReviewData({
      refreshSchoolDrawer,
      refreshSubmissions,
      refreshRecords,
    });

    expect(refreshSchoolDrawer).toHaveBeenCalledTimes(1);
    expect(refreshSubmissions).toHaveBeenCalledTimes(1);
    expect(refreshRecords).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("still runs records refresh when submissions refresh fails", async () => {
    const refreshSchoolDrawer = vi.fn();
    const refreshSubmissions = vi.fn().mockRejectedValue(new Error("submissions failed"));
    const refreshRecords = vi.fn().mockResolvedValue("records");

    const results = await refreshMonitorReviewData({
      refreshSchoolDrawer,
      refreshSubmissions,
      refreshRecords,
    });

    expect(refreshSchoolDrawer).toHaveBeenCalledTimes(1);
    expect(refreshSubmissions).toHaveBeenCalledTimes(1);
    expect(refreshRecords).toHaveBeenCalledTimes(1);
    expect(results.some((result) => result.status === "rejected")).toBe(true);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
  });
});
