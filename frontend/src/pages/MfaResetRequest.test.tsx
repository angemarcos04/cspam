import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { MfaResetRequest } from "@/pages/MfaResetRequest";

const authState = {
  requestMonitorMfaReset: vi.fn(),
  isAuthenticating: false,
};

vi.mock("@/context/Auth", () => ({
  useAuth: () => authState,
}));

describe("MfaResetRequest", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    authState.requestMonitorMfaReset.mockReset();
    authState.isAuthenticating = false;
  });

  it("explains that recovery is separate from the six-digit login code", () => {
    render(
      <MemoryRouter initialEntries={["/mfa-reset?email=monitor@cspams.local"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MfaResetRequest />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Request MFA Recovery" })).toBeTruthy();
    expect(screen.getByText("Use this only if you cannot complete MFA with your email code or backup code.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Have a 6-digit code? Return to sign in" })).toBeTruthy();
  });

  it("shows a clear recovery-token instruction after request submission", async () => {
    authState.requestMonitorMfaReset.mockResolvedValueOnce({
      status: "pending",
      requestId: 12,
      expiresAt: "2026-06-10T06:00:00.000Z",
      message: "MFA recovery request submitted. Ask another Division Monitor to approve it before completion.",
    });

    render(
      <MemoryRouter initialEntries={["/mfa-reset?email=monitor@cspams.local"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MfaResetRequest />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit recovery request/i }).closest("form")!);

    await waitFor(() => {
      expect(authState.requestMonitorMfaReset).toHaveBeenCalledWith({
        login: "monitor@cspams.local",
        password: "Demo@123456",
        reason: undefined,
      });
    });

    expect(await screen.findByText("MFA recovery request submitted. Ask another Division Monitor to approve it before completion.")).toBeTruthy();
    expect(screen.getByText(/one-time recovery token in XXXX-XXXX format/i)).toBeTruthy();
    expect(screen.getByText(/This is not the 6-digit login code/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /already approved\? complete recovery/i })).toBeTruthy();
  });

  it("maps bare 503 failures to safe copy", async () => {
    authState.requestMonitorMfaReset.mockRejectedValueOnce(
      new ApiError("Request failed with status 503.", 503, null),
    );

    render(
      <MemoryRouter initialEntries={["/mfa-reset?email=monitor@cspams.local"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MfaResetRequest />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /submit recovery request/i }).closest("form")!);

    expect(await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  });
});
