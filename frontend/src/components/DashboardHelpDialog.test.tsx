import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardHelpDialog } from "@/components/DashboardHelpDialog";

describe("DashboardHelpDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the School Head account setup quick guide available", () => {
    const onClose = vi.fn();

    render(<DashboardHelpDialog open onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "Account Setup & Sign-in Help" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Activate your account" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Not receiving email?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves Escape and backdrop close behavior", () => {
    const onClose = vi.fn();
    const { rerender } = render(<DashboardHelpDialog open onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<DashboardHelpDialog open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close help dialog" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
