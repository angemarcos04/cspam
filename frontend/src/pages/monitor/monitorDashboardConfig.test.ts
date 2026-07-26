import { describe, expect, it } from "vitest";
import {
  MONITOR_USER_MANUAL_VISIBLE,
  resolveMonitorUserManualOpen,
} from "@/pages/monitor/monitorDashboardConfig";

describe("Monitor User Manual visibility", () => {
  it("keeps stale open state from exposing the temporarily hidden manual", () => {
    expect(MONITOR_USER_MANUAL_VISIBLE).toBe(false);
    expect(resolveMonitorUserManualOpen(true)).toBe(false);
    expect(resolveMonitorUserManualOpen(false)).toBe(false);
  });
});
