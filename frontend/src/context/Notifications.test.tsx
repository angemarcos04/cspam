import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationProvider, useNotifications } from "@/context/Notifications";

const authState = vi.hoisted(() => ({
  user: { id: "monitor-1", name: "Monitor" } as unknown,
  apiToken: "monitor-token",
}));

const apiRequestRawMock = vi.hoisted(() => vi.fn());

vi.mock("@/context/Auth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/lib/api", () => ({
  apiRequestRaw: apiRequestRawMock,
  isApiError: (error: unknown) => Boolean(error && typeof error === "object" && "status" in error),
}));

function notificationRow(id: string, readAt: string | null = null) {
  return {
    id,
    type: "database",
    eventType: "indicator_scope_submitted",
    title: "BMEF sent for review",
    message: "A school sent BMEF for review.",
    readAt,
    createdAt: "2026-06-26T00:00:00.000Z",
    data: { submissionId: "sub-1" },
  };
}

function listResponse(rows = [notificationRow("n1")], unreadCount = 1) {
  return {
    data: {
      data: rows,
      meta: {
        currentPage: 1,
        lastPage: 1,
        perPage: 40,
        total: rows.length,
        unreadCount,
      },
    },
  };
}

function apiError(status: number, message = `Request failed with status ${status}.`) {
  return Object.assign(new Error(message), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function NotificationsHarness() {
  const {
    notifications,
    unreadCount,
    isLoading,
    error,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
  } = useNotifications();

  return (
    <div>
      <p data-testid="unread-count">{unreadCount}</p>
      <p data-testid="notification-count">{notifications.length}</p>
      <p data-testid="notification-error">{error}</p>
      <p data-testid="notification-loading">{isLoading ? "loading" : "idle"}</p>
      <button type="button" onClick={() => void refreshNotifications()}>Refresh</button>
      <button type="button" onClick={() => void markAsRead("n1")}>Read one</button>
      <button type="button" onClick={() => void markAllAsRead()}>Read all</button>
      <button type="button" onClick={() => void clearNotification("n1")}>Clear one</button>
      <button type="button" onClick={() => void clearAllNotifications()}>Clear all</button>
    </div>
  );
}

describe("NotificationProvider", () => {
  afterEach(() => {
    authState.user = { id: "monitor-1", name: "Monitor" };
    authState.apiToken = "monitor-token";
    apiRequestRawMock.mockReset();
    cleanup();
  });

  it("fetches notifications automatically after login", async () => {
    apiRequestRawMock.mockResolvedValue(listResponse());

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledWith("/api/notifications?per_page=40", {
        token: "monitor-token",
      });
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
    });
  });

  it("refreshes notifications on indicator realtime events after login", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockResolvedValueOnce(listResponse([notificationRow("n2")], 1));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new CustomEvent("cspams:update", {
      detail: { entity: "indicators", eventType: "indicators.scopes_submitted" },
    }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
    });
  });

  it("keeps the newest notification response when an older request resolves last", async () => {
    const older = deferred<ReturnType<typeof listResponse>>();
    const newer = deferred<ReturnType<typeof listResponse>>();
    apiRequestRawMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    render(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(2));

    newer.resolve(listResponse([notificationRow("new-1"), notificationRow("new-2")], 2));
    await waitFor(() => expect(screen.getByTestId("unread-count").textContent).toBe("2"));
    older.resolve(listResponse([notificationRow("old")], 1));
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.getByTestId("unread-count").textContent).toBe("2");
    expect(screen.getByTestId("notification-count").textContent).toBe("2");
    expect(screen.getByTestId("notification-error").textContent).toBe("");
  });

  it.each([
    ["Read one", { data: { data: notificationRow("n1", "2026-06-26T01:00:00.000Z") } }, "1", "0"],
    ["Read all", { data: { updated: 1 } }, "1", "0"],
    ["Clear one", { data: { cleared: 1 } }, "0", "0"],
    ["Clear all", { data: { cleared: 1 } }, "0", "0"],
  ])("does not let an older list response undo %s", async (action, mutationResponse, expectedCount, expectedUnread) => {
    const staleList = deferred<ReturnType<typeof listResponse>>();
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockReturnValueOnce(staleList.promise)
      .mockResolvedValueOnce(mutationResponse);

    render(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId("notification-count").textContent).toBe("1"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: action }));

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe(expectedCount);
      expect(screen.getByTestId("unread-count").textContent).toBe(expectedUnread);
    });

    staleList.resolve(listResponse([notificationRow("n1")], 1));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByTestId("notification-count").textContent).toBe(expectedCount);
    expect(screen.getByTestId("unread-count").textContent).toBe(expectedUnread);
    expect(screen.getByTestId("notification-loading").textContent).toBe("idle");
  });

  it("lets a newer silent refresh clear loading after superseding a manual refresh", async () => {
    const staleManual = deferred<ReturnType<typeof listResponse>>();
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockReturnValueOnce(staleManual.promise)
      .mockResolvedValueOnce(listResponse([notificationRow("n1"), notificationRow("n2")], 2));

    render(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(screen.getByTestId("notification-loading").textContent).toBe("idle"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByTestId("notification-loading").textContent).toBe("loading"));

    window.dispatchEvent(new CustomEvent("cspams:update", {
      detail: { entity: "indicators", eventType: "indicators.scopes_submitted" },
    }));

    await waitFor(() => {
      expect(screen.getByTestId("notification-loading").textContent).toBe("idle");
      expect(screen.getByTestId("unread-count").textContent).toBe("2");
    });

    staleManual.resolve(listResponse([notificationRow("old")], 1));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByTestId("notification-loading").textContent).toBe("idle");
    expect(screen.getByTestId("unread-count").textContent).toBe("2");
  });

  it("invalidates an in-flight notification request when the authenticated session changes", async () => {
    const previousSession = deferred<ReturnType<typeof listResponse>>();
    apiRequestRawMock
      .mockReturnValueOnce(previousSession.promise)
      .mockResolvedValueOnce(listResponse([notificationRow("next-session")], 1));

    const view = render(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(1));

    authState.user = { id: "monitor-2", name: "Next Monitor" };
    authState.apiToken = "next-token";
    view.rerender(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("notification-count").textContent).toBe("1"));

    previousSession.resolve(listResponse([notificationRow("previous-1"), notificationRow("previous-2")], 2));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(screen.getByTestId("notification-count").textContent).toBe("1");
    expect(screen.getByTestId("unread-count").textContent).toBe("1");
  });

  it("debounces a burst of submission realtime events into one notification refresh", async () => {
    apiRequestRawMock.mockResolvedValue(listResponse([notificationRow("n1")], 1));
    render(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(1));

    for (const eventType of ["indicators.submitted", "indicators.scopes_submitted", "indicators.scope_returned"]) {
      window.dispatchEvent(new CustomEvent("cspams:update", { detail: { entity: "indicators", eventType } }));
    }

    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(2));
  });

  it("ignores irrelevant realtime events", async () => {
    apiRequestRawMock.mockResolvedValue(listResponse([notificationRow("n1")], 1));
    render(<NotificationProvider><NotificationsHarness /></NotificationProvider>);
    await waitFor(() => expect(apiRequestRawMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new CustomEvent("cspams:update", {
      detail: { entity: "students", eventType: "students.updated" },
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes notifications on school reminder realtime events after login", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockResolvedValueOnce(listResponse([notificationRow("n2")], 1));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new CustomEvent("cspams:update", {
      detail: { eventType: "school_records.reminder_sent" },
    }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
    });
  });

  it("keeps mark-as-read and mark-all-read behavior", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockResolvedValueOnce({ data: { data: notificationRow("n1", "2026-06-26T01:00:00.000Z") } })
      .mockResolvedValueOnce({ data: { updated: 1 } });

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Read one" }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledWith("/api/notifications/n1/read", {
        method: "POST",
        token: "monitor-token",
      });
      expect(screen.getByTestId("unread-count").textContent).toBe("0");
    });

    fireEvent.click(screen.getByRole("button", { name: "Read all" }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledWith("/api/notifications/read-all", {
        method: "POST",
        token: "monitor-token",
      });
    });
  });

  it("shows a user-safe error for server notification load failures", async () => {
    apiRequestRawMock.mockRejectedValue(apiError(500));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-error").textContent).toBe(
        "Unable to load notifications. Try refreshing. If this continues, contact the administrator.",
      );
    });
  });

  it("does not show a session-expired message for unauthorized notification loads", async () => {
    apiRequestRawMock.mockRejectedValue(apiError(401));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-error").textContent).toBe("");
    });
  });

  it("shows a permission error for forbidden notification loads", async () => {
    apiRequestRawMock.mockRejectedValue(apiError(403, "Raw backend permission text."));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-error").textContent).toBe(
        "You do not have permission to access notifications.",
      );
    });
  });

  it("normalizes malformed notification list responses without crashing", async () => {
    apiRequestRawMock.mockResolvedValue({ data: { data: null, meta: undefined } });

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("0");
      expect(screen.getByTestId("unread-count").textContent).toBe("0");
      expect(screen.getByTestId("notification-error").textContent).toBe("");
    });
  });

  it("keeps unread count intact when mark-as-read fails", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockRejectedValueOnce(apiError(500));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Read one" }));

    await waitFor(() => {
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
      expect(screen.getByTestId("notification-error").textContent).toBe(
        "Unable to load notifications. Try refreshing. If this continues, contact the administrator.",
      );
    });
  });

  it("clears one unread notification and decrements unread count", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockResolvedValueOnce({ data: { cleared: 1 } });

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear one" }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledWith("/api/notifications/n1/clear", {
        method: "POST",
        token: "monitor-token",
      });
      expect(screen.getByTestId("notification-count").textContent).toBe("0");
      expect(screen.getByTestId("unread-count").textContent).toBe("0");
    });
  });

  it("clears one read notification without decrementing unread count", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1", "2026-06-26T01:00:00.000Z")], 0))
      .mockResolvedValueOnce({ data: { cleared: 1 } });

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
      expect(screen.getByTestId("unread-count").textContent).toBe("0");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear one" }));

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("0");
      expect(screen.getByTestId("unread-count").textContent).toBe("0");
    });
  });

  it("clears all notifications and resets unread count", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([
        notificationRow("n1"),
        notificationRow("n2", "2026-06-26T01:00:00.000Z"),
      ], 1))
      .mockResolvedValueOnce({ data: { cleared: 2 } });

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("2");
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    await waitFor(() => {
      expect(apiRequestRawMock).toHaveBeenCalledWith("/api/notifications/clear", {
        method: "POST",
        token: "monitor-token",
      });
      expect(screen.getByTestId("notification-count").textContent).toBe("0");
      expect(screen.getByTestId("unread-count").textContent).toBe("0");
    });
  });

  it("keeps notification state intact when clear fails", async () => {
    apiRequestRawMock
      .mockResolvedValueOnce(listResponse([notificationRow("n1")], 1))
      .mockRejectedValueOnce(apiError(500));

    render(
      <NotificationProvider>
        <NotificationsHarness />
      </NotificationProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear one" }));

    await waitFor(() => {
      expect(screen.getByTestId("notification-count").textContent).toBe("1");
      expect(screen.getByTestId("unread-count").textContent).toBe("1");
      expect(screen.getByTestId("notification-error").textContent).toBe(
        "Unable to load notifications. Try refreshing. If this continues, contact the administrator.",
      );
    });
  });
});
