import { runRefreshBatches } from "@/lib/runRefreshBatches";

interface RefreshMonitorReviewDataArgs {
  refreshSchoolDrawer: () => void;
  refreshSubmissions: () => Promise<unknown>;
  refreshRecords: () => Promise<unknown>;
}

export async function refreshMonitorReviewData({
  refreshSchoolDrawer,
  refreshSubmissions,
  refreshRecords,
}: RefreshMonitorReviewDataArgs): Promise<PromiseSettledResult<unknown>[]> {
  refreshSchoolDrawer();
  return runRefreshBatches([
    [refreshSubmissions],
    [refreshRecords],
  ]);
}
