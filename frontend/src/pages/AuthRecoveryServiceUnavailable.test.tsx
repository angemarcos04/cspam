import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";
import { SetupAccount } from "@/pages/SetupAccount";

const authState = {
  requestMonitorPasswordReset: vi.fn(),
  resetMonitorPassword: vi.fn(),
  completeAccountSetup: vi.fn(),
  isAuthenticating: false,
};

vi.mock("@/context/Auth", () => ({
  useAuth: () => authState,
}));

describe("auth recovery service-unavailable errors", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    authState.requestMonitorPasswordReset.mockReset();
    authState.resetMonitorPassword.mockReset();
    authState.completeAccountSetup.mockReset();
    authState.isAuthenticating = false;
  });

  it("maps forgot-password bare 503 failures to safe copy", async () => {
    authState.requestMonitorPasswordReset.mockRejectedValueOnce(
      new ApiError("Request failed with status 503.", 503, null),
    );

    render(
      <MemoryRouter initialEntries={["/forgot-password?role=monitor&email=monitor@cspams.local"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ForgotPassword />
      </MemoryRouter>,
    );

    fireEvent.submit(screen.getByRole("button", { name: /send reset link/i }).closest("form")!);

    expect(await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  });

  it("maps reset-password bare 503 failures to safe copy", async () => {
    authState.resetMonitorPassword.mockRejectedValueOnce(
      new ApiError("Request failed with status 503.", 503, null),
    );

    render(
      <MemoryRouter initialEntries={["/reset-password?role=monitor&email=monitor@cspams.local&token=reset-token"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ResetPassword />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "Demo@123456" } });
    fireEvent.change(screen.getByLabelText("Confirm New Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /update password/i }).closest("form")!);

    expect(await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  });

  it("maps account-setup bare 503 failures to safe copy", async () => {
    authState.completeAccountSetup.mockRejectedValueOnce(
      new ApiError("Request failed with status 503.", 503, null),
    );

    render(
      <MemoryRouter initialEntries={["/setup-account?token=setup-token"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SetupAccount />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "Demo@123456" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /complete setup/i }).closest("form")!);

    expect(await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  });
});
