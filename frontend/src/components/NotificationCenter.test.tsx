import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "@/components/NotificationCenter";

const notificationMocks = vi.hoisted(() => ({
  refreshNotifications: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  clearNotification: vi.fn(),
  clearAllNotifications: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@/context/Notifications", () => ({
  useNotifications: () => notificationMocks.state,
}));

function setNotificationState(overrides: Record<string, unknown> = {}) {
  notificationMocks.refreshNotifications.mockReset();
  notificationMocks.markAsRead.mockReset();
  notificationMocks.markAllAsRead.mockReset();
  notificationMocks.clearNotification.mockReset();
  notificationMocks.clearAllNotifications.mockReset();
  notificationMocks.state = {
    notifications: [],
    unreadCount: 0,
    isLoading: false,
    error: "",
    lastSyncedAt: null,
    refreshNotifications: notificationMocks.refreshNotifications,
    markAsRead: notificationMocks.markAsRead,
    markAllAsRead: notificationMocks.markAllAsRead,
    clearNotification: notificationMocks.clearNotification,
    clearAllNotifications: notificationMocks.clearAllNotifications,
    ...overrides,
  };
}

describe("NotificationCenter", () => {
  beforeEach(() => {
    setNotificationState();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the dropdown, refreshes notifications, and renders the empty state", () => {
    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(notificationMocks.refreshNotifications).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No notifications yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /mark all read/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /clear all/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the safe notification load error", () => {
    setNotificationState({
      error: "Unable to load notifications. Try refreshing. If this continues, contact the administrator.",
    });

    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("Unable to load notifications. Try refreshing. If this continues, contact the administrator.")).toBeTruthy();
  });

  it("renders unread notifications and marks an opened notification as read", () => {
    setNotificationState({
      unreadCount: 1,
      notifications: [
        {
          id: "n1",
          type: "database",
          eventType: "indicator_scope_submitted",
          title: "BMEF sent for review",
          message: "A school sent BMEF for review.",
          readAt: null,
          createdAt: null,
          data: { submissionId: "sub-1" },
        },
      ],
    });

    render(<NotificationCenter />);

    expect(screen.getByText("1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect((screen.getByRole("button", { name: /mark all read/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /clear all/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("BMEF sent for review")).toBeTruthy();
    expect(screen.getByText("A school sent BMEF for review.")).toBeTruthy();
    expect(screen.getByText("Just now")).toBeTruthy();

    fireEvent.click(screen.getByText("BMEF sent for review").closest("button") as HTMLButtonElement);

    expect(notificationMocks.markAsRead).toHaveBeenCalledWith("n1");
  });

  it("calls clear all from the dropdown action", () => {
    setNotificationState({
      unreadCount: 0,
      notifications: [
        {
          id: "n1",
          type: "database",
          eventType: "indicator_scope_submitted",
          title: "BMEF sent for review",
          message: "A school sent BMEF for review.",
          readAt: "2026-06-26T01:00:00.000Z",
          createdAt: null,
          data: { submissionId: "sub-1" },
        },
      ],
    });

    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));

    expect(notificationMocks.clearAllNotifications).toHaveBeenCalledTimes(1);
  });

  it("clears one notification without marking it read", () => {
    setNotificationState({
      unreadCount: 1,
      notifications: [
        {
          id: "n1",
          type: "database",
          eventType: "indicator_scope_submitted",
          title: "BMEF sent for review",
          message: "A school sent BMEF for review.",
          readAt: null,
          createdAt: null,
          data: { submissionId: "sub-1" },
        },
      ],
    });

    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear notification: BMEF sent for review" }));

    expect(notificationMocks.clearNotification).toHaveBeenCalledWith("n1");
    expect(notificationMocks.markAsRead).not.toHaveBeenCalled();
  });

  it("calls mark all read from the dropdown action", () => {
    setNotificationState({
      unreadCount: 1,
      notifications: [
        {
          id: "n1",
          type: "database",
          eventType: "indicator_scope_submitted",
          title: "BMEF sent for review",
          message: "A school sent BMEF for review.",
          readAt: null,
          createdAt: null,
          data: { submissionId: "sub-1" },
        },
      ],
    });

    render(<NotificationCenter />);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    expect(notificationMocks.markAllAsRead).toHaveBeenCalledTimes(1);
  });
});
