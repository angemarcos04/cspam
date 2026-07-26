import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/App";

const backendWarmupState = {
  warmBackend: vi.fn(),
  getBackendWarmupStatus: vi.fn(),
  cancelBackendWarmup: vi.fn(),
};

vi.mock("@/pages/MonitorDashboard", () => ({
  MonitorDashboard: () => <h1>Division Monitor Dashboard</h1>,
}));

vi.mock("@/pages/SchoolAdminDashboard", () => ({
  SchoolAdminDashboard: () => <h1>School Dashboard</h1>,
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

vi.mock("@/lib/backendWarmup", () => ({
  warmBackend: () => backendWarmupState.warmBackend(),
  getBackendWarmupStatus: () => backendWarmupState.getBackendWarmupStatus(),
  cancelBackendWarmup: () => backendWarmupState.cancelBackendWarmup(),
}));

function requestPath(input: RequestInfo | URL): string {
  const value = input instanceof Request ? input.url : String(input);
  return new URL(value, window.location.origin).pathname;
}

describe("authenticated login-to-dashboard transition", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/#/");
    backendWarmupState.warmBackend.mockReset();
    backendWarmupState.warmBackend.mockResolvedValue({ status: "ready", warmedAt: Date.now() });
    backendWarmupState.getBackendWarmupStatus.mockReset();
    backendWarmupState.getBackendWarmupStatus.mockReturnValue("ready");
    backendWarmupState.cancelBackendWarmup.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens the Monitor dashboard after MFA and authenticated /me verification", async () => {
    const monitorUser = {
      id: 1,
      name: "Division Monitor",
      email: "monitor@cspams.local",
      role: "monitor",
      schoolId: null,
      schoolCode: null,
      schoolName: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") {
        return new Response(JSON.stringify({
          requiresMfa: true,
          mfa: {
            challengeId: "11111111-1111-4111-8111-111111111111",
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          },
          delivery: "sent",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/auth/verify-mfa") {
        return new Response(JSON.stringify({
          token: "verified-monitor-token",
          tokenType: "Bearer",
          user: monitorUser,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/auth/me") {
        return new Response(JSON.stringify({ user: monitorUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Division Monitor" }));
    fireEvent.change(screen.getByLabelText("Login ID"), {
      target: { value: "monitor@cspams.local" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Monitor@123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    const codeInput = await screen.findByLabelText("Verification Code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and Sign In" }));

    expect(await screen.findByRole("heading", { name: "Division Monitor Dashboard" })).toBeTruthy();
    expect(window.location.hash).toBe("#/monitor");

    const paths = fetchMock.mock.calls.map(([input]) => requestPath(input));
    expect(paths.filter((path) => path === "/api/auth/login")).toHaveLength(1);
    expect(paths.filter((path) => path === "/api/auth/verify-mfa")).toHaveLength(1);
    expect(paths.filter((path) => path === "/api/auth/me")).toHaveLength(1);
  });

  it("opens the School dashboard after authenticated /me verification", async () => {
    const schoolHeadUser = {
      id: 2,
      name: "School Head",
      email: "head@cspams.local",
      role: "school_head",
      schoolId: 42,
      schoolCode: "001234",
      schoolName: "CSPAMS Test School",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === "/api/auth/login") {
        return new Response(JSON.stringify({
          token: "verified-school-token",
          tokenType: "Bearer",
          user: schoolHeadUser,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/auth/me") {
        return new Response(JSON.stringify({ user: schoolHeadUser }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.change(screen.getByLabelText("Login ID"), {
      target: { value: "001234" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "School@123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(await screen.findByRole("heading", { name: "School Dashboard" })).toBeTruthy();
    expect(window.location.hash).toBe("#/school-admin");

    const paths = fetchMock.mock.calls.map(([input]) => requestPath(input));
    expect(paths.filter((path) => path === "/api/auth/login")).toHaveLength(1);
    expect(paths.filter((path) => path === "/api/auth/me")).toHaveLength(1);
    expect(paths.filter((path) => path === "/api/auth/verify-mfa")).toHaveLength(0);
  });
});
