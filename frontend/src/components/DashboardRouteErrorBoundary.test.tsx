import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardRouteErrorBoundary } from "@/components/DashboardRouteErrorBoundary";

const authState = {
  logout: vi.fn(),
};

vi.mock("@/context/Auth", () => ({
  useAuth: () => authState,
}));

function BrokenDashboard(): never {
  throw new Error("dashboard render failed");
}

function CurrentRoute() {
  const location = useLocation();
  return <p>Route: {location.pathname}</p>;
}

describe("DashboardRouteErrorBoundary", () => {
  beforeEach(() => {
    authState.logout.mockReset();
    authState.logout.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders dashboard children when no error occurs", () => {
    render(
      <MemoryRouter initialEntries={["/monitor"]}>
        <DashboardRouteErrorBoundary>
          <p>Division Monitor Dashboard</p>
        </DashboardRouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText("Division Monitor Dashboard")).toBeTruthy();
  });

  it("shows recovery actions instead of a blank page after a dashboard error", () => {
    render(
      <MemoryRouter initialEntries={["/monitor"]}>
        <DashboardRouteErrorBoundary>
          <BrokenDashboard />
        </DashboardRouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("The dashboard could not finish loading.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try Dashboard Again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload Application" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Return to Sign In" })).toBeTruthy();
  });

  it("retries by remounting the dashboard subtree", () => {
    let shouldThrow = true;
    function RecoverableDashboard() {
      if (shouldThrow) {
        throw new Error("temporary render failure");
      }
      return <p>Dashboard recovered</p>;
    }

    render(
      <MemoryRouter initialEntries={["/monitor"]}>
        <DashboardRouteErrorBoundary>
          <RecoverableDashboard />
        </DashboardRouteErrorBoundary>
      </MemoryRouter>,
    );

    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try Dashboard Again" }));
    expect(screen.getByText("Dashboard recovered")).toBeTruthy();
  });

  it("uses forced logout before returning to sign in", async () => {
    render(
      <MemoryRouter initialEntries={["/monitor"]}>
        <CurrentRoute />
        <DashboardRouteErrorBoundary>
          <BrokenDashboard />
        </DashboardRouteErrorBoundary>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Return to Sign In" }));

    await waitFor(() => {
      expect(authState.logout).toHaveBeenCalledWith({ force: true });
      expect(screen.getByText("Route: /")).toBeTruthy();
    });
  });
});
