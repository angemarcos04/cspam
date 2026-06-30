import { useCallback, type Dispatch, type SetStateAction } from "react";
import { runRefreshBatches, type RefreshOptions } from "@/lib/runRefreshBatches";
import type { MonitorTopNavigatorId } from "@/pages/monitor/monitorFilters";

type DashboardToastTone = "success" | "info" | "warning";

interface UseMonitorDashboardGlobalCommandsArgs {
  refreshRecords: (options?: RefreshOptions) => Promise<unknown>;
  refreshSubmissions: (options?: RefreshOptions) => Promise<unknown>;
  refreshStudents: (options?: RefreshOptions) => Promise<unknown>;
  refreshTeachers: (options?: RefreshOptions) => Promise<unknown>;
  refreshReviewInbox?: (options?: RefreshOptions) => Promise<unknown>;
  onToast: (message: string, tone?: DashboardToastTone) => void;
  setShowNavigatorManual: Dispatch<SetStateAction<boolean>>;
  setActiveTopNavigator: Dispatch<SetStateAction<MonitorTopNavigatorId>>;
  focusAndScrollTo: (targetId: string) => void;
  isMobileViewport: boolean;
  setIsNavigatorVisible: Dispatch<SetStateAction<boolean>>;
}

interface UseMonitorDashboardGlobalCommandsResult {
  handleRefreshDashboard: () => Promise<void>;
  handleMonitorTopNavigate: (id: MonitorTopNavigatorId) => void;
}

const TOP_NAV_TARGET_BY_ID: Record<MonitorTopNavigatorId, string> = {
  schools: "monitor-school-records",
  reviews: "monitor-requirements-table",
  audit: "monitor-audit-trail",
};

export function useMonitorDashboardGlobalCommands({
  refreshRecords,
  refreshSubmissions,
  refreshStudents,
  refreshTeachers,
  refreshReviewInbox,
  onToast,
  setShowNavigatorManual,
  setActiveTopNavigator,
  focusAndScrollTo,
  isMobileViewport,
  setIsNavigatorVisible,
}: UseMonitorDashboardGlobalCommandsArgs): UseMonitorDashboardGlobalCommandsResult {
  const handleRefreshDashboard = useCallback(async () => {
    const manualRefreshOptions: RefreshOptions = { force: true, throwOnError: true };
    const reviewInboxTasks = refreshReviewInbox ? [() => refreshReviewInbox(manualRefreshOptions)] : [];
    const results = await runRefreshBatches([
      [() => refreshRecords(manualRefreshOptions)],
      [() => refreshSubmissions(manualRefreshOptions)],
      reviewInboxTasks,
      [() => refreshStudents(manualRefreshOptions), () => refreshTeachers(manualRefreshOptions)],
    ]);

    if (results.some((result) => result.status === "rejected")) {
      onToast("Some dashboard data failed to refresh. Please try again.", "warning");
    }
  }, [onToast, refreshRecords, refreshReviewInbox, refreshSubmissions, refreshStudents, refreshTeachers]);

  const handleMonitorTopNavigate = useCallback(
    (id: MonitorTopNavigatorId) => {
      setShowNavigatorManual(false);
      setActiveTopNavigator(id);

      if (typeof window !== "undefined") {
        const targetId = TOP_NAV_TARGET_BY_ID[id];
        if (targetId) {
          window.setTimeout(() => {
            focusAndScrollTo(targetId);
          }, 70);
        }
      }

      if (isMobileViewport) {
        setIsNavigatorVisible(false);
      }
    },
    [focusAndScrollTo, isMobileViewport, setActiveTopNavigator, setIsNavigatorVisible, setShowNavigatorManual],
  );

  return {
    handleRefreshDashboard,
    handleMonitorTopNavigate,
  };
}
