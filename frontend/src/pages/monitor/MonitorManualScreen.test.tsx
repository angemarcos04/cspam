import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MonitorManualScreen } from "@/pages/monitor/MonitorManualScreen";

describe("MonitorManualScreen", () => {
  it("preserves the manual content and close action for later restoration", () => {
    const onClose = vi.fn();
    render(<MonitorManualScreen onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "User Manual" })).toBeTruthy();
    [
      "Dashboard Overview",
      "Schools",
      "Add School",
      "Reviews",
      "School Detail",
      "Audit Trail",
      "Account Setup & Account Recovery",
      "Status Guide",
      "Quick Reminders",
    ].forEach((heading) => {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Return to Dashboard Data" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
