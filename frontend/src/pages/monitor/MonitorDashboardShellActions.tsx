import { RefreshCw } from "lucide-react";

interface MonitorDashboardShellActionsProps {
  isDashboardSyncing: boolean;
  dashboardLastSyncedAt: string | null;
  syncStatus: string;
  syncScope: string | null;
  onRefresh: () => void;
}

export function MonitorDashboardShellActions({
  isDashboardSyncing,
  dashboardLastSyncedAt,
  syncStatus,
  syncScope,
  onRefresh,
}: MonitorDashboardShellActionsProps) {
  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-sm border border-white/20 bg-white/10 p-1.5 sm:gap-2">
      <button
        type="button"
        onClick={onRefresh}
        disabled={isDashboardSyncing}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-white text-primary-700 shadow-sm transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
        aria-label="Refresh dashboard data"
        title={isDashboardSyncing ? "Refreshing..." : "Refresh"}
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isDashboardSyncing ? "animate-spin" : ""}`} />
      </button>
      <span className="hidden max-w-[17rem] items-center truncate text-[11px] font-medium text-primary-100 sm:inline-flex lg:max-w-[21rem]">
        {syncStatus === "up_to_date" ? "Up to date" : "Updated"}
        {" | "}
        {dashboardLastSyncedAt
          ? new Date(dashboardLastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          : "Not synced"}
        {syncScope ? ` | ${syncScope}` : ""}
      </span>
    </div>
  );
}
