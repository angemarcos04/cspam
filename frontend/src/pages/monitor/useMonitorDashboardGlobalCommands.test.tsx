import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMonitorDashboardGlobalCommands } from "@/pages/monitor/useMonitorDashboardGlobalCommands";

function buildArgs(overrides: Partial<Parameters<typeof useMonitorDashboardGlobalCommands>[0]> = {}) {
  return {
    refreshRecords: vi.fn().mockResolvedValue(undefined),
    refreshSubmissions: vi.fn().mockResolvedValue(undefined),
    refreshStudents: vi.fn().mockResolvedValue(undefined),
    refreshTeachers: vi.fn().mockResolvedValue(undefined),
    onToast: vi.fn(),
    setShowNavigatorManual: vi.fn(),
    setActiveTopNavigator: vi.fn(),
    focusAndScrollTo: vi.fn(),
    isMobileViewport: false,
    setIsNavigatorVisible: vi.fn(),
    ...overrides,
  };
}

describe("useMonitorDashboardGlobalCommands", () => {
  it("passes force and throwOnError to every manual dashboard refresh task", async () => {
    const args = buildArgs();
    const { result } = renderHook(() => useMonitorDashboardGlobalCommands(args));

    await act(async () => {
      await result.current.handleRefreshDashboard();
    });

    const expectedOptions = { force: true, throwOnError: true };
    expect(args.refreshRecords).toHaveBeenCalledWith(expectedOptions);
    expect(args.refreshSubmissions).toHaveBeenCalledWith(expectedOptions);
    expect(args.refreshStudents).toHaveBeenCalledWith(expectedOptions);
    expect(args.refreshTeachers).toHaveBeenCalledWith(expectedOptions);
  });

  it("shows a warning toast when any manual refresh task rejects", async () => {
    const args = buildArgs({
      refreshSubmissions: vi.fn().mockRejectedValue(new Error("submissions failed")),
    });
    const { result } = renderHook(() => useMonitorDashboardGlobalCommands(args));

    await act(async () => {
      await result.current.handleRefreshDashboard();
    });

    expect(args.onToast).toHaveBeenCalledWith("Some dashboard data failed to refresh. Please try again.", "warning");
  });

  it("uses instant non-highlighted scrolling for monitor navigation", () => {
    vi.useFakeTimers();
    const args = buildArgs();
    const { result } = renderHook(() => useMonitorDashboardGlobalCommands(args));

    act(() => {
      result.current.handleMonitorTopNavigate("reviews");
      vi.runAllTimers();
    });

    expect(args.setShowNavigatorManual).toHaveBeenCalledWith(false);
    expect(args.setActiveTopNavigator).toHaveBeenCalledWith("reviews");
    expect(args.focusAndScrollTo).toHaveBeenCalledWith("monitor-requirements-table", {
      smooth: false,
      highlight: false,
    });
    vi.useRealTimers();
  });
});
