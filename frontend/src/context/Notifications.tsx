import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/context/Auth";
import { apiRequestRaw, isApiError } from "@/lib/api";
import type { AppNotification, AppNotificationListMeta } from "@/types";

interface NotificationListResponse {
  data: AppNotification[];
  meta?: AppNotificationListMeta;
}

interface NotificationReadResponse {
  data: AppNotification;
}

interface NotificationReadAllResponse {
  data?: {
    updated?: number;
  };
}

interface NotificationClearResponse {
  data?: {
    cleared?: number;
  };
}

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  error: string;
  lastSyncedAt: string | null;
  refreshNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearNotification: (id: string) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);
const AUTO_SYNC_INTERVAL_MS = 60_000;
const DEFAULT_PER_PAGE = 40;
const NOTIFICATION_LOAD_ERROR =
  "Unable to load notifications. Try refreshing. If this continues, contact the administrator.";
const REALTIME_REFRESH_DEBOUNCE_MS = 250;
const NOTIFICATION_REALTIME_EVENTS = new Set([
  "indicators.submitted",
  "indicators.scopes_submitted",
  "school_records.reminder_sent",
]);

export function isNotificationRealtimeUpdate(payload: { entity?: string; eventType?: string } | null | undefined): boolean {
  if (!payload?.eventType) return false;
  return NOTIFICATION_REALTIME_EVENTS.has(payload.eventType)
    || (payload.entity === "indicators" && payload.eventType.startsWith("indicators.scope_"));
}

function normalizeMeta(meta: AppNotificationListMeta | undefined, notifications: AppNotification[]): AppNotificationListMeta {
  return {
    currentPage: meta?.currentPage ?? 1,
    lastPage: Math.max(1, meta?.lastPage ?? 1),
    perPage: meta?.perPage ?? DEFAULT_PER_PAGE,
    total: meta?.total ?? notifications.length,
    unreadCount:
      typeof meta?.unreadCount === "number"
        ? meta.unreadCount
        : notifications.filter((entry) => !entry.readAt).length,
  };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, apiToken } = useAuth();
  const token = user ? apiToken : "";

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isSyncActive, setIsSyncActive] = useState(false);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const notificationRequestSequenceRef = useRef(0);

  const invalidateNotificationListRequests = useCallback(() => {
    notificationRequestSequenceRef.current += 1;
    setIsLoading(false);
  }, []);

  const handleApiError = useCallback(
    async (err: unknown) => {
      if (isApiError(err)) {
        if (err.status === 401) {
          setError("");
          return;
        }

        if (err.status === 403) {
          setError("You do not have permission to access notifications.");
          return;
        }
      }

      setError(NOTIFICATION_LOAD_ERROR);
    },
    [],
  );

  const syncNotifications = useCallback(
    async (silent = false) => {
      const requestId = ++notificationRequestSequenceRef.current;
      if (!token) {
        setNotifications([]);
        setUnreadCount(0);
        setError("");
        setLastSyncedAt(null);
        setIsLoading(false);
        setIsSyncActive(false);
        return;
      }

      if (!silent) {
        setIsLoading(true);
      }
      setError("");

      try {
        const response = await apiRequestRaw<NotificationListResponse>(`/api/notifications?per_page=${DEFAULT_PER_PAGE}`, {
          token,
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];
        const meta = normalizeMeta(response.data?.meta, rows);

        if (requestId !== notificationRequestSequenceRef.current) return;

        setNotifications(rows);
        setUnreadCount(meta.unreadCount);
        setError("");
        setLastSyncedAt(new Date().toISOString());
      } catch (err) {
        if (requestId !== notificationRequestSequenceRef.current) return;
        await handleApiError(err);
      } finally {
        if (requestId === notificationRequestSequenceRef.current) {
          setIsLoading(false);
        }
      }
    },
    [token, handleApiError],
  );

  const refreshNotifications = useCallback(async () => {
    setIsSyncActive(true);
    await syncNotifications(false);
  }, [syncNotifications]);

  useEffect(() => {
    notificationRequestSequenceRef.current++;
    setNotifications([]);
    setUnreadCount(0);
    setError("");
    setLastSyncedAt(null);
    setIsLoading(false);
    setIsSyncActive(Boolean(token));
  }, [token, user?.id]);

  useEffect(() => {
    if (!token) {
      void syncNotifications(true);
      return;
    }

    setIsSyncActive(true);
    void syncNotifications(true);
  }, [token, syncNotifications]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!token) return;

      invalidateNotificationListRequests();

      try {
        const response = await apiRequestRaw<NotificationReadResponse>(`/api/notifications/${id}/read`, {
          method: "POST",
          token,
        });
        const next = response.data?.data;
        invalidateNotificationListRequests();

        if (next) {
          setNotifications((current) => current.map((entry) => (entry.id === id ? next : entry)));
          setUnreadCount((current) => Math.max(0, current - 1));
        } else {
          await syncNotifications(true);
        }
      } catch (err) {
        await handleApiError(err);
      }
    },
    [token, syncNotifications, handleApiError, invalidateNotificationListRequests],
  );

  const markAllAsRead = useCallback(async () => {
    if (!token) return;

    invalidateNotificationListRequests();

    try {
      await apiRequestRaw<NotificationReadAllResponse>("/api/notifications/read-all", {
        method: "POST",
        token,
      });
      invalidateNotificationListRequests();
      const nowIso = new Date().toISOString();
      setNotifications((current) =>
        current.map((entry) => (entry.readAt ? entry : { ...entry, readAt: nowIso })),
      );
      setUnreadCount(0);
    } catch (err) {
      await handleApiError(err);
    }
  }, [token, handleApiError, invalidateNotificationListRequests]);

  const clearNotification = useCallback(
    async (id: string) => {
      if (!token) return;
      const target = notifications.find((entry) => entry.id === id);
      invalidateNotificationListRequests();

      try {
        await apiRequestRaw<NotificationClearResponse>(`/api/notifications/${id}/clear`, {
          method: "POST",
          token,
        });
        invalidateNotificationListRequests();

        setNotifications((current) => current.filter((entry) => entry.id !== id));

        if (target && !target.readAt) {
          setUnreadCount((current) => Math.max(0, current - 1));
        }
      } catch (err) {
        await handleApiError(err);
      }
    },
    [token, notifications, handleApiError, invalidateNotificationListRequests],
  );

  const clearAllNotifications = useCallback(async () => {
    if (!token) return;

    invalidateNotificationListRequests();

    try {
      await apiRequestRaw<NotificationClearResponse>("/api/notifications/clear", {
        method: "POST",
        token,
      });
      invalidateNotificationListRequests();
      setNotifications([]);
      setUnreadCount(0);
    } catch (err) {
      await handleApiError(err);
    }
  }, [token, handleApiError, invalidateNotificationListRequests]);

  useEffect(() => {
    if (!token || !isSyncActive) return;

    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void syncNotifications(true);
    }, AUTO_SYNC_INTERVAL_MS);

    const syncOnFocus = () => {
      void syncNotifications(true);
    };

    const syncOnRealtime = (event: Event) => {
      const payload = (event as CustomEvent<{ entity?: string; eventType?: string }>).detail;
      if (!isNotificationRealtimeUpdate(payload)) return;

      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void syncNotifications(true);
      }, REALTIME_REFRESH_DEBOUNCE_MS);
    };

    window.addEventListener("focus", syncOnFocus);
    window.addEventListener("online", syncOnFocus);
    window.addEventListener("cspams:update", syncOnRealtime);

    return () => {
      window.clearInterval(interval);
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      window.removeEventListener("focus", syncOnFocus);
      window.removeEventListener("online", syncOnFocus);
      window.removeEventListener("cspams:update", syncOnRealtime);
    };
  }, [isSyncActive, token, syncNotifications]);

  const value = useMemo<NotificationContextType>(
    () => ({
      notifications,
      unreadCount,
      isLoading,
      error,
      lastSyncedAt,
      refreshNotifications,
      markAsRead,
      markAllAsRead,
      clearNotification,
      clearAllNotifications,
    }),
    [
      notifications,
      unreadCount,
      isLoading,
      error,
      lastSyncedAt,
      refreshNotifications,
      markAsRead,
      markAllAsRead,
      clearNotification,
      clearAllNotifications,
    ],
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
