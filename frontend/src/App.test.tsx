import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";
import { getApiBaseUrl } from "@/lib/api";

vi.mock("@/pages/Login", () => ({
  Login: () => <div>Login Page</div>,
}));

vi.mock("@/pages/MonitorDashboard", () => ({
  MonitorDashboard: () => <div>Monitor Dashboard</div>,
}));

vi.mock("@/pages/SchoolAdminDashboard", () => ({
  SchoolAdminDashboard: () => <div>School Admin Dashboard</div>,
}));

vi.mock("@/pages/ForgotPassword", () => ({
  ForgotPassword: () => <div>Forgot Password</div>,
}));

vi.mock("@/pages/MfaResetComplete", () => ({
  MfaResetComplete: () => <div>MFA Recovery Complete</div>,
}));

vi.mock("@/pages/MfaResetRequest", () => ({
  MfaResetRequest: () => <div>MFA Recovery Request</div>,
}));

vi.mock("@/pages/ResetPassword", () => ({
  ResetPassword: () => <div>Reset Password</div>,
}));

vi.mock("@/pages/SetupAccount", () => ({
  SetupAccount: () => <div>Setup Account</div>,
}));

vi.mock("@/context/Data", () => ({
  DataProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/IndicatorData", () => ({
  IndicatorDataProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/Notifications", () => ({
  NotificationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/StudentData", () => ({
  StudentDataProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/context/TeacherData", () => ({
  TeacherDataProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/realtime", () => ({
  startRealtimeBridge: vi.fn(),
  stopRealtimeBridge: vi.fn(),
}));

describe("App hard-reload session restoration", () => {
  const storedBearerSession = {
    mode: "bearer",
    token: "test-bearer-token",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    refreshAfter: new Date(Date.now() + 60_000).toISOString(),
  };

  beforeEach(() => {
    document.cookie = "XSRF-TOKEN=test-xsrf-token; path=/";
    delete (window as Window & { echoDisconnected?: boolean }).echoDisconnected;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { echoDisconnected?: boolean }).echoDisconnected;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      hash: "#/monitor",
      user: {
        id: 1,
        name: "Monitor User",
        email: "monitor@cspams.local",
        role: "monitor",
        schoolId: null,
        schoolCode: null,
        schoolName: null,
      },
      expectedText: "Monitor Dashboard",
    },
    {
      hash: "#/school-admin",
      user: {
        id: 2,
        name: "School Head",
        email: "head@cspams.local",
        role: "school_head",
        schoolId: 42,
        schoolCode: "401777",
        schoolName: "AMA CC - Santiago City",
      },
      expectedText: "School Admin Dashboard",
    },
  ])("keeps $hash after a successful bearer-session restore", async ({ hash, user, expectedText }) => {
    window.sessionStorage.setItem("cspams.auth.session.v2", JSON.stringify(storedBearerSession));
    window.history.replaceState(null, "", `/${hash}`);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(expectedText)).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${getApiBaseUrl()}/api/auth/me`);
  });

  it("still redirects signed-out users to the login page", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/#/monitor");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Login Page")).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("shows a red realtime warning when Reverb disconnects during an authenticated session", async () => {
    window.sessionStorage.setItem("cspams.auth.session.v2", JSON.stringify(storedBearerSession));
    window.history.replaceState(null, "", "/#/school-admin");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        user: {
          id: 2,
          name: "School Head",
          email: "head@cspams.local",
          role: "school_head",
          schoolId: 42,
          schoolCode: "401777",
          schoolName: "AMA CC - Santiago City",
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("School Admin Dashboard")).not.toBeNull();
    });

    expect(screen.queryByText(/Realtime updates are disconnected/i)).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent("reverb:disconnected"));
    });

    expect(await screen.findByText(/Realtime updates are disconnected/i)).not.toBeNull();
    expect(screen.getByText(/refresh the page if saved or sent items look delayed/i)).not.toBeNull();
  });

  it("shows the realtime warning on mount when the disconnect flag is already set", async () => {
    (window as Window & { echoDisconnected?: boolean }).echoDisconnected = true;
    window.sessionStorage.setItem("cspams.auth.session.v2", JSON.stringify(storedBearerSession));
    window.history.replaceState(null, "", "/#/monitor");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        user: {
          id: 1,
          name: "Monitor User",
          email: "monitor@cspams.local",
          role: "monitor",
          schoolId: null,
          schoolCode: null,
          schoolName: null,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Monitor Dashboard")).not.toBeNull();
    });

    expect(screen.getByText(/Realtime updates are disconnected/i)).not.toBeNull();
  });
});
