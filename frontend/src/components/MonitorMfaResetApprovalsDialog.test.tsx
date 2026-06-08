import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorMfaResetApprovalsDialog } from "@/components/MonitorMfaResetApprovalsDialog";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  apiRequest: mocks.apiRequest,
  isApiError: (value: unknown) => Boolean(value && typeof value === "object" && "status" in value),
}));

vi.mock("@/context/Auth", () => ({
  useAuth: () => ({
    apiToken: "monitor-token",
  }),
}));

describe("MonitorMfaResetApprovalsDialog", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.apiRequest.mockReset();
  });

  it("shows the approver-visible recovery token and email failure guidance", async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({
        data: [
          {
            id: 7,
            status: "pending",
            reason: "Lost backup codes.",
            requestedAt: "2026-06-09T08:00:00.000Z",
            expiresAt: "2026-06-10T08:00:00.000Z",
            requester: {
              id: 22,
              name: "CSPAMS Monitor",
              email: "monitor@cspams.local",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "approved",
        requestId: 7,
        approvalToken: "ABCD-1234",
        approvalTokenExpiresAt: "2026-06-09T09:00:00.000Z",
        delivery: "failed",
        deliveryMessage: "Email delivery failed.",
        message: "MFA recovery approved, but email delivery failed. Copy and share the recovery token securely.",
      });

    render(
      <MonitorMfaResetApprovalsDialog
        open
        isAuthenticated
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "MFA Recovery Requests" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /approve request/i }));

    expect(await screen.findByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByText("Email failed. Copy and share this recovery token securely.")).toBeTruthy();

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenLastCalledWith(
        "/api/auth/mfa/reset/requests/7/approve",
        expect.objectContaining({
          method: "POST",
          token: "monitor-token",
        }),
      );
    });
  });
});
