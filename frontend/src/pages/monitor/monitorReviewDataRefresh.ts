import { runRefreshBatches } from "@/lib/runRefreshBatches";

interface RefreshMonitorReviewDataArgs {
  refreshSchoolDrawer: () => void;
  refreshSubmissions: () => Promise<unknown>;
  refreshRecords: (options?: { force?: boolean }) => Promise<unknown>;
  refreshReviewInbox?: (options?: { force?: boolean }) => Promise<unknown>;
}

export async function refreshMonitorReviewData({
  refreshSchoolDrawer,
  refreshSubmissions,
  refreshRecords,
  refreshReviewInbox,
}: RefreshMonitorReviewDataArgs): Promise<PromiseSettledResult<unknown>[]> {
  refreshSchoolDrawer();
  const reviewInboxTasks = refreshReviewInbox ? [() => refreshReviewInbox({ force: true })] : [];
  return runRefreshBatches([
    [refreshSubmissions],
    [() => refreshRecords({ force: true })],
    reviewInboxTasks,
  ]);
}
