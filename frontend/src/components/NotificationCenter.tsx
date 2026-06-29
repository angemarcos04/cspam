import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "@/context/Notifications";
import type { AppNotification } from "@/types";

function formatRelativeTime(value: string | null): string {
  if (!value) return "Just now";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function notificationNotePreview(notification: AppNotification): string | null {
  const value = notification.data?.notePreview;

  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function notificationActionUrl(notification: AppNotification): string | null {
  const value = notification.data?.actionUrl;

  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function NotificationCenter() {
  const navigate = useNavigate();
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
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const visibleNotifications = useMemo(() => notifications.slice(0, 8), [notifications]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      void refreshNotifications();
    }
  };

  const handleNotificationClick = async (notification: AppNotification) => {
    await markAsRead(notification.id);

    const actionUrl = notificationActionUrl(notification);
    if (actionUrl) {
      setOpen(false);
      navigate(actionUrl);
    }
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-sm text-white transition hover:bg-white/14"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-[60] w-[22rem] overflow-hidden rounded-sm border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Notifications</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void markAllAsRead()}
                disabled={unreadCount === 0}
                className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
              <button
                type="button"
                onClick={() => void clearAllNotifications()}
                disabled={visibleNotifications.length === 0}
                className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="h-3.5 w-3.5" />
                Clear all
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading && visibleNotifications.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-500">Loading notifications...</p>
            ) : error ? (
              <p className="px-3 py-4 text-xs text-rose-700">{error}</p>
            ) : visibleNotifications.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-500">No notifications yet.</p>
            ) : (
              visibleNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex items-start gap-2 border-b border-slate-100 px-3 py-2 transition last:border-b-0 hover:bg-slate-50 ${
                    notification.readAt ? "bg-white" : "bg-primary-50/40"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleNotificationClick(notification)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-xs font-semibold text-slate-900">{notification.title}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{notification.message}</p>
                    {notificationNotePreview(notification) && (
                      <p className="mt-1 text-xs text-slate-700">Note: {notificationNotePreview(notification)}</p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">{formatRelativeTime(notification.createdAt)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearNotification(notification.id)}
                    aria-label={`Clear notification: ${notification.title}`}
                    title="Clear notification"
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
