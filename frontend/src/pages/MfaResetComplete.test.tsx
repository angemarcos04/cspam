import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { MfaResetComplete } from "@/pages/MfaResetComplete";

const authState = {
  completeMonitorMfaReset: vi.fn(),
  isAuthenticating: false,
};

vi.mock("@/context/Auth", () => ({
  useAuth: () => authState,
}));

describe("MfaResetComplete", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    authState.completeMonitorMfaReset.mockReset();
    authState.isAuthenticating = false;
  });

  it("labels the required token as recovery, not the six-digit login code", () => {
    render(
      <MemoryRouter initialEntries={["/mfa-reset/complete?email=monitor@cspams.local&request_id=7"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MfaResetComplete />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Complete MFA Recovery" })).toBeTruthy();
    expect(screen.getByLabelText("Recovery Token")).toBeTruthy();
    expect(screen.getByText("Enter the XXXX-XXXX token shared by the approving Division Monitor. This is not the 6-digit login code.")).toBeTruthy();
  });

  it("rejects a six-digit login MFA code as a recovery token", async () => {
    render(
      <MemoryRouter initialEntries={["/mfa-reset/complete?email=monitor@cspams.local&request_id=7"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MfaResetComplete />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "Demo@123456" } });
    fireEvent.change(screen.getByLabelText("Recovery Token"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("button", { name: /complete recovery/i }).closest("form")!);

    expect(await screen.findByText("Recovery token must be in XXXX-XXXX format.")).toBeTruthy();
    await waitFor(() => {
      expect(authState.completeMonitorMfaReset).not.toHaveBeenCalled();
    });
  });

  it("maps bare 503 failures to safe copy", async () => {
    authState.completeMonitorMfaReset.mockRejectedValueOnce(
      new ApiError("Request failed with status 503.", 503, null),
    );

    render(
      <MemoryRouter initialEntries={["/mfa-reset/complete?email=monitor@cspams.local&request_id=7"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MfaResetComplete />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Current Password"), { target: { value: "Demo@123456" } });
    fireEvent.change(screen.getByLabelText("Recovery Token"), { target: { value: "ABCD1234" } });
    fireEvent.submit(screen.getByRole("button", { name: /complete recovery/i }).closest("form")!);

    expect(await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  });
});
