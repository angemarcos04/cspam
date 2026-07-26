import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonitorMobileNavigator } from "@/pages/monitor/MonitorMobileNavigator";
import { MonitorSideNavigator } from "@/pages/monitor/MonitorSideNavigator";
import type { MonitorTopNavigatorId } from "@/pages/monitor/monitorFilters";

const navigatorBadges: Record<
  MonitorTopNavigatorId,
  { primary?: number; secondary?: number; urgency: "none" | "high" | "medium" }
> = {
  schools: { urgency: "none" },
  add_school: { urgency: "none" },
  reviews: { primary: 2, urgency: "medium" },
  audit: { urgency: "none" },
};

describe("Monitor navigation while the User Manual is hidden", () => {
  it("omits the manual control and its divider in expanded and collapsed desktop navigation", () => {
    const onNavigate = vi.fn();
    const onToggleManual = vi.fn();
    const { container, rerender } = render(
      <MonitorSideNavigator
        activeTopNavigator="reviews"
        navigatorBadges={navigatorBadges}
        isNavigatorCompact={false}
        isNavigatorVisible
        isMobileViewport={false}
        showNavigatorManual={false}
        shouldRenderNavigatorItems
        showNavigatorHeaderText
        onToggleNavigator={vi.fn()}
        onNavigate={onNavigate}
        onToggleManual={onToggleManual}
      />,
    );

    expect(screen.queryByRole("button", { name: /user manual/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Schools" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Add School" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Reviews" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Audit Trail" })).toBeTruthy();
    expect(container.querySelector(".border-t")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Schools" }));
    expect(onNavigate).toHaveBeenCalledWith("schools");
    expect(onToggleManual).not.toHaveBeenCalled();

    rerender(
      <MonitorSideNavigator
        activeTopNavigator="reviews"
        navigatorBadges={navigatorBadges}
        isNavigatorCompact
        isNavigatorVisible
        isMobileViewport={false}
        showNavigatorManual
        shouldRenderNavigatorItems
        showNavigatorHeaderText={false}
        onToggleNavigator={vi.fn()}
        onNavigate={onNavigate}
        onToggleManual={onToggleManual}
      />,
    );

    expect(screen.queryByRole("button", { name: /user manual/i })).toBeNull();
    expect(screen.queryByText("Back to Data")).toBeNull();
    expect(container.querySelector(".border-t")).toBeNull();
  });

  it("keeps mobile navigation limited to operational sections", () => {
    render(
      <MonitorMobileNavigator
        activeTopNavigator="reviews"
        navigatorBadges={navigatorBadges}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.queryByText("User Manual")).toBeNull();
    expect(screen.queryByText("Back to Data")).toBeNull();
    expect(screen.getByText("Schools")).toBeTruthy();
    expect(screen.getByText("Add School")).toBeTruthy();
    expect(screen.getByText("Reviews")).toBeTruthy();
    expect(screen.getByText("Audit Trail")).toBeTruthy();
  });
});
