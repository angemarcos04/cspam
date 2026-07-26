import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorDashboardShellActions } from "@/pages/monitor/MonitorDashboardShellActions";

describe("MonitorDashboardShellActions", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps refresh and synchronization status without a Quick Guide action", () => {
    const onRefresh = vi.fn();

    render(
      <MonitorDashboardShellActions
        isDashboardSyncing={false}
        dashboardLastSyncedAt="2026-07-26T08:30:00.000Z"
        syncStatus="up_to_date"
        syncScope="Schools"
        onRefresh={onRefresh}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: "Refresh dashboard data" });
    fireEvent.click(refreshButton);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect((refreshButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Up to date/)).toBeTruthy();
    expect(screen.getByText(/Schools/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open quick guide" })).toBeNull();
  });

  it("disables refresh while synchronization is running", () => {
    render(
      <MonitorDashboardShellActions
        isDashboardSyncing
        dashboardLastSyncedAt={null}
        syncStatus="updated"
        syncScope={null}
        onRefresh={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Refresh dashboard data" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Not synced/)).toBeTruthy();
  });
});
