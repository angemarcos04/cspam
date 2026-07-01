import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuth } from "@/context/Auth";
import { apiRequest } from "@/lib/api";
import { MonitorAuditTrail } from "@/pages/monitor/MonitorAuditTrail";

vi.mock("@/context/Auth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

describe("MonitorAuditTrail", () => {
  it("does not render an empty description paragraph", async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: "monitor",
      username: "Monitor User",
      user: {
        id: 1,
        name: "Monitor User",
        email: "monitor@cspams.local",
        role: "monitor",
        schoolId: null,
        schoolCode: null,
        schoolName: null,
      },
      apiToken: "test-token",
      authError: "",
      authErrorCode: null,
      accountStatus: null,
      isLoading: false,
      isAuthenticating: false,
      isLoggingOut: false,
      clearAuthError: vi.fn(),
      handleUnauthorizedResponse: vi.fn(),
      login: vi.fn(),
      verifyMfa: vi.fn(),
      requestMonitorPasswordReset: vi.fn(),
      resetMonitorPassword: vi.fn(),
      requestMonitorMfaReset: vi.fn(),
      completeMonitorMfaReset: vi.fn(),
      completeAccountSetup: vi.fn(),
      resetRequiredPassword: vi.fn(),
      logout: vi.fn(),
      listActiveSessions: vi.fn(),
      revokeSessionDevice: vi.fn(),
      revokeOtherSessions: vi.fn(),
    });
    vi.mocked(apiRequest).mockResolvedValue({
      data: [],
      meta: { total: 0 },
    } as never);

    const { container } = render(<MonitorAuditTrail title="Audit Trail" description="" />);

    expect(screen.getByText("Audit Trail")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(container.querySelector("p.mt-1.text-xs.text-slate-600")).toBeNull();
    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "/api/audit-logs?per_page=30",
        expect.objectContaining({ token: "test-token" }),
      );
    });
  });
});
