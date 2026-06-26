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
  isApiError: () => false,
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

function NotificationsHarness() {
  const {
    notifications,
    unreadCount,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  return (
    <div>
      <p data-testid="unread-count">{unreadCount}</p>
      <p data-testid="notification-count">{notifications.length}</p>
      <button type="button" onClick={() => void refreshNotifications()}>Refresh</button>
      <button type="button" onClick={() => void markAsRead("n1")}>Read one</button>
      <button type="button" onClick={() => void markAllAsRead()}>Read all</button>
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
});
