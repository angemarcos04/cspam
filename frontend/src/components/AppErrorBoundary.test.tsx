import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

function BrokenChild(): never {
  throw new Error("render failed");
}

describe("AppErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders successful children normally", () => {
    render(
      <AppErrorBoundary>
        <p>Application ready</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Application ready")).toBeTruthy();
  });

  it("shows a visible recovery screen and reload action after a render error", () => {
    const onReload = vi.fn();

    render(
      <AppErrorBoundary onReload={onReload}>
        <BrokenChild />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("CSPAMS could not finish loading.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload Application" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
