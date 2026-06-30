import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardHelpDialog } from "@/components/DashboardHelpDialog";

describe("DashboardHelpDialog", () => {
  it("points monitor users to the User Manual account recovery section", () => {
    const onClose = vi.fn();

    render(<DashboardHelpDialog open variant="monitor" onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "User Manual" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Monitor User Manual" })).toBeTruthy();
    expect(screen.getByText(/Account Setup & Account Recovery/i)).toBeTruthy();
    expect(screen.getByText(/setup links, reset links, email delivery troubleshooting/i)).toBeTruthy();
    expect(screen.queryByText("Schools -> Accounts")).toBeNull();
    expect(screen.queryByText("Schools -> More -> MFA Recovery Requests")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the School Head account setup quick guide available", () => {
    render(<DashboardHelpDialog open variant="school_head" onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Account Setup & Sign-in Help" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Activate your account" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Not receiving email?" })).toBeTruthy();
  });
});
